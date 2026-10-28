// Plays directed transitions once, then retains the decoded final frame.
// New intent during a visible turn waits for its endpoint; only the latest intent survives.
export class TransitionPlayer {
  constructor({ decks, manifest, onChange = () => {}, stallMs = 12000 }) {
    if (decks.length !== 2) throw new Error('Two decks are required.');
    Object.assign(this, { decks, manifest, onChange, stallMs });
    this.current = null; this.target = manifest.initial; this.stable = null;
    this.operation = null; this.error = null; this.manualPaused = false;
    this.suspended = false; this.closed = false; this.watchdog = null;
  }
  get paused() { return this.manualPaused || this.suspended; }
  snapshot() {
    const op = this.operation;
    return { current: this.current, target: this.target, destination: op?.to ?? null,
      phase: this.error ? 'error' : this.paused ? 'paused' : op?.phase === 'playing' ? 'transition' : op ? 'loading' : this.current ? 'holding' : 'empty',
      error: this.error, manualPaused: this.manualPaused, suspended: this.suspended };
  }
  publish() { this.onChange(this.snapshot()); }
  valid(op) { return !this.closed && this.operation === op && !op.controller.signal.aborted; }
  route(from, to) { return this.manifest.transitions.find(clip => clip.from === from && clip.to === to); }
  clearWatchdog() { clearInterval(this.watchdog); this.watchdog = null; }
  watch(op) {
    this.clearWatchdog();
    let lastTime = op.deck.time, advancedAt = performance.now();
    this.watchdog = setInterval(() => {
      if (!this.valid(op) || this.paused || op.phase !== 'playing') return;
      if (op.deck.time > lastTime + .001) { lastTime = op.deck.time; advancedAt = performance.now(); }
      else if (performance.now() - advancedAt > this.stallMs) this.fail(op, new Error('Playback stalled.'), '视频播放停滞，请重试。');
    }, Math.min(500, this.stallMs));
    this.watchdog.unref?.();
  }
  async start() {
    if (this.closed || this.current || this.operation) return;
    const initial = this.manifest.initial;
    const clip = this.manifest.transitions.find(item => item.from === initial);
    const op = { controller: new AbortController(), deck: this.decks[0], to: initial, phase: 'loading', initial: true };
    this.operation = op; this.error = null; this.publish();
    try {
      await op.deck.prepare(clip, 0, op.controller.signal);
      await op.deck.present(op.controller.signal, () => true);
      if (!this.valid(op)) return;
      this.decks.forEach(deck => deck.show(deck === op.deck));
      this.current = initial; this.stable = op.deck; this.operation = null;
      this.publish(); this.pump();
    } catch (error) { if (this.valid(op)) this.fail(op, error); }
  }
  request(state) {
    if (this.closed) return;
    if (!this.manifest.states.some(item => item.id === state)) throw new Error('Unknown state.');
    this.target = state; this.error = null;
    const op = this.operation;
    if (op && !op.initial && op.phase !== 'playing') {
      op.controller.abort(); op.deck.pause(); op.deck.show(false);
      this.operation = null;
    }
    this.publish();
    if (!this.current) void this.start(); else this.pump();
  }
  pump() {
    if (this.closed || this.paused || this.error || this.operation || !this.current || this.target === this.current) return;
    const clip = this.route(this.current, this.target);
    if (!clip) { this.error = '这个方向的转场尚未准备好。'; this.publish(); return; }
    const deck = this.decks.find(item => item !== this.stable);
    const op = { controller: new AbortController(), deck, to: this.target, phase: 'loading', clip };
    this.operation = op;
    deck.onEnded = () => this.finish(op);
    deck.onFailure = error => { if (this.valid(op)) this.fail(op, error); };
    this.publish(); void this.load(op);
  }
  async load(op) {
    try {
      await op.deck.prepare(op.clip, 0, op.controller.signal);
      await op.deck.present(op.controller.signal, () => true);
      if (!this.valid(op)) return;
      op.phase = 'prepared'; this.publish(); void this.activate(op);
    } catch (error) { if (this.valid(op)) this.fail(op, error); }
  }
  async activate(op) {
    if (!this.valid(op) || this.paused || op.phase !== 'prepared') return;
    op.phase = 'starting';
    try {
      await op.deck.seek(0, op.controller.signal);
      if (!this.valid(op)) return;
      if (this.paused) { op.phase = 'prepared'; return; }
      await op.deck.play();
      await op.deck.present(op.controller.signal, () => this.paused);
      if (!this.valid(op)) return;
      if (this.paused) { op.deck.pause(); op.phase = 'prepared'; return; }
      this.stable.show(false); op.deck.show(true);
      op.phase = 'playing'; this.watch(op); this.publish();
    } catch (error) {
      if (!this.valid(op)) return;
      if (this.paused) { op.deck.pause(); op.phase = 'prepared'; }
      else this.fail(op, error);
    }
  }
  finish(op) {
    if (!this.valid(op) || op.phase !== 'playing') return;
    this.clearWatchdog(); op.deck.pause();
    this.stable = op.deck; this.current = op.to; this.operation = null;
    this.error = null; this.publish(); this.pump();
  }
  fail(op, error, message = '这段转场暂时无法播放，请重试。') {
    if (!this.valid(op)) return;
    this.clearWatchdog(); op.controller.abort(); op.deck.pause(); op.deck.show(false);
    this.stable?.show(true); this.operation = null;
    this.lastFailure = error; this.error = message; this.publish();
  }
  retry() { this.error = null; this.publish(); if (!this.current) void this.start(); else this.pump(); }
  setPaused(value) { this.manualPaused = Boolean(value); this.updatePause(); }
  setSuspended(value) { this.suspended = Boolean(value); this.updatePause(); }
  updatePause() {
    if (this.closed) return;
    const op = this.operation;
    if (this.paused) { this.clearWatchdog(); this.decks.forEach(deck => deck.pause()); }
    else if (op?.phase === 'prepared') void this.activate(op);
    else if (op?.phase === 'playing') {
      this.watch(op);
      Promise.resolve().then(() => {
        if (this.valid(op) && !this.paused) return op.deck.play();
      }).catch(error => { if (this.valid(op) && !this.paused) this.fail(op, error); });
    } else if (!op) this.pump();
    this.publish();
  }
  close() {
    this.closed = true; this.clearWatchdog(); this.operation?.controller.abort();
    this.operation = null;
    this.decks.forEach(deck => { deck.onEnded = null; deck.onFailure = null; deck.dispose(); });
  }
}
