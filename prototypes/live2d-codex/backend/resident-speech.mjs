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
  retire(worker) {
    const closing = this.teardown.then(() => worker.close());
    this.teardown = closing;
    closing.catch(() => {
      // A shutdown deadline is not proof of exit. Only a later process close
      // event may release this failed barrier and permit a fresh worker.
      worker.exited?.then(() => { if (this.teardown === closing) this.teardown = Promise.resolve(); }, () => {});
    });
  }
  configure(settings) {
    const engine = settings.ttsEngine ?? 'qwen', root = settings.qwenRoot || this.qwenRoot;
    const same = this.settings.ttsEngine === engine && (this.settings.qwenRoot || this.qwenRoot) === root;
    this.settings = { ...settings, ttsEngine: engine };
    if (settings.ttsResident === true && same && this.worker && this.phase !== 'error') return this.loading ?? Promise.resolve();
    const revision = ++this.revision, previous = this.worker; this.worker = null;
    if (previous) {
      this.update('unloading');
      this.retire(previous);
    }
    const task = (async () => {
      // A failed teardown rejects service close/reload instead of reporting
      // successful release of a child whose exit is still unconfirmed.
      try { await this.teardown; }
      catch (error) { if (revision === this.revision) this.update('error', error.message); throw error; }
      if (revision !== this.revision) return;
      if (settings.ttsResident !== true) { this.update('unloaded'); return; }
      let worker;
      try {
        if (!['qwen', 'kokoro'].includes(engine)) throw new Error('未知播报引擎。');
        worker = this.factory(engine, root); this.worker = worker;
        // Qwen also reports watchdog failures here, before its child exits.
        // Keep ownership so configure/close can await its idempotent shutdown.
        worker.onExit = error => { if (this.worker === worker) this.update('error', error.message); };
        this.update('loading');
        await worker.load();
        if (revision === this.revision && this.worker === worker) this.update('ready');
      } catch (error) {
        if (revision !== this.revision) return;
        this.worker = null;
        if (worker) {
          this.retire(worker);
          try { await this.teardown; }
          catch (closingError) { if (revision === this.revision) this.update('error', closingError.message); throw closingError; }
        }
        if (revision === this.revision) this.update('error', error.message);
      }
    })();
    this.loading = task;
    const settled = () => { if (this.loading === task) this.loading = null; };
    task.then(settled, settled);
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
  constructor(models, executable) {
    this.service = new LocalSpeech(models, { executable, retainTts: true });
    this.service.onTtsExit = error => this.onExit?.(error);
  }
  load() { return this.service.run('load-tts', {}); }
  synthesize(text, settings) { return this.service.synthesize(text, settings); }
  cancel() { return this.service.cancelTts(); }
  close() { this.service.close(); }
}
