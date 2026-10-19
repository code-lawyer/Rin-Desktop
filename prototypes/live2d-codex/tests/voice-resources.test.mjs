import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { VoiceResources, validateResourceManifest, installResource } from '../backend/voice-resources.mjs';
import { findCodex } from '../backend/codex.mjs';
const body=Buffer.from('test-verified-resource'),sha256=createHash('sha256').update(body).digest('hex');
const manifest=()=>({format:1,version:'0.3.0',packs:['asr','kokoro','qwen'].map(id=>({id,label:id,unpackedBytes:100,required:['model/data.bin'],files:[{file:`${id}.exe`,bytes:body.length,sha256,url:`https://github.com/code-lawyer/Rin-Desktop/releases/download/v0.3.0/${id}.exe`}]}))});
async function directory(t){const base=resolve(import.meta.dirname,'../../../work/runtime/voice-resource-tests');await mkdir(base,{recursive:true});const path=await mkdtemp(join(base,'case-'));assert.ok(path.startsWith(base+sep));t.after(()=>rm(path,{recursive:true,force:true}));return path;}
async function install(_exe,path){await mkdir(join(path,'model'),{recursive:true});await writeFile(join(path,'model/data.bin'),'model');}
test('locked resources reject arbitrary hosts, traversal and duplicate components',()=>{
  for(const change of [m=>m.packs[0].files[0].url='https://example.com/asr.exe',m=>m.packs[0].required=['../outside'],m=>m.packs[0].files[0].file='../bad.exe',m=>m.packs[1].id='asr']){const m=manifest();change(m);assert.throws(()=>validateResourceManifest(m));}
});
test('verified download installs atomically and later launches reuse it',async t=>{
  const path=await directory(t);let requests=0;const r=new VoiceResources(path,manifest(),{fetch:async()=>{requests++;return new Response(body);},install,freeSpace:async()=>1e9});
  await r.start('asr');assert.equal(r.ready('asr'),true);assert.equal(r.ready('qwen'),false);assert.equal(r.state.phase,'ready');await r.start('asr');assert.equal(requests,1);
  assert.equal(await stat(join(path,'downloads/asr-0.3.0')).then(()=>true,()=>false),false);
  assert.equal(new VoiceResources(path,manifest()).ready('asr'),true);
});
test('checksum failure never runs an installer',async t=>{
  let invoked=false;const r=new VoiceResources(await directory(t),manifest(),{fetch:async()=>new Response(Buffer.alloc(body.length)),install:async()=>{invoked=true;},freeSpace:async()=>1e9});
  await assert.rejects(r.start('kokoro'),/校验/);assert.equal(invoked,false);assert.equal(r.ready('kokoro'),false);assert.equal(r.state.phase,'error');
});
test('partial download resumes with a verified Range response',async t=>{
  const path=await directory(t),cache=join(path,'downloads/asr-0.3.0');await mkdir(cache,{recursive:true});await writeFile(join(cache,'asr.exe.partial'),body.subarray(0,5));
  const r=new VoiceResources(path,manifest(),{fetch:async(_url,{headers})=>{assert.equal(headers.Range,'bytes=5-');return new Response(body.subarray(5),{status:206,headers:{'content-range':`bytes 5-${body.length-1}/${body.length}`}});},install,freeSpace:async()=>1e9});
  await r.start('asr');assert.equal(r.ready('asr'),true);
});
test('a server ignoring Range restarts instead of appending duplicate data',async t=>{
  const path=await directory(t),cache=join(path,'downloads/asr-0.3.0');await mkdir(cache,{recursive:true});await writeFile(join(cache,'asr.exe.partial'),body.subarray(0,5));
  const r=new VoiceResources(path,manifest(),{fetch:async()=>new Response(body),install,freeSpace:async()=>1e9});await r.start('asr');assert.equal(r.ready('asr'),true);
});
test('cancellation leaves no ready model and blocks concurrent downloads',async t=>{
  const r=new VoiceResources(await directory(t),manifest(),{fetch:async(_url,{signal})=>new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});if(signal.aborted)reject(signal.reason);}),install,freeSpace:async()=>1e9});
  const pending=r.start('qwen');assert.throws(()=>r.start('asr'),/已有/);r.cancel();await assert.rejects(pending,/取消/);assert.equal(r.state.phase,'cancelled');assert.equal(r.ready('qwen'),false);
});
test('low disk space fails before any network request',async t=>{
  const r=new VoiceResources(await directory(t),manifest(),{fetch:async()=>{assert.fail('must not download');},install,freeSpace:async()=>1});await assert.rejects(r.start('asr'),/空间/);
});
test('retry reuses verified cached files and frees failed extraction before checking space',async t=>{
  const path=await directory(t),cache=join(path,'downloads/asr-0.3.0'),staging=join(path,'asr-0.3.0.staging');await mkdir(cache,{recursive:true});await mkdir(staging);await writeFile(join(cache,'asr.exe'),body);
  const r=new VoiceResources(path,manifest(),{fetch:async()=>assert.fail('cache must be reused'),install,freeSpace:async()=>{assert.equal(await stat(staging).then(()=>true,()=>false),false);return 256*1024**2+100;}});
  await r.start('asr');assert.equal(r.ready('asr'),true);
});
test('partial installation is not committed as ready',async t=>{
  const r=new VoiceResources(await directory(t),manifest(),{fetch:async()=>new Response(body),install:async()=>{},freeSpace:async()=>1e9});await assert.rejects(r.start('asr'),/不完整/);assert.equal(r.ready('asr'),false);
});
test('Windows npm CLI native binary is discovered without running its cmd wrapper',async t=>{
  const path=await directory(t),bin=join(path,'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex');await mkdir(bin,{recursive:true});await writeFile(join(bin,'codex.exe'),'fixture');
  assert.equal(findCodex({PATH:path}),join(bin,'codex.exe'));assert.throws(()=>findCodex({PATH:join(path,'missing')}),/README/);
});
test('failed process termination has a deadline and cannot hang application exit',async()=>{
  const controller=new AbortController(),child=new EventEmitter();child.pid=12345;let killed=false;
  const pending=installResource('fixture.exe','unused',controller.signal,{spawnProcess:()=>child,killTree:()=>{killed=true;},abortMs:5,timeoutMs:1000});controller.abort(new Error('quit'));
  await assert.rejects(pending,error=>error.resourceProcessStillRunning===true);assert.equal(killed,true);
});
test('installer watchdog terminates an indefinitely running child',async()=>{
  const controller=new AbortController(),child=new EventEmitter();child.pid=12345;
  const pending=installResource('fixture.exe','unused',controller.signal,{spawnProcess:()=>child,killTree:()=>queueMicrotask(()=>child.emit('close',1)),abortMs:50,timeoutMs:5});
  await assert.rejects(pending,/超时/);
});
