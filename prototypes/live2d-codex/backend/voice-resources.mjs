import { EventEmitter } from 'node:events';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open, rename, rm, stat, statfs, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { prepareQwenRuntime } from './voice-runtime.mjs';

export const MODEL_FOLDERS = { asr: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17', kokoro: 'kokoro-int8-multi-lang-v1_1' };
const sources = { asr:'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', kokoro:'csukuangfj/kokoro-int8-multi-lang-v1_1', qwen:'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice' };
const modelDirectory = id => MODEL_FOLDERS[id] || 'models/Qwen3-TTS-12Hz-1.7B-CustomVoice';
const safePath = value => typeof value === 'string' && !!value && !/[\\:\x00-\x1f<>"|?*]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));
const validFile = file => safePath(file.file) && /^[a-f0-9]{64}$/.test(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes >= 0;
export function validateResourceManifest(manifest) {
  if (manifest?.format !== 2 || !/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.packs?.length !== 3) throw new Error('语音资源清单无效。');
  const found = new Set();
  for (const pack of manifest.packs) {
    if (!sources[pack.id] || found.has(pack.id) || pack.repo !== sources[pack.id] || !/^[a-f0-9]{40}$/.test(pack.revision) || pack.modelDirectory !== modelDirectory(pack.id) || !Number.isSafeInteger(pack.unpackedBytes) || pack.unpackedBytes <= 0 || !pack.files?.length || !pack.required?.length) throw new Error('语音资源定义无效。');
    found.add(pack.id); const names = new Set();
    for (const file of pack.files) {
      const expected = safePath(file.path) && `https://huggingface.co/${pack.repo}/resolve/${pack.revision}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
      if (!validFile(file) || names.has(file.file) || file.file !== `${pack.modelDirectory}/${file.path}` || file.url !== expected) throw new Error('模型下载地址或校验信息无效。');
      names.add(file.file);
    }
    if (pack.required.some(file => !safePath(file))) throw new Error('语音资源路径无效。');
    if (pack.id === 'qwen') {
      const runtime = pack.runtime;
      if (runtime?.python !== '3.12.14' || runtime.uvVersion !== '0.13.1' || runtime.files?.length !== 2 || !Number.isSafeInteger(runtime.extraDiskBytes) || runtime.extraDiskBytes < 0) throw new Error('Qwen 运行环境定义无效。');
      const urls = {
        'bootstrap/uv.zip':'https://github.com/astral-sh/uv/releases/download/0.13.1/uv-x86_64-pc-windows-msvc.zip',
        'bootstrap/VC_redist.x64.exe':'https://download.visualstudio.microsoft.com/download/pr/ebdab8e5-1d7b-4d9f-a11b-cbb1720c3b12/843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C/VC_redist.x64.exe'
      };
      for (const file of runtime.files) {
        if (!validFile(file) || names.has(file.file) || !urls[file.file] || file.url !== urls[file.file]) throw new Error('上游运行环境地址无效。');
        names.add(file.file);
      }
    } else if (pack.runtime) throw new Error('未知语音运行环境。');
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
async function installModels(pack, cache, destination, signal, onStage, runtimeOptions) {
  for (const file of pack.files) {
    signal.throwIfAborted(); const target = join(destination,file.file);
    await mkdir(dirname(target),{recursive:true}); await copyFile(join(cache,file.file),target);
  }
  if (pack.runtime) await prepareQwenRuntime(pack,cache,destination,signal,onStage,runtimeOptions);
}

// Renderer IPC accepts a component ID, never a URL, path, shell command or package.
export class VoiceResources extends EventEmitter {
  constructor(directory, manifest, { fetch = globalThis.fetch, install, activate = async () => {}, freeSpace, runtimeEnvironment = async () => ({}) } = {}) {
    super(); this.root = resolve(directory); this.manifest = validateResourceManifest(manifest); this.fetch = fetch;
    this.install = install ?? (async (...args) => installModels(...args, { environment: args[0].runtime ? await runtimeEnvironment() : {} })); this.activate = activate;
    this.freeSpace = freeSpace ?? (async () => { const info = await statfs(this.root); return info.bavail * info.bsize; });
    this.state = { phase:'idle', id:null, received:0, total:0, error:'', stage:'', cancelable:false }; this.active = null;
  }
  pack(id) { const pack = this.manifest.packs.find(value => value.id === id); if (!pack) throw new Error('未知语音组件。'); return pack; }
  directory(id) { this.pack(id); return join(this.root,`${id}-${this.manifest.version}`); }
  ready(id, directory = this.directory(id)) { return this.pack(id).required.every(file => existsSync(join(directory,file))); }
  snapshot() { return { ...this.state, packs:this.manifest.packs.map(pack => ({ id:pack.id, label:pack.label, bytes:pack.files.reduce((sum,file)=>sum+file.bytes,0), runtimeBytes:pack.runtime?.estimatedDownloadBytes || 0, unpackedBytes:pack.unpackedBytes, installed:this.ready(pack.id) })) }; }
  update(patch) { Object.assign(this.state,patch); this.emit('state',this.snapshot()); }
  async removeOwned(path) { const actual = resolve(path); if (!actual.startsWith(this.root+sep)) throw new Error('资源清理路径无效。'); await rm(actual,{force:true,recursive:true}); }
  start(id, { existing = false } = {}) {
    this.pack(id);
    if (this.blockedError) throw this.blockedError;
    if (this.active) throw new Error('已有资源正在准备，请等待或取消。');
    const controller = new AbortController();
    this.update({id,phase:existing || this.ready(id)?'loading':'downloading',received:0,total:0,error:'',stage:'正在准备',cancelable:!existing && !this.ready(id)});
    const promise = Promise.resolve().then(async () => {
      try {
        if (!existing && !this.ready(id)) await this.download(id,controller.signal);
        controller.signal.throwIfAborted(); this.update({phase:'loading',id,stage:'正在载入模型',error:'',cancelable:false});
        await this.activate(id,controller.signal);
        controller.signal.throwIfAborted(); this.update({phase:'ready',stage:'',error:'',cancelable:false});
      } catch (error) {
        if (error.resourceProcessStillRunning) this.blockedError = error;
        this.update({phase:controller.signal.aborted?'cancelled':'error',error:error.message,cancelable:false}); throw error;
      } finally { this.active = null; }
    });
    this.active = {id,controller,promise}; return promise;
  }
  cancel() { if (this.active && this.state.cancelable) this.active.controller.abort(new Error('下载已取消，可稍后继续。')); }
  async close() { if (this.active) { this.active.controller.abort(new Error('应用正在退出。')); await this.active.promise.catch(()=>{}); } }
  async download(id, signal) {
    const pack=this.pack(id), directory=this.directory(id), staging=directory+'.staging', cache=join(this.root,'downloads',`${id}-hf-${this.manifest.version}`);
    const files=[...pack.files,...(pack.runtime?.files || [])], total=files.reduce((sum,file)=>sum+file.bytes,0);
    this.update({phase:'downloading',id,total,received:0,error:'',stage:'从上游下载模型与准备工具',cancelable:true});
    await mkdir(cache,{recursive:true}); await this.removeOwned(staging);
    const verified=new Set(); let remaining=0, completed=0;
    for (const file of files) {
      signal.throwIfAborted(); const path=join(cache,file.file);
      if (await matches(path,file)) { verified.add(file.file); completed+=file.bytes; continue; }
      await this.removeOwned(path); let partial=await stat(path+'.partial').then(value=>value.size,()=>0);
      if (partial>file.bytes) { await this.removeOwned(path+'.partial'); partial=0; }
      remaining+=file.bytes-partial;
    }
    const needed=remaining+pack.unpackedBytes+(pack.runtime?.extraDiskBytes || 0)+256*1024**2;
    if (await this.freeSpace()<needed) throw new Error(`磁盘空间不足，请预留约 ${Math.ceil(needed/1024**3)} GB。`);
    const pending=files.filter(file=>!verified.has(file.file)), offsets=new Map(), failed=new AbortController();
    const transferSignal=AbortSignal.any([signal,failed.signal]); let firstError;
    const progress=()=>this.update({received:completed+[...offsets.values()].reduce((a,b)=>a+b,0)});
    progress();
    const worker=async()=>{
      while (pending.length && !transferSignal.aborted) {
        const file=pending.shift(), destination=join(cache,file.file), partial=destination+'.partial';
        try {
          await mkdir(dirname(destination),{recursive:true});
          let offset=await stat(partial).then(value=>value.size,()=>0); offsets.set(file.file,offset);
          if (offset<file.bytes || file.bytes===0) {
            const response=await this.fetch(file.url,{signal:transferSignal,credentials:'omit',headers:offset?{Range:`bytes=${offset}-`}:{}});
            if (response.status===200) offset=0;
            else if (response.status!==206 || !offset || response.headers.get('content-range')!==`bytes ${offset}-${file.bytes-1}/${file.bytes}`) throw new Error(`下载失败（HTTP ${response.status}），请检查网络后重试。`);
            if (!response.body) throw new Error('下载没有返回数据。');
            const handle=await open(partial,offset?'a':'w'); let lastPush=0;
            try {
              for await (const chunk of response.body) {
                transferSignal.throwIfAborted();
                if (offset+chunk.length>file.bytes) throw new Error('资源大小与清单不符。');
                await handle.writeFile(chunk); offset+=chunk.length; offsets.set(file.file,offset);
                if(Date.now()-lastPush>200){progress();lastPush=Date.now();}
              }
            } finally { await handle.close(); }
          }
          if (!await matches(partial,file)) { await this.removeOwned(partial); throw new Error('模型文件校验失败，请重试。'); }
          transferSignal.throwIfAborted(); await rename(partial,destination);
          offsets.delete(file.file); completed+=file.bytes; progress();
        } catch (error) { firstError ??= error; failed.abort(error); }
      }
    };
    await Promise.all(Array.from({length:Math.min(4,pending.length)},worker));
    if (firstError) throw firstError;
    signal.throwIfAborted(); this.update({phase:'installing',received:total,stage:'校验通过，正在准备模型文件',cancelable:true});
    await mkdir(staging,{recursive:true});
    await this.install(pack,cache,staging,signal,(stage,cancelable=true)=>this.update({phase:'runtime',stage,cancelable}));
    signal.throwIfAborted(); if (!this.ready(id,staging)) throw new Error('模型或运行环境准备不完整，请重试。');
    await this.removeOwned(directory); await rename(staging,directory); await this.removeOwned(cache);
  }
}
