// Two muted decoders. One retains the visible frame while the next clip is
// decoded. State changes happen only at authored boundaries, never mid-turn.
export class MotionPlayer {
  constructor({ decks, catalog, changed = () => {}, now = () => performance.now(), interval = setInterval, clear = id => clearInterval(id) }) {
    if (decks.length !== 2) throw new Error('Two video decks are required.');
    Object.assign(this, { decks, catalog, changed, now, clear });
    this.active = -1; this.current = null; this.target = 'work'; this.pending = null;
    this.paused = false; this.pauseRevision = 0; this.closed = false; this.atBoundary = true; this.error = '';
    this.lastTime = -1; this.progressAt = now(); this.playCount = 0;
    decks.forEach((deck, index) => { deck.onEnded = () => { if (index === this.active) this.boundary(); }; });
    this.timer = interval(() => this.checkProgress(), 500);
  }
  snapshot() {
    return { phase: this.error ? 'error' : !this.current ? 'loading' : this.paused ? 'paused' : this.current.kind,
      clip: this.current?.id || null, state: this.current?.from || 'work', target: this.target,
      playCount: this.playCount, error: this.error, typing: !this.paused && !this.error && this.current?.id === 'work-loop' };
  }
  emit() { if (!this.closed) this.changed(this.snapshot()); }
  next() {
    if (!this.current) return 'work-loop';
    if (this.current.kind === 'transition') return `${this.current.to}-loop`;
    return this.current.from === this.target ? `${this.target}-loop` : `${this.current.from}-${this.target}`;
  }
  start() { this.prepare(); }
  setTarget(value) {
    if (!['work', 'user'].includes(value)) throw new Error('Unknown motion state.');
    if (this.closed || this.target === value) return;
    this.target = value; this.emit(); this.prepare();
  }
  setPaused(value) {
    if (this.closed || this.paused === value) return;
    this.paused = value; this.pauseRevision++; this.progressAt = this.now();
    if (value) this.decks.forEach(deck => deck.pause());
    else if (!this.error) {
      if (this.atBoundary) this.swap();
      else if (this.active >= 0) {
        const index = this.active, revision = this.pauseRevision;
        Promise.resolve(this.decks[index].play()).catch(error => {
          if (!this.closed && index === this.active && !(error.name === 'AbortError' && revision !== this.pauseRevision)) this.fail(error);
        });
      }
      this.prepare();
    }
    this.emit();
  }
  prepare() {
    if (this.closed || this.error) return;
    const id = this.next();
    if (this.pending?.id === id) return;
    this.pending?.controller.abort();
    const clip = this.catalog.clips.get(id), index = this.active === 0 ? 1 : 0;
    const job = { id, clip, index, controller: new AbortController(), ready: false, swapping: false };
    this.pending = job;
    (async () => {
      try {
        await this.decks[index].prepare(clip, 0, job.controller.signal);
        if (this.closed || this.pending !== job) return;
        job.ready = true;
        if (this.atBoundary) this.swap();
      } catch (error) { if (!this.closed && this.pending === job && error.name !== 'AbortError') this.fail(error); }
    })();
  }
  boundary() {
    if (this.closed || this.error || this.atBoundary) return;
    this.atBoundary = true;
    this.decks[this.active].pause(); this.swap();
  }
  async swap() {
    const job = this.pending;
    if (this.closed || this.error || this.paused || !this.atBoundary || !job?.ready || job.swapping) return;
    job.swapping = true;
    const deck = this.decks[job.index], pauseRevision = this.pauseRevision;
    try {
      await deck.play();
      if (this.closed || this.pending !== job) return;
      await deck.present(job.controller.signal, () => this.paused);
      if (this.closed || this.pending !== job) return;
      if (this.paused) { await this.rewindPrepared(job); return; }
      const old = this.active;
      this.unwatch?.(); deck.show(true);
      if (old >= 0) { this.decks[old].pause(); this.decks[old].show(false); }
      this.active = job.index; this.current = job.clip; this.pending = null; this.atBoundary = false;
      this.playCount++;
      this.lastTime = -1; this.progressAt = this.now();
      this.unwatch = deck.watch(time => {
        if (this.active === job.index && this.current === job.clip && time >= job.clip.duration - .5 / job.clip.fps) this.boundary();
      });
      this.emit(); this.prepare();
    } catch (error) {
      if (!this.closed && this.pending === job) {
        if (error.name === 'AbortError' && pauseRevision !== this.pauseRevision) await this.rewindPrepared(job);
        else this.fail(error);
      }
    }
  }
  async rewindPrepared(job) {
    try {
      const deck = this.decks[job.index]; deck.pause();
      await deck.seek(0, job.controller.signal);
      if (this.closed || this.pending !== job) return;
      job.swapping = false;
      if (!this.paused) this.swap();
    } catch (error) { if (!this.closed && this.pending === job) this.fail(error); }
  }
  checkProgress() {
    if (this.closed || this.paused || this.error || this.active < 0) return;
    const time = this.decks[this.active].time;
    if (time !== this.lastTime) { this.lastTime = time; this.progressAt = this.now(); }
    else if (this.now() - this.progressAt > 12000) this.fail(new Error('视频播放暂时停止响应。'));
  }
  fail(error) {
    this.error = error.message || '视频载入失败。'; this.pending?.controller.abort(); this.pending = null;
    this.decks.forEach(deck => deck.pause()); this.emit();
  }
  retry() {
    if (this.closed || !this.error) return;
    this.error = ''; this.progressAt = this.now(); this.atBoundary = true;
    this.emit(); this.prepare();
  }
  close() {
    this.closed = true; this.pending?.controller.abort(); this.unwatch?.(); this.clear(this.timer);
    this.decks.forEach(deck => deck.dispose());
  }
}
