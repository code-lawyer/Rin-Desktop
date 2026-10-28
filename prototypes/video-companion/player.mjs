const aborted = () => new DOMException('Cancelled', 'AbortError');

// The controller knows playback intent and two media decks, not any wallpaper host.
export class VideoCompanion {
  constructor({ decks, onChange = () => {}, now = () => performance.now() }) {
    if (decks.length !== 2) throw new Error('Two media decks are required.');
    Object.assign(this, { decks, onChange, now });
    this.active = null; this.current = null; this.target = null; this.operation = null;
    this.manualPaused = false; this.suspended = false; this.errorPaused = false;
    this.closed = false; this.loading = false; this.error = null; this.warm = null;
    this.loops = 0; this.switches = 0; this.history = []; this.lastHandoffMs = null;
    this.listeners = new Set(); this.generation = 0;
    for (const deck of decks) deck.onEnded = () => { if (deck === this.active && !this.paused && !this.operation) this.cycle(); };
  }
  get paused() { return this.manualPaused || this.suspended || this.errorPaused; }
  get spare() { return this.decks.find(deck => deck !== this.active) || this.decks[0]; }
  snapshot() {
    return { current: this.current?.id ?? null, target: this.target?.id ?? null, paused: this.paused, manualPaused: this.manualPaused, suspended: this.suspended, loading: this.loading, error: this.error?.message ?? null, phase: this.error ? 'error' : this.loading ? 'loading' : this.paused ? 'paused' : this.current ? 'playing' : 'empty', loops: this.loops, switches: this.switches, lastHandoffMs: this.lastHandoffMs, time: this.active?.time ?? 0, loopStart: this.current?.loopStart ?? 0, loopEnd: this.current?.loopEnd ?? 0, readyDecks: this.decks.filter(deck => deck.ready).length, history: [...this.history] };
  }
  publish() { const state = this.snapshot(); this.onChange(state); for (const listener of this.listeners) listener(state); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  log(type, details = {}) { this.history.push({ type, at: Math.round(this.now()), ...details }); if (this.history.length > 80) this.history.shift(); }
  cancelWarm() { this.warm?.controller.abort(); this.warm = null; }
  stopWatch() { this.unwatch?.(); this.unwatch = null; }
  watch() {
    this.stopWatch();
    if (!this.active || this.paused || this.closed) return;
    const deck = this.active;
    this.unwatch = deck.watch(time => {
      if (deck !== this.active || this.paused || this.operation) return;
      if (time >= this.current.loopEnd - 2 / this.current.fps) this.cycle();
    });
  }
  warmLoop() {
    this.cancelWarm();
    if (!this.current || this.closed || this.operation) return;
    const controller = new AbortController(), scene = this.current, deck = this.spare;
    const warm = { controller, scene, deck };
    warm.promise = deck.prepare(scene, scene.loopStart, controller.signal);
    // Speculation can fail silently. A real handoff surfaces the error and retry.
    warm.promise.catch(() => {}); this.warm = warm;
  }
  async select(scene, { entry = false, sourceOverride } = {}) {
    if (this.closed) return;
    this.target = scene; this.targetEntry = entry;
    this.operation?.controller.abort(); this.cancelWarm(); this.stopWatch();
    const controller = new AbortController(), op = { controller, id: ++this.generation };
    this.operation = op; this.loading = true; this.error = null; this.errorPaused = false;
    const deck = this.spare;
    // A cancelled pending deck must not continue playing behind the active one.
    deck.pause(); this.publish();
    try {
      await deck.prepare(scene, entry ? 0 : scene.loopStart, controller.signal, sourceOverride);
      await this.commit(op, deck, scene, false);
    } catch (error) {
      if (this.operation === op && error.name !== 'AbortError') this.fail(error, 'selection');
    } finally {
      if (this.operation === op) {
        this.operation = null; this.loading = false;
        this.watch(); if (!this.error) this.warmLoop(); this.publish();
      }
    }
  }
  async commit(op, deck, scene, loop) {
    const valid = () => !this.closed && this.operation === op && !op.controller.signal.aborted;
    if (!valid()) throw aborted();
    const started = this.now();
    if (!this.paused) {
      try { await deck.play(); }
      catch (error) { if (!this.paused) throw error; }
      if (!valid()) { if (this.active !== deck && !this.operation) deck.pause(); throw aborted(); }
      if (this.paused) deck.pause();
      await deck.present(op.controller.signal, () => this.paused);
    }
    if (!valid()) throw aborted();
    if (this.paused) deck.pause();
    const previous = this.active, outgoingTime = previous?.time;
    // Make a decoded frame opaque before retiring the old deck. Never blank both.
    deck.show(true); previous?.show(false); previous?.pause();
    this.active = deck; this.current = scene;
    this.lastHandoffMs = Math.round(this.now() - started);
    if (loop) this.loops++; else this.switches++;
    this.log(loop ? 'loop' : 'selection', { scene: scene.id, outgoingTime, incomingTime: deck.time, latencyMs: this.lastHandoffMs });
  }
  async cycle() {
    if (this.closed || !this.current || this.operation || this.paused) return;
    this.stopWatch();
    const controller = new AbortController(), op = { controller, id: ++this.generation };
    const warm = this.warm, scene = this.current, deck = this.spare;
    this.operation = op; this.warm = null;
    const cancel = () => warm?.controller.abort(); controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      if (warm && warm.deck === deck && warm.scene === scene) await warm.promise;
      else await deck.prepare(scene, scene.loopStart, controller.signal);
      await this.commit(op, deck, scene, true);
    } catch (error) {
      if (this.operation === op && error.name !== 'AbortError') this.fail(error, 'loop');
    } finally {
      controller.signal.removeEventListener('abort', cancel);
      if (this.operation === op) { this.operation = null; this.watch(); if (!this.error) this.warmLoop(); this.publish(); }
    }
  }
  fail(error, kind) {
    this.error = { kind, message: kind === 'loop' ? '循环衔接暂时中断，画面已保留。' : '新素材未能载入，已保留当前画面。', cause: error.message };
    this.errorPaused = true; for (const deck of this.decks) deck.pause();
    this.log('error', { kind, cause: error.message }); this.publish();
  }
  async retry() { if (this.target) await this.select(this.target, { entry: this.targetEntry }); }
  async setPaused(value) { this.manualPaused = Boolean(value); await this.syncPause(); }
  async setSuspended(value) { this.suspended = Boolean(value); await this.syncPause(); }
  async syncPause() {
    if (this.closed) return;
    if (this.paused) { this.stopWatch(); for (const deck of this.decks) deck.pause(); }
    else if (this.active) {
      const deck = this.active;
      try { await deck.play(); if (this.paused || this.active !== deck || this.closed) deck.pause(); else this.watch(); }
      catch (error) { if (!this.paused) this.fail(error, 'loop'); }
    }
    this.publish();
  }
  async nearBoundary() {
    if (!this.active || this.operation || this.error) return;
    await this.active.seek(Math.max(this.current.loopStart, this.current.loopEnd - .6), new AbortController().signal);
    this.publish();
  }
  close() {
    this.closed = true; this.operation?.controller.abort(); this.cancelWarm(); this.stopWatch();
    for (const deck of this.decks) deck.dispose(); this.listeners.clear();
  }
}
