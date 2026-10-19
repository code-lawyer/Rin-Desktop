import { speechChunks } from '../backend/speech-plan.mjs';

export const cancelledAudio = () => Object.assign(new Error('已取消本次语音。'), {name:'AbortError'});

// One cancellable preparation job, completed PCM only in a bounded LRU cache.
// It has no playback side effects: the caller must explicitly request playback.
export class ReplyAudio {
  constructor({synthesize, cancel, progress = () => {}, maxBytes = 32 * 1024 * 1024, maxEntries = 3}) {
    Object.assign(this, {synthesize, cancelWorker:cancel, progress, maxBytes, maxEntries});
    this.cache = new Map(); this.bytes = 0; this.active = null; this.drain = Promise.resolve();
  }
  has(key) { return this.cache.has(key); }
  clear() { this.cache.clear(); this.bytes = 0; }
  cancel() {
    const job = this.active; this.active = null;
    if (!job) return this.drain;
    job.cancelled = true;
    const stop = Promise.resolve().then(() => this.cancelWorker()).catch(() => {});
    this.drain = Promise.allSettled([job.promise, stop]).then(() => {});
    return this.drain;
  }
  prepare(key, text, profile) {
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key,cached); return Promise.resolve(cached); }
    if (this.active?.key === key) return this.active.promise;
    if (this.active) this.cancel();
    const before = this.drain, job = {key,cancelled:false}; this.active = job;
    const check = () => { if (job.cancelled) throw cancelledAudio(); };
    job.promise = (async () => {
      await before; check();
      const parts = speechChunks(text), waves = []; let length = 0, rate;
      if (!parts.length) throw new Error('这条回复没有可朗读的文字。');
      for (let index = 0; index < parts.length; index++) {
        check(); this.progress({key,completed:index,total:parts.length});
        const audio = await this.synthesize(parts[index],profile); check();
        const samples = audio.samples instanceof Float32Array ? audio.samples : new Float32Array(audio.samples);
        if (!samples.length || !Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 96000 || (rate && rate !== audio.sampleRate) || !samples.every(Number.isFinite)) throw new Error('语音片段不完整或格式不一致，请重试。');
        rate = audio.sampleRate; length += samples.length;
        if (length * 4 > this.maxBytes) throw new Error('本条语音超过完整播放的缓存容量，请改为朗读较短的回复。未播放不完整的音频。');
        waves.push(samples);
      }
      check();
      const samples = new Float32Array(length); let offset = 0;
      for (const wave of waves) { samples.set(wave,offset); offset += wave.length; }
      const audio = {samples,sampleRate:rate};
      while (this.cache.size && (this.cache.size >= this.maxEntries || this.bytes + samples.byteLength > this.maxBytes)) {
        const oldest = this.cache.keys().next().value; this.bytes -= this.cache.get(oldest).samples.byteLength; this.cache.delete(oldest);
      }
      this.cache.set(key,audio); this.bytes += samples.byteLength;
      this.progress({key,completed:parts.length,total:parts.length});
      return audio;
    })().finally(() => { if (this.active === job) this.active = null; });
    // Cancellation/background callers may detach; always consume rejection.
    job.promise.catch(() => {});
    return job.promise;
  }
}
