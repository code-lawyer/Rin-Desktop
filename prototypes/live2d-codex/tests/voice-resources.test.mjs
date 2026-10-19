import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join, resolve, sep, dirname } from 'node:path';
import { VoiceResources, validateResourceManifest } from '../backend/voice-resources.mjs';
import { readFileSync } from 'node:fs';
import { runResourceCommand, upstreamProxyEnvironment } from '../backend/voice-runtime.mjs';
import { findCodex } from '../backend/codex.mjs';
const body=Buffer.from('test-verified-resource'),sha256=createHash('sha256').update(body).digest('hex');
const template=JSON.parse(readFileSync(new URL('../voice-resources.json',import.meta.url)));
const manifest=()=>{const m=structuredClone(template);m.version='0.3.0';for(const p of m.packs){p.files=[{path:'fixture.bin',file:p.modelDirectory+'/fixture.bin',bytes:body.length,sha256,url:'https://huggingface.co/'+p.repo+'/resolve/'+p.revision+'/fixture.bin'}];p.required=[p.files[0].file];p.unpackedBytes=100;if(p.runtime){p.runtime.extraDiskBytes=0;for(const f of p.runtime.files)Object.assign(f,{bytes:body.length,sha256});}}return m;};
const fixturePath=(path)=>join(path,'downloads/asr-hf-0.3.0',manifest().packs[0].files[0].file);
async function directory(t){const base=resolve(import.meta.dirname,'../../../work/runtime/voice-resource-tests');await mkdir(base,{recursive:true});const path=await mkdtemp(join(base,'case-'));assert.ok(path.startsWith(base+sep));t.after(()=>rm(path,{recursive:true,force:true}));return path;}
async function install(pack,_cache,path){for(const f of pack.required){await mkdir(dirname(join(path,f)),{recursive:true});await writeFile(join(path,f),body);}}
test('locked resources reject arbitrary hosts, traversal and duplicate components',()=>{
  for(const change of [m=>m.packs[0].files[0].url='https://example.com/asr.exe',m=>m.packs[0].required=['../outside'],m=>m.packs[0].files[0].file='../bad.exe',m=>m.packs[1].id='asr']){const m=manifest();change(m);assert.throws(()=>validateResourceManifest(m));}
});
test('upstream setup respects explicit proxies and falls back to the desktop network choice',async()=>{
  assert.deepEqual(await upstreamProxyEnvironment(()=>assert.fail('explicit proxy must win'),{https_proxy:'http://localhost:8080'}),{});
  assert.deepEqual(await upstreamProxyEnvironment(async()=> 'DIRECT; PROXY localhost:8080',{}),{});
  assert.deepEqual(await upstreamProxyEnvironment(async url=>{assert.equal(url,'https://pypi.org/simple');return 'PROXY 127.0.0.1:10808; DIRECT';},{}),{HTTPS_PROXY:'http://127.0.0.1:10808/',HTTP_PROXY:'http://127.0.0.1:10808/'});
  assert.equal((await upstreamProxyEnvironment(async()=> 'PROXY proxy.example:80',{})).HTTPS_PROXY,'http://proxy.example/');
  assert.equal((await upstreamProxyEnvironment(async()=> 'HTTPS proxy.example:443',{})).HTTPS_PROXY,'https://proxy.example/');
  await assert.rejects(upstreamProxyEnvironment(async()=> 'PROXY user:secret@host:80',{}),/代理地址/);
});
test('verified download installs atomically and later launches reuse it',async t=>{
  const path=await directory(t);let requests=0;const r=new VoiceResources(path,manifest(),{fetch:async()=>{requests++;return new Response(body);},install,freeSpace:async()=>1e9});
  await r.start('asr');assert.equal(r.ready('asr'),true);assert.equal(r.ready('qwen'),false);assert.equal(r.state.phase,'ready');await r.start('asr');assert.equal(requests,1);
  assert.equal(await stat(join(path,'downloads/asr-hf-0.3.0')).then(()=>true,()=>false),false);
  assert.equal(new VoiceResources(path,manifest()).ready('asr'),true);
});
test('checksum failure never runs an installer',async t=>{
  let invoked=false;const r=new VoiceResources(await directory(t),manifest(),{fetch:async()=>new Response(Buffer.alloc(body.length)),install:async()=>{invoked=true;},freeSpace:async()=>1e9});
  await assert.rejects(r.start('kokoro'),/校验/);assert.equal(invoked,false);assert.equal(r.ready('kokoro'),false);assert.equal(r.state.phase,'error');
});
test('partial download resumes with a verified Range response',async t=>{
  const path=await directory(t),cache=dirname(fixturePath(path));await mkdir(cache,{recursive:true});await writeFile(fixturePath(path)+'.partial',body.subarray(0,5));
  const r=new VoiceResources(path,manifest(),{fetch:async(_url,{headers})=>{assert.equal(headers.Range,'bytes=5-');return new Response(body.subarray(5),{status:206,headers:{'content-range':`bytes 5-${body.length-1}/${body.length}`}});},install,freeSpace:async()=>1e9});
  await r.start('asr');assert.equal(r.ready('asr'),true);
});
test('a server ignoring Range restarts instead of appending duplicate data',async t=>{
  const path=await directory(t),cache=dirname(fixturePath(path));await mkdir(cache,{recursive:true});await writeFile(fixturePath(path)+'.partial',body.subarray(0,5));
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
  const path=await directory(t),cache=dirname(fixturePath(path)),staging=join(path,'asr-0.3.0.staging');await mkdir(cache,{recursive:true});await mkdir(staging);await writeFile(fixturePath(path),body);
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
  const pending=runResourceCommand('fixture.exe',[],controller.signal,{spawnProcess:()=>child,killTree:()=>{killed=true;},abortMs:5,timeoutMs:1000});controller.abort(new Error('quit'));
  await assert.rejects(pending,error=>error.resourceProcessStillRunning===true);assert.equal(killed,true);
});
test('installer watchdog terminates an indefinitely running child',async()=>{
  const controller=new AbortController(),child=new EventEmitter();child.pid=12345;
  const pending=runResourceCommand('fixture.exe',[],controller.signal,{spawnProcess:()=>child,killTree:()=>queueMicrotask(()=>child.emit('close',1)),abortMs:50,timeoutMs:5});
  await assert.rejects(pending,/超时/);
});

