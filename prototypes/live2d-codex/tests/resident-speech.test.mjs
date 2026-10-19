import test from 'node:test';
import assert from 'node:assert/strict';
import { ResidentSpeech } from '../backend/resident-speech.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const workers = [];
  const speech = new ResidentSpeech('unused', { factory: () => {
    const ready = deferred(), generation = deferred();
    const worker = {ready, generation, loads:0, closes:0, cancels:0,
      load(){ this.loads++; return ready.promise; }, synthesize(){return generation.promise;},
      async cancel(){this.cancels++; generation.reject(new Error('cancelled'));},
      async close(){this.closes++; ready.reject(new Error('closed')); generation.reject(new Error('closed'));}
    };
    // A test may unload before ever requesting audio.
    generation.promise.catch(()=>{}); ready.promise.catch(()=>{}); workers.push(worker); return worker;
  }});
  return { speech, workers };
}
const enabled = {ttsResident:true,ttsEngine:'qwen',autoSpeak:false,qwenVoice:'Serena'};

test('startup stays unloaded, synthesis cannot silently allocate a model, and explicit load is reused',async () => {
  const {speech,workers}=fixture(); await speech.configure({...enabled,ttsResident:false});
  assert.equal(workers.length,0); assert.equal(speech.status().phase,'unloaded');
  await assert.rejects(speech.synthesize('你好'),/未加载/);
  const loading=speech.configure(enabled); await tick(); assert.equal(speech.status().phase,'loading');
  workers[0].ready.resolve(); await loading;
  await speech.configure({...enabled,qwenVoice:'Vivian'}); assert.equal(workers.length,1); assert.equal(workers[0].loads,1);
  assert.equal(speech.status().phase,'ready'); await speech.close(); assert.equal(workers[0].closes,1); assert.equal(speech.status().phase,'unloaded');
});

test('stop cancels synthesis while preserving model residency; disable destroys the worker',async () => {
  const {speech,workers}=fixture(); const loading=speech.configure(enabled); await tick(); workers[0].ready.resolve(); await loading;
  const result=speech.synthesize('朗读这一条'); const rejected=assert.rejects(result,/cancelled/);
  assert.equal(speech.status().phase,'generating'); await speech.stop(); await rejected;
  assert.equal(workers[0].closes,0); assert.equal(speech.status().phase,'ready');
  await speech.configure({...enabled,ttsResident:false}); assert.equal(workers[0].closes,1); assert.equal(speech.status().phase,'unloaded');
});

test('disabling during load cannot resurrect a stale worker, including rapid off/on switches',async () => {
  const {speech,workers}=fixture(); const first=speech.configure(enabled); await tick();
  const off=speech.configure({...enabled,ttsResident:false}); const on=speech.configure({...enabled,ttsEngine:'kokoro'});
  await tick(); assert.equal(workers[0].closes,1); assert.equal(workers.length,2);
  workers[1].ready.resolve(); await Promise.all([first,off,on]);
  assert.equal(speech.status().engine,'kokoro'); assert.equal(speech.status().phase,'ready'); await speech.close();
});

test('load failure is visible and can be explicitly retried without affecting ASR',async () => {
  const {speech,workers}=fixture(); speech.asr.transcribe=async()=>({text:'独立听写'});
  const first=speech.configure(enabled); await tick(); workers[0].ready.reject(new Error('CUDA unavailable')); await first;
  assert.equal(speech.status().phase,'error'); assert.match(speech.status().error,/CUDA/); assert.equal(workers[0].closes,1);
  assert.deepEqual(await speech.transcribe({}),{text:'独立听写'});
  const retry=speech.configure(enabled); await tick(); workers[1].ready.resolve(); await retry; assert.equal(speech.status().phase,'ready'); await speech.close();
});
