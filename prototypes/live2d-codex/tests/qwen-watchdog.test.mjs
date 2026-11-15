import test from 'node:test';
import assert from 'node:assert/strict';
import {QwenSpeech, qwenPython, qwenAvailable} from '../backend/qwen-speech.mjs';
import {mkdir, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import {ResidentSpeech} from '../backend/resident-speech.mjs';

test('Qwen watchdog marks the resident service unusable instead of returning a dead worker to ready',async()=>{
  const worker=new QwenSpeech('unused');let closed=false;
  worker.load=async()=>{};worker.close=async()=>{closed=true;};worker.synthesize=()=>worker.wait(1,5);
  const service=new ResidentSpeech('unused',{factory:()=>worker});
  await service.configure({ttsResident:true,ttsEngine:'qwen'});
  await assert.rejects(service.synthesize('测试。'),/超时/);
  assert.equal(closed,true);assert.equal(service.status().phase,'error');assert.equal(service.worker,worker);
  await service.close();assert.equal(service.worker,null);
});

for (const operation of ['close', 'reload']) test(`watchdog service ${operation} waits for the owned Qwen worker to exit`, async t => {
  const gate = Promise.withResolvers(), worker = new QwenSpeech('unused');
  let closing = false, exited = false, loads = 0, completed = false;
  worker.load = async () => {};
  worker.synthesize = () => worker.wait(1, 5);
  worker.close = () => { closing = true; return gate.promise.then(() => { exited = true; }); };
  const service = new ResidentSpeech('unused', { factory: () => ++loads === 1 ? worker : { load: async () => {}, close: async () => {} } });
  t.after(async () => { gate.resolve(); await service.close(); });
  const settings = { ttsResident: true, ttsEngine: 'qwen' };
  await service.configure(settings);
  await assert.rejects(service.synthesize('timeout'), /超时/);
  const task = (operation === 'close' ? service.close() : service.configure(settings)).then(() => { completed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closing, true); assert.equal(completed, false); assert.equal(exited, false); assert.equal(loads, 1);
  gate.resolve(); await task;
  assert.equal(exited, true); assert.equal(loads, operation === 'close' ? 1 : 2);
});

test('failed watchdog teardown rejects service close and blocks subsequent model allocation', async () => {
  let loads = 0;
  const worker = new QwenSpeech('unused'); worker.load = async () => { loads++; };
  worker.close = async () => { throw new Error('owned child did not exit'); };
  worker.synthesize = () => worker.wait(1, 5);
  const service = new ResidentSpeech('unused', { factory: () => worker });
  const settings = { ttsResident: true, ttsEngine: 'qwen' };
  await service.configure(settings); await assert.rejects(service.synthesize('timeout'), /超时/);
  await assert.rejects(service.close(), /did not exit/);
  await assert.rejects(service.configure(settings), /did not exit/);
  assert.equal(loads, 1); assert.equal(service.status().phase, 'error');
});

test('a confirmed late child exit permits reload after a rejected shutdown deadline', async () => {
  const exited = Promise.withResolvers(); let allocations = 0;
  const worker = { load() {}, close() { throw new Error('child still running'); }, exited: exited.promise };
  const service = new ResidentSpeech('unused', { factory: () => ++allocations === 1 ? worker : { load() {}, close() {} } });
  const settings = { ttsResident: true, ttsEngine: 'qwen' };
  await service.configure(settings);
  await assert.rejects(service.close(), /still running/);
  await assert.rejects(service.configure(settings), /still running/);
  assert.equal(allocations, 1);
  exited.resolve(); await new Promise(resolve => setImmediate(resolve));
  await service.configure(settings); assert.equal(allocations, 2); assert.equal(service.phase, 'ready');
  await service.close(); assert.equal(service.phase, 'unloaded');
});

test('unloaded Qwen rejects synthesis without creating a dangling timed request',async()=>{
  const worker=new QwenSpeech('unused');await assert.rejects(worker.synthesize('测试。',{}),/重新加载/);
  assert.equal(worker.pending.size,0);
});

test('portable Qwen works without the original virtual environment and prefers its own interpreter',async t=>{
  const base=resolve(import.meta.dirname,'../../../work/qa/qwen-portable'); await mkdir(base,{recursive:true});
  const root=await mkdtemp(join(base,'case-')); assert.ok(root.startsWith(base+sep));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const file of ['python/python.exe','.venv/Scripts/python.exe','models/Qwen3-TTS-12Hz-1.7B-CustomVoice/config.json','models/Qwen3-TTS-12Hz-1.7B-CustomVoice/model.safetensors','models/Qwen3-TTS-12Hz-1.7B-CustomVoice/speech_tokenizer/model.safetensors']){
    const dest=join(root,file); await mkdir(resolve(dest,'..'),{recursive:true}); await writeFile(dest,'fixture');
  }
  assert.equal(qwenPython(root),join(root,'python/python.exe')); assert.equal(qwenAvailable(root),true);
  await rm(join(root,'models/Qwen3-TTS-12Hz-1.7B-CustomVoice/model.safetensors'));
  assert.equal(qwenAvailable(root),false);
});

test('worker shutdown has a deadline even when graceful exit and kill fail',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const worker=new QwenSpeech('unused'); let killed=false;
  worker.child={stdin:{end(){}},exitCode:null,kill(){killed=true;}};
  worker.exited=new Promise(()=>{});
  const closing=worker.close(); const rejected=assert.rejects(closing,/未能退出/);
  t.mock.timers.tick(10001); await rejected;
  assert.equal(killed,true); assert.equal(worker.close(),closing);
});
