import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Native inference lives outside Electron's main process. Idle workers release
// model memory; cancelling synthesis cannot block microphone capture or the UI.
export class LocalSpeech {
  constructor(models, { executable = process.execPath, idleMs = 180000, retainTts = false } = {}) { this.models = models; this.executable = executable; this.idleMs = idleMs; this.retainTts = retainTts; this.workers = new Map(); this.serial = 0; }
  modelRoot(channel) { return typeof this.models === 'function' ? this.models(channel) : this.models; }
  status() { return { asr: existsSync(join(this.modelRoot('asr'), 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx')), tts: existsSync(join(this.modelRoot('tts'), 'kokoro-int8-multi-lang-v1_1/model.int8.onnx')), loaded: [...this.workers.keys()] }; }
  run(kind, data) {
    const channel = kind === 'transcribe' || kind === 'load-asr' ? 'asr' : 'tts';
    if (!this.status()[channel]) return Promise.reject(new Error('请在工作台的「壁纸与设置」中下载所需语音资源。'));
    let worker = this.workers.get(channel);
    if (worker?.pending) return Promise.reject(new Error('语音正在处理中，请稍候。'));
    if (!worker) {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const child = fork(fileURLToPath(new URL('./speech-worker.cjs', import.meta.url)), [this.modelRoot(channel)], { execPath: this.executable, execArgv: [], env, windowsHide: true, serialization: 'json', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      worker = { child, pending: null, timer: null, diagnostics: '' }; this.workers.set(channel, worker);
      child.stderr.on('data', chunk => { worker.diagnostics = (worker.diagnostics + chunk).slice(-2000); });
      const fail = error => { if (this.workers.get(channel) === worker) this.workers.delete(channel); clearTimeout(worker.timer); worker.pending?.reject(error); worker.pending = null; this.onState?.(); };
      child.on('error', fail); child.on('exit', code => { if (worker.pending) console.error('[speech:worker]', code, worker.diagnostics); fail(new Error('本地语音进程已停止，请重试。')); });
      child.on('message', response => {
        if (worker.pending?.id !== response.id) return;
        const pending = worker.pending; worker.pending = null; clearTimeout(worker.timer);
        if (response.ok && response.value.samplesBase64) { const bytes = Buffer.from(response.value.samplesBase64, 'base64'); response.value.samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)); delete response.value.samplesBase64; }
        response.ok ? pending.resolve(response.value) : pending.reject(new Error(response.error));
        if (channel !== 'tts' || !this.retainTts) { worker.timer = setTimeout(() => this.stop(channel), this.idleMs); worker.timer.unref(); }
        this.onState?.();
      });
    }
    clearTimeout(worker.timer);
    const result = new Promise((resolve, reject) => {
      const id = ++this.serial; worker.pending = { id, resolve, reject };
      worker.timer = setTimeout(() => this.stop(channel, '语音处理超时，请缩短录音或文本后重试。'), 120000);
      const payload = data.samples ? {sampleRate:data.sampleRate,samplesBase64:Buffer.from(data.samples.buffer,data.samples.byteOffset,data.samples.byteLength).toString('base64')} : data;
      worker.child.send({ id, kind, data:payload }, error => { if (error && worker.pending?.id === id) this.stop(channel, error.message); });
    });
    worker.done = result.catch(() => {}); return result;
  }
  transcribe(data) {
    if (!(data?.samples instanceof Float32Array) || !Number.isInteger(data.sampleRate) || data.sampleRate < 8000 || data.sampleRate > 96000 || data.samples.length < data.sampleRate / 5 || data.samples.length > data.sampleRate * 61 || data.samples.some(v => !Number.isFinite(v) || Math.abs(v) > 2)) throw new Error('录音应为 0.2–60 秒的有效单声道音频。');
    return this.run('transcribe', data);
  }
  synthesize(text, settings) {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('播报片段长度无效。');
    return this.run('synthesize', { text, voice: settings.voice, speed: settings.speed });
  }
  // Kokoro's native call is synchronous. Discard its result in the renderer and
  // drain that call before another utterance; keep the loaded model resident.
  async cancelTts() { await this.workers.get('tts')?.done; }
  stop(channel = 'tts', message = '已停止播报。') { const worker = this.workers.get(channel); if (!worker) return; this.workers.delete(channel); clearTimeout(worker.timer); worker.pending?.reject(new Error(message)); worker.pending = null; worker.child.kill(); this.onState?.(); }
  close() { this.stop('asr'); this.stop('tts'); }
}
