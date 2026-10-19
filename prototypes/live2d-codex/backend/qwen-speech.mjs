import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import characters from './character-profiles.cjs';

export function qwenPython(root) {
  if (!root) return '';
  return ['python/python.exe', '.venv/Scripts/python.exe'].map(file => join(root, file)).find(existsSync) || '';
}
export function qwenAvailable(root) {
  return !!qwenPython(root) && ['models/Qwen3-TTS-12Hz-1.7B-CustomVoice/config.json',
    'models/Qwen3-TTS-12Hz-1.7B-CustomVoice/model.safetensors',
    'models/Qwen3-TTS-12Hz-1.7B-CustomVoice/speech_tokenizer/model.safetensors'].every(file => existsSync(join(root, file)));
}

export class QwenSpeech {
  constructor(root) { this.root = root; this.serial = 0; this.pending = new Map(); this.child = null; this.closing = false; this.diagnostics = ''; }
  load() {
    if (!qwenAvailable(this.root)) return Promise.reject(new Error('Qwen 资源未找到。请在语音设置中选择已有 Qwen 资源目录。'));
    const env = { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', TOKENIZERS_PARALLELISM: 'false' };
    delete env.ELECTRON_RUN_AS_NODE; delete env.PYTHONHOME; delete env.PYTHONPATH;
    for (const [key, dir] of Object.entries({ HF_HOME: 'huggingface', TORCH_HOME: 'torch', NUMBA_CACHE_DIR: 'numba', MPLCONFIGDIR: 'matplotlib', TEMP: 'temp', TMP: 'temp' })) {
      const path = join(this.root, 'cache', dir); mkdirSync(path, { recursive: true }); env[key] = path;
    }
    const child = this.child = spawn(qwenPython(this.root), ['-u', fileURLToPath(new URL('./qwen-worker.py', import.meta.url)), this.root],
      { cwd: this.root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise(resolve => child.once('close', resolve));
    child.stderr.on('data', data => { this.diagnostics = (this.diagnostics + data).slice(-3000); if (process.env.VIBE_SPEECH_DEBUG === '1') process.stderr.write(data); });
    child.stdin.on('error', () => {});
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let value; try { value = JSON.parse(line); } catch { return; }
      if (value.event === 'loading') { console.info('[speech:qwen]', value.stage); return; }
      const id = value.event === 'ready' ? 0 : value.id;
      const pending = this.pending.get(id); if (!pending) return;
      this.pending.delete(id); clearTimeout(pending.timer);
      if (value.event === 'ready') pending.resolve();
      else if (!value.ok) pending.reject(new Error(value.error || '本地语音生成失败。'));
      else {
        const bytes = Buffer.from(value.samplesBase64, 'base64');
        if (value.sampleRate !== 24000 || !bytes.length || bytes.length % 4 || bytes.length > 24000 * 120 * 4) { pending.reject(new Error('语音输出格式无效。')); return; }
        pending.resolve({ sampleRate: value.sampleRate, samples: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) });
      }
    });
    child.once('error', error => this.fail(new Error(`Qwen 未能启动：${error.message}`)));
    child.once('close', () => { this.child = null; lines.close(); this.fail(new Error(this.closing ? '语音已卸载。' : `Qwen 进程已退出。${this.diagnostics.slice(-500)}`)); });
    return this.wait(0, 180000);
  }
  wait(id, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error('本地语音处理超时。请在语音设置中重新加载后重试。');
        reject(error); this.onExit?.(error); this.close().catch(() => {});
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
  send(value) { if (!this.child || this.closing) throw new Error('语音进程未运行。'); this.child.stdin.write(JSON.stringify(value) + '\n'); }
  synthesize(text, settings) {
    if (!this.child || this.closing) return Promise.reject(new Error('语音进程未运行，请重新加载。'));
    // Longer continuous paragraphs need more time than a single sentence.
    // Keep a bounded watchdog; cancellation remains available at every token.
    const timeout = Math.min(600000, Math.max(240000, Array.from(text).length * 2500));
    const id = ++this.serial; const request = this.wait(id, timeout); this.active = { id, promise: request };
    this.send({ id, kind: 'synthesize', text, ...characters.qwenSynthesisVoice(settings) });
    request.then(() => { if (this.active?.id === id) this.active = null; }, () => { if (this.active?.id === id) this.active = null; });
    return request;
  }
  async cancel() { const active = this.active; if (!active) return; this.send({ kind: 'cancel', id: active.id }); await active.promise.catch(() => {}); }
  fail(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (!this.closing) this.onExit?.(error);
  }
  close() {
    if (this.shutdown) return this.shutdown;
    this.closing = true;
    this.shutdown = (async () => {
      const child = this.child; if (!child) return;
      this.fail(new Error('语音已卸载。'));
      // stdin EOF also terminates the worker when Electron crashes. A bounded
      // fallback handles a stuck native call, targeting only our spawned tree.
      child.stdin.end(JSON.stringify({ kind: 'shutdown' }) + '\n');
      const timer = setTimeout(() => {
        if (child.exitCode !== null) return;
        if (process.platform === 'win32' && child.pid) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
        else child.kill('SIGKILL');
      }, 5000);
      let deadline;
      try {
        await Promise.race([this.exited, new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('语音进程未能退出。请在任务管理器中关闭本应用的 Python 子进程后再升级。')), 10000);
        })]);
      } finally { clearTimeout(timer); clearTimeout(deadline); }
    })();
    return this.shutdown;
  }
}
