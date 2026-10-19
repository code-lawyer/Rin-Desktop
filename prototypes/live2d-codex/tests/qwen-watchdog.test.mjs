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
  assert.equal(closed,true);assert.equal(service.status().phase,'error');assert.equal(service.worker,null);
});

test('unloaded Qwen rejects synthesis without creating a dangling timed request',async()=>{
  const worker=new QwenSpeech('unused');await assert.rejects(worker.synthesize('测试。',{}),/重新加载/);
  assert.equal(worker.pending.size,0);
});

test('portable Qwen works without the original virtual environment and prefers its own interpreter',async t=>{
  const base=resolve(import.meta.dirname,'../../../work/test-qwen-portable'); await mkdir(base,{recursive:true});
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
