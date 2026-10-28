// One recorded-ambience engine, shared by the audition and the wallpaper owner.
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export const AMBIENT_DEFAULTS = Object.freeze({ rainVolume: .12, keyVolume: .08 });
export const KEYBOARD_CLIPS = [[2.3, 2.6], [6.3, 2.7], [9.2, 1.55], [12.1, 1.8], [18.3, 2.8], [23.2, 2], [30.2, 2.4]];
export function ambientLevels(state = {}) {
  if (!state.enabled || state.paused || state.hidden || state.capturing) return { rain: 0, keys: 0 };
  return {
    rain: clamp(state.rainVolume ?? AMBIENT_DEFAULTS.rainVolume) * (state.speaking ? .2 : 1),
    keys: state.pose === 'work' && !state.speaking ? clamp(state.keyVolume ?? AMBIENT_DEFAULTS.keyVolume) : 0,
  };
}
export class AmbientPreview {
  constructor({ random = Math.random, contextFactory = () => new AudioContext(), fetcher = (...args) => fetch(...args), mediaRoot = '/media' } = {}) {
    Object.assign(this, { random, contextFactory, fetcher, mediaRoot });
    this.state = {}; this.context = null; this.closed = false; this.activation = 0;
    this.timers = new Set(); this.sources = new Set(); this.lastClip = -1;
    this.buffers = null; this.loading = null; this.rain = null;
  }
  async enable() {
    if (this.closed) return false;
    this.state.enabled = true;
    const activation = ++this.activation;
    if (!this.context) this.create();
    try {
      // Resume during the user's click, before waiting for file decoding.
      await Promise.all([this.context.resume(), this.load()]);
      if (this.closed || activation !== this.activation || !this.state.enabled) return false;
      if (!this.rain) {
        this.rain = this.context.createBufferSource(); this.rain.buffer = this.buffers.rain;
        this.rain.loop = true; this.rain.connect(this.rainGain); this.rain.start();
      }
      this.update({}); return true;
    } catch (error) {
      if (this.closed || activation !== this.activation) return false;
      this.update({ enabled: false }); throw error;
    }
  }
  create() {
    const c = this.context = this.contextFactory();
    this.rainGain = c.createGain(); this.keyGain = c.createGain();
    this.rainGain.gain.value = this.keyGain.gain.value = 0;
    this.rainGain.connect(c.destination); this.keyGain.connect(c.destination);
  }
  load() {
    if (this.buffers) return Promise.resolve(this.buffers);
    this.loading ??= Promise.all(['light-rain', 'soft-keyboard'].map(async name => {
      const response = await this.fetcher(`${this.mediaRoot}/${name}.ogg`);
      if (!response.ok) throw new Error('声音文件未能载入，请再次开启声音重试。');
      return this.context.decodeAudioData(await response.arrayBuffer());
    })).then(([rain, keys]) => {
      if (keys.duration < 33 || rain.duration < 10) throw new Error('声音文件不完整，请重试。');
      if (!this.closed) this.buffers = { rain, keys };
      return { rain, keys };
    }).finally(() => { this.loading = null; });
    return this.loading;
  }
  update(patch) {
    Object.assign(this.state, patch);
    if (patch.enabled === false) this.activation++;
    const levels = this.levels = ambientLevels(this.state);
    if (!this.context || this.closed) return levels;
    const now = this.context.currentTime;
    for (const [gain, value] of [[this.rainGain, levels.rain], [this.keyGain, levels.keys]]) {
      const parameter = gain.gain;
      if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(now);
      else { parameter.cancelScheduledValues(now); parameter.setValueAtTime(parameter.value, now); }
      if (!value) parameter.setValueAtTime(0, now);
      else parameter.linearRampToValueAtTime(value, now + (this.state.speaking ? .12 : 1.2));
    }
    if (!levels.keys) this.clearKeys();
    else if (this.rain && !this.timers.size && !this.sources.size) this.scheduleKeys(1.5 + this.random() * 2);
    return levels;
  }
  scheduleKeys(seconds) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.closed || !this.levels?.keys) return;
      this.playKeys();
    }, seconds * 1000);
    this.timers.add(timer);
  }
  playKeys() {
    // Keep a real short typing phrase and its natural timing, followed by a pause.
    const index = (this.lastClip + 1 + Math.floor(this.random() * (KEYBOARD_CLIPS.length - 1))) % KEYBOARD_CLIPS.length;
    this.lastClip = index;
    const [offset, duration] = KEYBOARD_CLIPS[index], c = this.context;
    const source = c.createBufferSource(), envelope = c.createGain();
    source.buffer = this.buffers.keys;
    const strength = .75 + this.random() * .25;
    envelope.gain.setValueAtTime(0, c.currentTime);
    envelope.gain.linearRampToValueAtTime(strength, c.currentTime + .04);
    envelope.gain.setValueAtTime(strength, c.currentTime + duration - .1);
    envelope.gain.linearRampToValueAtTime(0, c.currentTime + duration);
    source.connect(envelope); envelope.connect(this.keyGain); this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); envelope.disconnect(); };
    source.start(c.currentTime, offset, duration);
    this.scheduleKeys(duration + 5 + this.random() * 7);
  }
  clearKeys() {
    for (const timer of this.timers) clearTimeout(timer); this.timers.clear();
    for (const source of this.sources) source.stop(); this.sources.clear();
  }
  async close() {
    if (this.closed) return;
    this.closed = true; this.activation++; this.clearKeys(); this.rain?.stop();
    await this.context?.close(); this.buffers = null;
  }
}
