import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, cp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectPuppetAssets, copyPuppetAssets } from '../tools/release/puppet-assets.mjs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { speechEnvelope, mouthAt, puppetPose } from '../prototypes/live2d-codex/renderer/puppet-state.mjs';
import { StillSequence } from '../prototypes/live2d-codex/renderer/still-sequence.mjs';
import { sceneMotion, blinkAt } from '../prototypes/live2d-codex/renderer/scene-motion.mjs';
import { POSE_FILES } from '../prototypes/live2d-codex/renderer/pose-assets.mjs';

test('PCM silence closes the mouth and sampled audio clock drives finite bounded openings', () => {
  const pcm = Float32Array.from({length:24000}, (_,i) => i < 12000 ? .15*Math.sin(2*Math.PI*220*i/24000) : 0);
  const envelope = speechEnvelope(pcm,24000);
  assert.ok(mouthAt(envelope,.2)>.6);assert.equal(mouthAt(envelope,.8),0);
  for(const time of [-1,NaN,Infinity,10])assert.equal(mouthAt(envelope,time),0);
  const corrupt=speechEnvelope([NaN,Infinity,-Infinity],24000);
  assert.equal(mouthAt(corrupt,0),0);
});

test('listening and narration override a saved manual gaze without overwriting it', () => {
  const p={stills:{stillPose:'window'}};
  assert.equal(puppetPose({},p,'work'),'window');
  for(const flag of ['capturing','speaking','chatVisible'])assert.equal(puppetPose({}, {...p,[flag]:true},'work'),'attention');
  assert.equal(puppetPose({status:'waiting'},p,'work'),'attention');
  assert.equal(p.stills.stillPose,'window');
});

test('obsolete prepared GPU scenes and rejected commits are disposed', async () => {
  let resolveFirst;const disposed=[],shown=[];
  const sequence=new StillSequence({load:key=>key==='work'?new Promise(r=>{resolveFirst=r;}):Promise.resolve(key),show:value=>{shown.push(value);return value!=='attention';},discard:value=>disposed.push(value)});
  const pending=sequence.select('work');sequence.select('attention');resolveFirst('work');await pending;
  assert.deepEqual(disposed,['work','attention']);assert.deepEqual(shown,['attention']);assert.equal(sequence.current,null);sequence.close();
});

test('mouth relay accepts only the chat owner, current playback and bounded levels', async () => {
  const source=await readFile(new URL('../prototypes/live2d-codex/main.cjs',import.meta.url),'utf8');
  let handler,time=100;const messages=[],chat={webContents:{}},avatar={isDestroyed:()=>false,webContents:{send:(...args)=>messages.push(args)}};
  const ctx=vm.createContext({ipcMain:{on:(_name,fn)=>{handler=fn;}},trusted:e=>e.trusted,chat,avatar,speaking:true,playbackRevision:9,Date:{now:()=>time}});
  vm.runInContext(source.slice(source.indexOf('    let lastMouthAt ='),source.indexOf("    handler('wallpaper:control'")),ctx);
  const event={trusted:true,sender:chat.webContents};
  for(const value of [null,{revision:8,level:1},{revision:9,level:NaN},{revision:9,level:2}])handler(event,value);
  handler({...event,sender:{}},{revision:9,level:.5});handler({...event,trusted:false},{revision:9,level:.5});assert.equal(messages.length,0);
  handler(event,{revision:9,level:.5});assert.equal(messages.length,1);
  handler(event,{revision:9,level:.7});assert.equal(messages.length,1);
  time+=40;ctx.speaking=false;handler(event,{revision:9,level:1});assert.equal(messages.length,1);
});

test('a throwing wallpaper commit releases its prepared GPU scene', async () => {
  const released=[],failures=[];
  const sequence=new StillSequence({load:async key=>({key}),show:async()=>{throw new Error('commit unavailable');},discard:value=>released.push(value.key),failed:error=>failures.push(error.message)});
  await sequence.select('work');
  assert.deepEqual(released,['work']);assert.deepEqual(failures,['commit unavailable']);assert.equal(sequence.current,null);
});

test('the intact pose set preserves the original complete painting as its fallback and ships only registered assets', async () => {
  const root=new URL('../prototypes/live2d-codex/assets/scene/rin-poses/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  const files=new Set();
  for(const asset of manifest.assets) {
    assert.ok(!files.has(asset.file));files.add(asset.file);
    const bytes=await readFile(new URL(asset.file,root));assert.equal(bytes.length,asset.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
  }
  assert.deepEqual([...files].sort(),[...POSE_FILES].sort());
  assert.equal(manifest.assets.find(a=>a.file==='scene.png').sha256,'3fd4964e96eb7d1b9bf6bf7ed753ef24df260cc8e62abf3a668bc7dbec942313','preserve the accepted full-painting source, including seat contacts');
  assert.deepEqual(manifest.sourceSize,[3840,2400]);
  assert.deepEqual(manifest.poseSize,[1586,992]);
});

test('idle motion is bounded, blinks return fully open and reduced motion stops the idle effects', () => {
  for(let time=0;time<40;time+=.03) {
    const state=sceneMotion(time,{mouth:3});
    assert.ok(state.blink>=0&&state.blink<=1);assert.ok(Math.abs(state.breath)<=2.1);
    assert.ok(Math.abs(state.hair)<=1.65);assert.ok(Math.abs(state.nod)<=.0022);assert.equal(state.mouth,1);
  }
  assert.equal(blinkAt(0),0);assert.equal(blinkAt(2.3),1);assert.equal(blinkAt(2.5),0);
  const reduced=sceneMotion(2.3,{mouth:.6,reduced:true});
  assert.deepEqual([reduced.blink,reduced.breath,reduced.hair,reduced.nod,reduced.mouth],[0,0,0,0,.6]);
  assert.equal(sceneMotion(1,{mouth:NaN}).mouth,0);
});

test('packaging rejects corrupt or escaped assets and copies only the runtime allowlist', async t => {
  const dir=await mkdtemp(join(tmpdir(),'rin-assets-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const source=join(dir,'source'),destination=join(dir,'package');
  await cp(new URL('../prototypes/live2d-codex/assets/scene/rin-poses/',import.meta.url),source,{recursive:true});
  await writeFile(join(source,'private-generation.json'),'private');
  await copyPuppetAssets(source,destination);
  await assert.rejects(access(join(destination,'private-generation.json')));
  const file=join(source,'manifest.json'),original=await readFile(file,'utf8'),manifest=JSON.parse(original);
  manifest.assets[0].file='../private-generation.json';await writeFile(file,JSON.stringify(manifest));
  await assert.rejects(inspectPuppetAssets(source),/Invalid Rin asset/);
  await writeFile(file,original);await writeFile(join(source,'scene.png'),'broken');
  await assert.rejects(inspectPuppetAssets(source),/integrity mismatch/);
});
