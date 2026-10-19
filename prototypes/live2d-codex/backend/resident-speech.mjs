import { EventEmitter } from 'node:events';
import { LocalSpeech } from './speech.mjs';
import { QwenSpeech, qwenAvailable } from './qwen-speech.mjs';

// Residency is a user choice. Playback/capture/session changes only cancel the
// current utterance; only disabling residency, changing engines or quitting
// destroys the TTS worker. ASR has an independent, idle-unloaded worker.
export class ResidentSpeech extends EventEmitter {
  constructor(models, { executable, qwenRoot = '', factory } = {}) {
    super(); this.models = models; this.executable = executable; this.qwenRoot = qwenRoot;
    this.asr = new LocalSpeech(models, { executable });
    this.asr.onState = () => this.emit('state',this.status());
    this.factory = factory ?? ((engine, root) => engine === 'qwen'
      ? new QwenSpeech(root) : new KokoroResident(models, executable));
    this.settings = {}; this.worker = null; this.revision = 0;
    this.phase = 'unloaded'; this.error = ''; this.teardown = Promise.resolve(); this.loading = null;
  }
  status() {
    const local = this.asr.status();
    const engines = { qwen: qwenAvailable(this.settings.qwenRoot || this.qwenRoot), kokoro: local.tts };
    return { asr: local.asr, tts: !!engines[this.settings.ttsEngine ?? 'qwen'], engines,
      loaded: [...local.loaded, ...(this.worker && ['ready', 'generating', 'stopping'].includes(this.phase) ? ['tts'] : [])],
      engine: this.settings.ttsEngine ?? 'qwen', resident: this.settings.ttsResident === true,
      phase: this.phase, error: this.error };
  }
  update(phase, error = '') { this.phase = phase; this.error = error; this.emit('state', this.status()); }
  configure(settings) {
    const engine = settings.ttsEngine ?? 'qwen', root = settings.qwenRoot || this.qwenRoot;
    const same = this.settings.ttsEngine === engine && (this.settings.qwenRoot || this.qwenRoot) === root;
    this.settings = { ...settings, ttsEngine: engine };
    if (settings.ttsResident === true && same && this.worker && this.phase !== 'error') return this.loading ?? Promise.resolve();
    const revision = ++this.revision, previous = this.worker; this.worker = null;
    if (previous) {
      this.update('unloading');
      this.teardown = this.teardown.then(() => previous.close());
    }
    const task = (async () => {
      try {
        await this.teardown;
        if (revision !== this.revision) return;
        if (settings.ttsResident !== true) { this.update('unloaded'); return; }
        if (!['qwen', 'kokoro'].includes(engine)) throw new Error('未知播报引擎。');
        const worker = this.factory(engine, root); this.worker = worker;
        worker.onExit = error => { if (this.worker === worker) { this.worker = null; this.update('error', error.message); } };
        this.update('loading');
        await worker.load();
        if (revision === this.revision && this.worker === worker) this.update('ready');
      } catch (error) {
        if (revision !== this.revision) return;
        const worker = this.worker; this.worker = null;
        if (worker) await worker.close().catch(() => {});
        this.update('error', error.message);
      }
    })();
    this.loading = task;
    task.finally(() => { if (this.loading === task) this.loading = null; });
    return task;
  }
  transcribe(data) { return this.asr.transcribe(data); }
  async loadAsr() { try { await this.asr.run('load-asr', {}); } catch(error) { this.asr.stop('asr'); throw error; } this.emit('state', this.status()); }
  unloadAsr() { this.asr.stop('asr'); this.emit('state', this.status()); }
  async synthesize(text, settings = this.settings) {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('播报片段长度无效。');
    if (!this.settings.ttsResident) throw new Error('语音未加载，请在工作台开启「常驻加载播报模型」。');
    if (this.phase !== 'ready' || !this.worker) throw new Error(this.error || '语音模型尚未就绪，请稍候。');
    const worker = this.worker; this.update('generating');
    try { return await worker.synthesize(text, settings); }
    finally { if (this.worker === worker && this.phase === 'generating') this.update('ready'); }
  }
  async stop() {
    const worker = this.worker;
    if (!worker || !['generating', 'stopping'].includes(this.phase)) return;
    this.update('stopping');
    await worker.cancel();
    if (this.worker === worker && this.phase === 'stopping') this.update('ready');
  }
  async close() { this.asr.close(); await this.configure({ ...this.settings, ttsResident: false }); }
}

class KokoroResident {
  constructor(models, executable) { this.service = new LocalSpeech(models, { executable, retainTts: true }); }
  load() { return this.service.run('load-tts', {}); }
  synthesize(text, settings) { return this.service.synthesize(text, settings); }
  cancel() { return this.service.cancelTts(); }
  close() { this.service.close(); }
}
