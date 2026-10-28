const abort = () => new DOMException('Cancelled', 'AbortError');

export class VideoDeck {
  constructor(element) {
    this.element = element; this.unwatch = null; this.onEnded = null;
    element.muted = true; element.playsInline = true; element.preload = 'auto';
    this.ended = () => this.onEnded?.(); element.addEventListener('ended', this.ended);
  }
  get time() { return this.element.currentTime; }
  get ready() { return this.element.readyState >= 2 && !this.element.error; }
  get visible() { return this.element.dataset.active === 'true'; }
  show(active) { this.element.dataset.active = String(active); }
  pause() { this.element.pause(); }
  play() { return this.element.play(); }
  async wait(check, signal, action = () => {}, timeout = 12000) {
    if (signal.aborted) throw abort();
    const element = this.element;
    return new Promise((resolve, reject) => {
      let timer;
      const events = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'error'];
      const cleanup = () => { clearTimeout(timer); events.forEach(event => element.removeEventListener(event, inspect)); signal.removeEventListener('abort', cancel); };
      const fail = error => { cleanup(); reject(error); };
      const cancel = () => fail(abort());
      const inspect = () => {
        if (signal.aborted) return cancel();
        if (element.error) return fail(new Error('Video decoding or loading failed.'));
        if (check()) { cleanup(); resolve(); }
      };
      events.forEach(event => element.addEventListener(event, inspect)); signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => fail(new Error('Video readiness timed out.')), timeout);
      try { action(); inspect(); } catch (error) { fail(error); }
    });
  }
  async seek(time, signal) {
    if (Math.abs(this.time - time) < .002 && !this.element.seeking && this.ready) return;
    await this.wait(() => !this.element.seeking && this.ready && Math.abs(this.time - time) < .08, signal, () => { this.element.currentTime = time; });
  }
  async prepare(scene, time, signal, sourceOverride) {
    this.pause(); this.show(false);
    const source = sourceOverride || scene.src;
    if (this.element.getAttribute('src') !== source || !this.ready) {
      await this.wait(() => this.ready && Number.isFinite(this.element.duration), signal, () => { this.element.src = source; this.element.load(); });
    }
    if (scene.loopEnd > this.element.duration + .08) throw new Error('Loop exceeds the video duration.');
    await this.seek(time, signal);
  }
  async present(signal, paused) {
    if (signal.aborted) throw abort();
    if (paused() && this.ready) return;
    const element = this.element;
    return new Promise((resolve, reject) => {
      let handle, poll, timer;
      const videoFrames = typeof element.requestVideoFrameCallback === 'function';
      const cleanup = () => {
        clearTimeout(timer); clearInterval(poll); signal.removeEventListener('abort', cancel);
        if (handle !== undefined) videoFrames ? element.cancelVideoFrameCallback(handle) : cancelAnimationFrame(handle);
      };
      const done = error => { cleanup(); error ? reject(error) : resolve(); };
      const cancel = () => done(abort());
      const frame = () => { if (element.readyState >= 2 && !element.seeking) done(); else schedule(); };
      const schedule = () => { handle = videoFrames ? element.requestVideoFrameCallback(frame) : requestAnimationFrame(frame); };
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => done(new Error('A decoded presentation frame did not arrive.')), 4000);
      poll = setInterval(() => { if (paused() && this.ready) done(); }, 40);
      schedule();
    });
  }
  watch(callback) {
    this.unwatch?.();
    const element = this.element, videoFrames = typeof element.requestVideoFrameCallback === 'function';
    let handle, stopped = false;
    const frame = (_, metadata) => { if (stopped) return; if (!element.seeking) callback(metadata?.mediaTime ?? element.currentTime); if (!stopped) schedule(); };
    const schedule = () => { handle = videoFrames ? element.requestVideoFrameCallback(frame) : requestAnimationFrame(frame); };
    const stop = () => { stopped = true; if (handle !== undefined) videoFrames ? element.cancelVideoFrameCallback(handle) : cancelAnimationFrame(handle); };
    schedule(); this.unwatch = stop; return stop;
  }
  dispose() { this.unwatch?.(); this.pause(); this.element.removeEventListener('ended', this.ended); this.element.removeAttribute('src'); this.element.load(); }
}
