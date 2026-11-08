// Decode the target before replacing the visible image. No intermediate poses.
export class StillSequence {
  constructor({ load, show, changed = () => {}, failed = () => {}, discard = () => {}, accept = value => ['work', 'attention'].includes(value) }) {
    Object.assign(this, { load, show, changed, failed, discard, accept });
    this.current = null; this.target = null; this.paused = false;
    this.pending = null; this.closed = false; this.revision = 0;
    this.failedRevision = -1;
  }
  select(target) {
    if (!this.accept(target)) throw new Error('Unknown still pose');
    if (this.closed) return Promise.resolve();
    this.target = target; this.revision++;
    return this.kick();
  }
  kick() {
    if (this.closed || this.paused || this.target === null || this.current === this.target || this.failedRevision === this.revision) return this.pending ?? Promise.resolve();
    this.pending ??= this.flush().finally(() => { this.pending = null; });
    return this.pending;
  }
  setPaused(value) {
    this.paused = value;
    if (!value) return this.kick();
    return Promise.resolve();
  }
  async flush() {
    while (!this.closed && !this.paused && this.current !== this.target) {
      const target = this.target, revision = this.revision;
      let prepared;
      try {
        prepared = await this.load(target);
        if (this.closed || this.paused || revision !== this.revision) { this.discard(prepared); prepared = null; continue; }
        if (await this.show(prepared, target) === false) {
          this.discard(prepared); prepared = null;
          if (revision !== this.revision) continue;
          return;
        }
        prepared = null; // The visible renderer now owns the resource.
        if (this.closed) return;
        this.current = target; this.changed(target);
      } catch (error) {
        if (prepared) this.discard(prepared);
        if (this.closed) return;
        if (revision !== this.revision) continue;
        this.failedRevision = revision; this.failed(error, target); return;
      }
    }
  }
  close() { this.closed = true; this.revision++; }
}