test('bundled catalog sends every model file directly to a pinned Hugging Face revision',()=>{
  validateResourceManifest(template);
  for(const pack of template.packs)for(const file of pack.files){assert.equal(new URL(file.url).host,'huggingface.co');assert.ok(file.url.includes('/resolve/'+pack.revision+'/'));assert.equal(file.file.endsWith('.exe'),false);}
});

test('download and activation are explicit; failed loading reuses the completed download',async t=>{
  let requests=0,loads=0;const path=await directory(t);
  const r=new VoiceResources(path,manifest(),{fetch:async()=>{requests++;return new Response(body);},install,activate:()=>{loads++;if(loads===1)throw Error('load failed');},freeSpace:async()=>1e9});
  assert.equal(requests,0);assert.equal(loads,0);assert.equal(r.state.phase,'idle');
  await assert.rejects(r.start('asr'),/load failed/);assert.equal(r.ready('asr'),true);assert.equal(r.active,null);
  await r.start('asr');assert.equal(requests,1);assert.equal(loads,2);assert.equal(r.state.phase,'ready');
});

test('an installed model keeps the operation locked until activation finishes',async t=>{
  const path=await directory(t);let release;const r=new VoiceResources(path,manifest(),{activate:()=>new Promise(resolve=>{release=resolve;})});
  const first=r.start('asr',{existing:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.state.phase,'loading');assert.throws(()=>r.start('kokoro'),/已有/);release();await first;assert.equal(r.active,null);
});

test('a failed parallel transfer drains aborted requests before allowing retry',async t=>{
  const m=manifest(),pack=m.packs[0],other={...pack.files[0],path:'second.bin',file:pack.modelDirectory+'/second.bin',url:pack.files[0].url.replace('fixture.bin','second.bin')};pack.files.push(other);
  let waiting=false,drained=false;
  const r=new VoiceResources(await directory(t),m,{fetch:async(url,{signal})=>url.endsWith('second.bin')?new Promise((_,reject)=>{waiting=true;signal.addEventListener('abort',()=>setTimeout(()=>{drained=true;reject(signal.reason);},10),{once:true});if(signal.aborted){drained=true;reject(signal.reason);}}):new Response(Buffer.alloc(body.length)),install,freeSpace:async()=>1e9});
  await assert.rejects(r.start('asr'),/校验/);assert.equal(waiting,true);assert.equal(drained,true);assert.equal(r.active,null);
});
