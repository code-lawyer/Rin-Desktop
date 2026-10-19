import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplyAudio} from '../renderer/reply-audio.mjs';
import {speechChunks,speechText,speechProfile} from '../backend/speech-plan.mjs';
const tick = () => new Promise(resolve=>setImmediate(resolve));
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const wave = (n=1) => ({samples:new Float32Array([n,n]),sampleRate:24000});
const long = '这是一个完整的段落，用于验证所有声音都准备完成之后才允许播放。'.repeat(8);

test('whole preparation stays pending until the final segment and preserves PCM order',async()=>{
  const requests=[], gates=[], progress=[];
  const audio=new ReplyAudio({synthesize:(text,profile)=>{requests.push({text,profile});const gate=deferred();gates.push(gate);return gate.promise;},cancel:async()=>{},progress:p=>progress.push(p)});
  let ready=false;const result=audio.prepare('one',long,'fixed-profile').then(v=>{ready=true;return v;});
  const parts=speechChunks(long);assert.ok(parts.length>1);
  for(let i=0;i<parts.length;i++){await tick();assert.equal(ready,false);assert.equal(requests.length,i+1);gates[i].resolve(wave(i+1));}
  const complete=await result;assert.deepEqual([...complete.samples],parts.flatMap((_,i)=>[i+1,i+1]));
  assert.ok(requests.every(v=>v.profile==='fixed-profile'));assert.equal(progress.at(-1).completed,parts.length);
  assert.equal(await audio.prepare('one',long,'fixed-profile'),complete);assert.equal(requests.length,parts.length);
});

test('cancelled results never enter the cache and a replacement waits for worker drain',async()=>{
  const gates=[],stop=deferred();let cancels=0;
  const audio=new ReplyAudio({synthesize:()=>{const gate=deferred();gates.push(gate);return gate.promise;},cancel:()=>{cancels++;return stop.promise;}});
  const first=audio.prepare('old','旧回复。','voice');await tick();
  const rejected=assert.rejects(first,{name:'AbortError'});audio.cancel();
  const next=audio.prepare('new','新回复。','voice');await tick();assert.equal(gates.length,1);
  gates[0].resolve(wave());await rejected;await tick();assert.equal(gates.length,1);
  stop.resolve();await tick();assert.equal(gates.length,2);gates[1].resolve(wave(2));await next;
  assert.equal(audio.has('old'),false);assert.equal(audio.has('new'),true);assert.equal(cancels,1);
});

test('failure and invalid output discard the entire reply instead of caching partial speech',async()=>{
  let calls=0;const audio=new ReplyAudio({synthesize:async()=>{if(++calls===2)throw Error('段落失败');return wave();},cancel:async()=>{}});
  await assert.rejects(audio.prepare('failed',long,'voice'),/段落失败/);assert.equal(audio.has('failed'),false);
  const bad=new ReplyAudio({synthesize:async()=>({samples:[NaN],sampleRate:24000}),cancel:async()=>{}});
  await assert.rejects(bad.prepare('nan','测试。','voice'),/格式/);assert.equal(bad.bytes,0);
});

test('cache is bounded by bytes and entry count, touches LRU, and clears without keeping audio',async()=>{
  const audio=new ReplyAudio({synthesize:async()=>wave(),cancel:async()=>{},maxBytes:24,maxEntries:2});
  await audio.prepare('a','一','v');await audio.prepare('b','二','v');await audio.prepare('a','一','v');await audio.prepare('c','三','v');
  assert.deepEqual([...audio.cache.keys()],['a','c']);assert.equal(audio.bytes,16);
  audio.clear();assert.equal(audio.bytes,0);assert.equal(audio.cache.size,0);
  const tooLarge=new ReplyAudio({synthesize:async()=>wave(),cancel:async()=>{},maxBytes:12});
  await assert.rejects(tooLarge.prepare('big',long,'v'),/缓存容量/);assert.equal(tooLarge.bytes,0);
});

test('chunking retains text, groups short sentences, respects Unicode and prefers natural boundaries',()=>{
  const short='事情已经处理好了。\n请先确认项目。然后继续。';assert.deepEqual(speechChunks(short),[short]);
  for(const text of [long,'字'.repeat(700),'😀'.repeat(420),'abc word '.repeat(100),'段落。\n\n'.repeat(100)]){
    const parts=speechChunks(text);assert.equal(parts.join(''),speechText(text));assert.ok(parts.every(p=>Array.from(p).length<=180));
  }
  assert.deepEqual(speechChunks('一'.repeat(100)+'，'+'二'.repeat(100)+'。'),['一'.repeat(100)+'，','二'.repeat(100)+'。']);
  assert.deepEqual(speechChunks('![仅图片](image.png)'),[]);
});

test('voice profiles track generation choices and exclude unrelated switches',()=>{
  const settings={ttsEngine:'qwen',qwenVoice:'Serena',ttsResident:true};
  assert.equal(speechProfile(settings),speechProfile({...settings,prepareSpeech:true,autoSpeak:true}));
  assert.notEqual(speechProfile(settings),speechProfile({...settings,qwenVoice:'Vivian'}));
  assert.notEqual(speechProfile({ttsEngine:'kokoro',speed:1}),speechProfile({ttsEngine:'kokoro',speed:.9}));
});
