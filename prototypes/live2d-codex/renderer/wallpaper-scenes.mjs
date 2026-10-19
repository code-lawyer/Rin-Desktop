// Only one model loads at a time. Rapid choices converge on the latest one;
// the current scene stays visible until its replacement is ready.
export class WallpaperScenes {
  constructor({ load, show, dispose }) {
    Object.assign(this, { load, show, dispose });
    this.current = null; this.currentId = null; this.target = null; this.pending = null; this.closed = false;
  }
  select(id) {
    if (this.closed) return Promise.resolve();
    this.target = id;
    this.pending ??= this.flush().finally(() => { this.pending = null; });
    return this.pending;
  }
  async flush() {
    while (!this.closed && this.target !== this.currentId) {
      const id = this.target;
      let scene;
      try { scene = await this.load(id); }
      catch (error) { if (this.closed || id !== this.target) continue; throw error; }
      if (this.closed || id !== this.target) { await this.dispose(scene); continue; }
      const previous = this.current;
      this.show(scene, id);
      this.current = scene; this.currentId = id;
      if (previous) await this.dispose(previous);
    }
  }
  async close() {
    this.closed = true;
    await this.pending?.catch(() => {});
    if (this.current) await this.dispose(this.current);
    this.current = null; this.currentId = null;
  }
}
