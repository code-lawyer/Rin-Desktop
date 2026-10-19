import { EventEmitter } from 'node:events';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open, rename, rm, stat, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { spawn, execFile } from 'node:child_process';

export const MODEL_FOLDERS = { asr: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17', kokoro: 'kokoro-int8-multi-lang-v1_1' };
const ids = ['asr', 'kokoro', 'qwen'];
const filename = /^[a-zA-Z0-9._-]+$/;
export function validateResourceManifest(manifest) {
  if (manifest?.format !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.packs?.length !== 3) throw new Error('语音资源清单无效。');
  const found = new Set();
  for (const pack of manifest.packs) {
    if (!ids.includes(pack.id) || found.has(pack.id) || !Number.isSafeInteger(pack.unpackedBytes) || pack.unpackedBytes <= 0 || !pack.files?.length || !pack.required?.length) throw new Error('语音资源定义无效。');
    found.add(pack.id);
    const names = new Set();
    for (const file of pack.files) {
      if (!filename.test(file.file) || names.has(file.file) || !/\.(exe|bin)$/.test(file.file) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.url !== `https://github.com/code-lawyer/Rin-Desktop/releases/download/v${manifest.version}/${file.file}`) throw new Error('语音下载地址或校验信息无效。');
      names.add(file.file);
    }
    if (pack.files.filter(file => file.file.endsWith('.exe')).length !== 1 || pack.required.some(file => !/^[a-zA-Z0-9._/-]+$/.test(file) || file.split('/').some(part => !part || part === '..' || part === '.'))) throw new Error('语音资源路径无效。');
  }
  return manifest;
}
async function matches(path, file) {
  try {
    if ((await stat(path)).size !== file.bytes) return false;
    const hash = createHash('sha256'); for await (const bytes of createReadStream(path)) hash.update(bytes);
    return hash.digest('hex') === file.sha256;
  } catch { return false; }
}

// Only executables in the bundled, hash-locked manifest can run. Renderer IPC
// accepts a component ID, never a URL, destination or command line.
export function installResource(executable, destination, signal, { spawnProcess = spawn, killTree, timeoutMs = 30 * 60_000, abortMs = 10_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const child = spawnProcess(executable, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR=${destination}`], { windowsHide: true, stdio: 'ignore' });
    let settled = false, deadline, stopping;
    const finish = error => { if (settled) return; settled = true; clearTimeout(watchdog); clearTimeout(deadline); signal.removeEventListener('abort', abort); error ? reject(error) : resolvePromise(); };
    const stop = reason => {
      if (stopping || settled) return; stopping = reason;
      deadline = setTimeout(() => { const error = new Error('资源安装进程未能退出。请在任务管理器中结束 Rin Desktop 资源安装器，再重启应用。'); error.resourceProcessStillRunning = true; finish(error); }, abortMs);
      if (killTree) killTree(child);
      else if (process.platform === 'win32' && child.pid) execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      else child.kill();
    };
    const abort = () => stop(signal.reason);
    const watchdog = setTimeout(() => stop(new Error('资源安装超时，请检查运行库安装是否需要处理后重试。')), timeoutMs);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    child.once('error', finish);
    child.once('close', code => {
      if (stopping || signal.aborted) finish(stopping || signal.reason);
      else if (code === 0) finish();
      else finish(new Error(code === 3010 ? '运行库要求重启 Windows。重启后再次下载此组件，会复用已校验的缓存。' : `资源安装未完成（${code}）。Qwen 还需要微软 VC++ 运行库，请查看安装说明。`));
    });
  });
}

export class VoiceResources extends EventEmitter {
  constructor(directory, manifest, { fetch = globalThis.fetch, install = installResource, freeSpace } = {}) {
    super(); this.root = resolve(directory); this.manifest = validateResourceManifest(manifest); this.fetch = fetch; this.install = install;
    this.freeSpace = freeSpace ?? (async () => { const info = await statfs(this.root); return info.bavail * info.bsize; });
    this.state = { phase: 'idle', id: null, received: 0, total: 0, error: '', cancelable: false }; this.active = null;
  }
  pack(id) { const pack = this.manifest.packs.find(value => value.id === id); if (!pack) throw new Error('未知语音组件。'); return pack; }
  directory(id) { this.pack(id); return join(this.root, `${id}-${this.manifest.version}`); }
  ready(id, directory = this.directory(id)) { return this.pack(id).required.every(file => existsSync(join(directory, file))); }
  snapshot() { return { ...this.state, packs: this.manifest.packs.map(pack => ({ id: pack.id, label: pack.label, bytes: pack.files.reduce((sum, file) => sum + file.bytes, 0), unpackedBytes: pack.unpackedBytes, installed: this.ready(pack.id) })) }; }
  update(patch) { Object.assign(this.state, patch); this.emit('state', this.snapshot()); }
  async removeOwned(path) { const actual = resolve(path); if (!actual.startsWith(this.root + sep)) throw new Error('资源清理路径无效。'); await rm(actual, { force: true, recursive: true }); }
  start(id) {
    this.pack(id);
    if (this.blockedError) throw this.blockedError;
    if (this.active) throw new Error('已有资源正在下载，请等待或取消。');
    if (this.ready(id)) return Promise.resolve();
    const controller = new AbortController();
    const promise = this.download(id, controller.signal).finally(() => { this.active = null; });
    this.active = { id, controller, promise }; return promise;
  }
  cancel() { if (this.active && this.state.cancelable) this.active.controller.abort(new Error('下载已取消，可稍后继续。')); }
  async close() { if (this.active) { this.active.controller.abort(new Error('应用正在退出。')); await this.active.promise.catch(() => {}); } }
  async download(id, signal) {
    const pack = this.pack(id), directory = this.directory(id), staging = directory + '.staging', cache = join(this.root, 'downloads', `${id}-${this.manifest.version}`);
    const total = pack.files.reduce((sum, file) => sum + file.bytes, 0);
    this.update({ phase: 'downloading', id, total, received: 0, error: '', cancelable: true });
    try {
      await mkdir(cache, { recursive: true });
      await this.removeOwned(staging);
      const verified = new Set(); let remaining = 0;
      for (const file of pack.files) {
        signal.throwIfAborted(); const path = join(cache, file.file);
        if (await matches(path, file)) { verified.add(file.file); continue; }
        await this.removeOwned(path);
        let partial = await stat(path + '.partial').then(value => value.size, () => 0);
        if (partial > file.bytes) { await this.removeOwned(path + '.partial'); partial = 0; }
        remaining += file.bytes - partial;
      }
      if (await this.freeSpace() < remaining + pack.unpackedBytes + 256 * 1024 ** 2) throw new Error(`磁盘空间不足，请再预留约 ${Math.ceil((remaining + pack.unpackedBytes) / 1024 ** 3) + 1} GB。`);
      let completed = 0;
      for (const file of pack.files) {
        signal.throwIfAborted(); const destination = join(cache, file.file), partial = destination + '.partial';
        if (verified.has(file.file)) { completed += file.bytes; this.update({ received: completed }); continue; }
        let offset = await stat(partial).then(value => value.size, () => 0);
        if (offset > file.bytes) { await this.removeOwned(partial); offset = 0; }
        if (offset < file.bytes) {
          const response = await this.fetch(file.url, { signal, credentials: 'omit', headers: offset ? { Range: `bytes=${offset}-` } : {} });
          if (response.status === 200) offset = 0;
          else if (response.status !== 206 || !offset || response.headers.get('content-range') !== `bytes ${offset}-${file.bytes - 1}/${file.bytes}`) throw new Error(`下载失败（HTTP ${response.status}），请检查网络后重试。`);
          if (!response.body) throw new Error('下载没有返回数据。');
          const handle = await open(partial, offset ? 'a' : 'w'); let lastPush = 0;
          try {
            for await (const chunk of response.body) {
              signal.throwIfAborted();
              if (offset + chunk.length > file.bytes) throw new Error('资源大小与清单不符。');
              await handle.writeFile(chunk); offset += chunk.length;
              if (Date.now() - lastPush > 200) { this.update({ received: completed + offset }); lastPush = Date.now(); }
            }
          } finally { await handle.close(); }
        }
        this.update({ phase: 'verifying', cancelable: true });
        if (!await matches(partial, file)) { await this.removeOwned(partial); throw new Error('资源校验失败，请重新下载。'); }
        signal.throwIfAborted(); await this.removeOwned(destination); await rename(partial, destination);
        completed += file.bytes; this.update({ phase: 'downloading', received: completed });
      }
      signal.throwIfAborted(); this.update({ phase: 'installing', received: total, cancelable: false });
      await this.removeOwned(staging); await mkdir(staging, { recursive: true });
      await this.install(join(cache, pack.files.find(file => file.file.endsWith('.exe')).file), staging, signal);
      signal.throwIfAborted(); if (!this.ready(id, staging)) throw new Error('资源解包不完整，请重试。');
      await this.removeOwned(directory); await rename(staging, directory);
      await this.removeOwned(cache); this.update({ phase: 'ready', error: '', cancelable: false });
    } catch (error) {
      if (error.resourceProcessStillRunning) this.blockedError = error;
      this.update({ phase: signal.aborted ? 'cancelled' : 'error', error: error.message, cancelable: false }); throw error;
    }
  }
}
