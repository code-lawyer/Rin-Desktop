import test from 'node:test';
import assert from 'node:assert/strict';
import { StillSequence } from '../prototypes/live2d-codex/renderer/still-sequence.mjs';
import { ambientLevels, AmbientPreview, AMBIENT_DEFAULTS } from '../prototypes/live2d-codex/renderer/ambient-preview.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createStillServer } from '../tools/project/preview-stills.mjs';
import { launchPlan } from '../tools/project/start.mjs';
import stillSettings from '../prototypes/live2d-codex/backend/still-settings.cjs';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(extra = {}) {
  const shown = [], errors = [];
  const seq = new StillSequence({ load: async id => id, show: async (_image,id) => shown.push(id), failed: error => errors.push(error), ...extra });
  return { seq, shown, errors };
}
test('failed target retains the current 4K picture; retry cuts directly to the decoded original', async () => {
  let broken = false; const {seq,shown,errors}=fixture({load:async id=>{if(broken&&id==='attention')throw new Error('bad image');return id;}});
  await seq.select('work');broken=true;await seq.select('attention');
  assert.deepEqual(shown,['work']);assert.equal(errors.length,1);assert.equal(seq.current,'work');
  broken=false;await seq.select('attention');assert.deepEqual(shown,['work','attention']);
});

test('rejected presentation retains the visible frame and retries the same decoded target', async () => {
  let accepted = false; const shown = [];
  const seq = new StillSequence({ load: async target => target, show: async image => {
    if (image === 'attention' && !accepted) return false;
    shown.push(image);
  } });
  await seq.select('work'); await seq.select('attention');
  assert.equal(seq.current, 'work'); assert.deepEqual(shown, ['work']);
  accepted = true; await seq.select('attention'); assert.deepEqual(shown, ['work', 'attention']);
});

test('a rejected old presentation does not swallow a newer requested pose', async () => {
  const gate = deferred(), shown = [];
  const seq = new StillSequence({ load: async target => target, show: async image => {
    if (image === 'attention') return gate.promise;
    shown.push(image);
  } });
  await seq.select('work'); const pending = seq.select('attention'); await tick(); seq.select('work');
  gate.resolve(false); await pending; assert.equal(seq.current, 'work'); assert.deepEqual(shown, ['work']);
});
test('new intent wins while an old image is decoding, including a rejected obsolete request', async () => {
  const old=deferred();const {seq,shown,errors}=fixture({load:id=>id==='attention'?old.promise:Promise.resolve(id)});
  await seq.select('work');const pending=seq.select('attention');await tick();seq.select('work');old.reject(new Error('obsolete'));await pending;
  assert.deepEqual(shown,['work']);assert.equal(errors.length,0);assert.equal(seq.current,'work');
});
test('pause during decode holds the visible original, then resumes the latest target', async () => {
  const decoded=deferred();const {seq,shown}=fixture({load:id=>id==='attention'?decoded.promise:Promise.resolve(id)});
  await seq.select('work');const pending=seq.select('attention');await tick();await seq.setPaused(true);decoded.resolve('attention');await pending;
  assert.deepEqual(shown,['work']);await seq.setPaused(false);assert.deepEqual(shown,['work','attention']);
});
test('pause holds images and resumes only the latest requested pose', async () => {
  const {seq,shown}=fixture();await seq.select('work');await seq.setPaused(true);
  await seq.select('attention');await seq.select('work');await seq.select('attention');assert.deepEqual(shown,['work']);
  await seq.setPaused(false);assert.deepEqual(shown,['work','attention']);
});
test('closing during decode cannot display an image or report a false failure', async () => {
  const pending=deferred();const {seq,shown,errors}=fixture({load:()=>pending.promise});
  const run=seq.select('work');seq.close();pending.resolve('work');await run;
  assert.deepEqual(shown,[]);assert.deepEqual(errors,[]);
});
test('an unpaused state notification immediately followed by a new choice cannot swallow the load', async () => {
  const {seq,shown}=fixture();await seq.select('work');
  seq.setPaused(false);await seq.select('attention');
  assert.deepEqual(shown,['work','attention']);
});
test('capture, hidden and pause override both ambience channels, including after speaking ends', () => {
  const normal={enabled:true,pose:'work',rainVolume:.5,keyVolume:.3};
  assert.deepEqual(ambientLevels(normal),{rain:.5,keys:.3});
  assert.deepEqual(ambientLevels({...normal,speaking:true}),{rain:.1,keys:0});
  for(const flag of ['capturing','paused','hidden'])for(const speaking of [true,false])assert.deepEqual(ambientLevels({...normal,[flag]:true,speaking}),{rain:0,keys:0});
  assert.equal(ambientLevels({...normal,pose:'attention'}).keys,0);
  assert.deepEqual(ambientLevels({...normal,enabled:false}),{rain:0,keys:0});
  assert.deepEqual(ambientLevels({enabled:true,pose:'work'}),{rain:AMBIENT_DEFAULTS.rainVolume,keys:AMBIENT_DEFAULTS.keyVolume});
});
test('source launch rejects retired video flags and retains the artwork entry', () => {
  assert.throws(()=>launchPlan(['--wallpaper=video']),/retired/);
  assert.throws(()=>launchPlan(['--video-media=example']),/Unknown option/);
  assert.ok(launchPlan(['--wallpaper=artwork']).args.includes('--wallpaper=artwork'));
});
test('audition server exposes only preview routes and no private workspace files', async t => {
  const server=createStillServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const page=await fetch(origin);assert.equal(page.status,200);const html=await page.text();assert.match(html,/模拟听写静音/);assert.doesNotMatch(html,/id="bridge"|id="incoming"/);
  for(const path of ['/../package.json','/work/runtime/avatar/workspaces.json','/media/%2e%2e%2fpackage.json','/renderer/app.js','/media/lift.png'])assert.equal((await fetch(origin+path)).status,404);
  for(const name of ['light-rain','soft-keyboard']){const audio=await fetch(`${origin}/media/${name}.ogg`);assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/ogg');assert.equal(Buffer.from(await audio.arrayBuffer()).subarray(0,4).toString(),'OggS');}
  for(const pose of stillSettings.POSES) { const frame=await fetch(`${origin}/media/${pose}.png`);assert.equal(frame.status,200);assert.equal(frame.headers.get('content-type'),'image/png'); }
  assert.equal((await fetch(origin+'/media/reading.png')).status,404);
  assert.equal((await fetch(origin,{method:'POST'})).status,405);
});

test('scene repair preview is opt-in and keeps media access inside its explicit allowlist', async t => {
  const server=createStillServer({scene:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  assert.match(await(await fetch(origin)).text(),/场景一致性修订/);
  for(const path of ['/media/scene.png','/media/thinking.png','/media/original/thinking.png'])assert.equal((await fetch(origin+path)).status,200);
  for(const path of ['/work/runtime/avatar/workspaces.json','/media/../manifest.json','/media/%2e%2e%2fpackage.json','/renderer/app.js'])assert.equal((await fetch(origin+path)).status,404);
  assert.equal((await fetch(origin,{method:'POST'})).status,405);
  const ordinary=createStillServer();await new Promise(resolve=>ordinary.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{ordinary.closeAllConnections();ordinary.close(resolve);}));
  assert.equal((await fetch(`http://127.0.0.1:${ordinary.address().port}/media/scene.png`)).status,404);
});

test('all five active female frames exist at a uniform source size and match their asset manifest', async () => {
  const base=new URL('../prototypes/live2d-codex/assets/stills/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  assert.equal(manifest.active.female,'female-v2-4k');
  const entries=manifest.images.filter(item=>item.file.startsWith('female-v2-4k/'));
  assert.deepEqual(entries.map(item=>item.file.split('/')[1].slice(0,-4)).sort(),[...stillSettings.POSES].sort());
  const sizes=new Set();
  for(const entry of entries) {
    const data=await readFile(new URL(entry.file,base));
    assert.equal(data.length,entry.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),entry.sha256);
    assert.equal(data.readUInt32BE(16),entry.width);assert.equal(data.readUInt32BE(20),entry.height);
    sizes.add(`${entry.width}x${entry.height}`);
  }
  assert.equal(sizes.size,1);
  assert.ok(sizes.has('3840x2400'));
  assert.equal(new Set(entries.map(item=>item.sha256)).size,5);
});

function audioFixture(fetcher) {
  const started=[],gains=[];
  const context={currentTime:0,destination:{},resume:async()=>{},close:async()=>{},decodeAudioData:async()=>({duration:60}),
    createGain(){const gain={value:0,cancelAndHoldAtTime(){},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;}};gains.push(gain);return {gain,connect(){},disconnect(){}};},
    createBufferSource(){return {connect(){},disconnect(){},start(...args){this.args=args;started.push(this);},stop(){this.stopped=true;this.onended?.();}};},
  };
  const fetchOk=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});
  const audio=new AmbientPreview({contextFactory:()=>context,fetcher:fetcher||fetchOk,random:()=>0});
  audio.update({pose:'work',...AMBIENT_DEFAULTS});
  return {audio,context,started,gains,fetchOk};
}
test('disabling while recordings load prevents late playback; next enable reuses one rain loop', async t=>{
  const loading=deferred(),{audio,started,fetchOk}=audioFixture(()=>loading.promise);t.after(()=>audio.close());
  const pending=audio.enable();audio.update({enabled:false});loading.resolve(await fetchOk());assert.equal(await pending,false);assert.equal(started.length,0);assert.equal(audio.timers.size,0);
  assert.equal(await audio.enable(),true);await audio.enable();assert.equal(started.length,1);assert.equal(audio.timers.size,1);
});
test('capture and pause still mute when an outstanding sound load finishes', async t=>{
  const loading=deferred(),{audio,gains,fetchOk}=audioFixture(()=>loading.promise);t.after(()=>audio.close());
  const pending=audio.enable();audio.update({capturing:true});loading.resolve(await fetchOk());await pending;
  assert.equal(gains[0].value,0);assert.equal(gains[1].value,0);assert.equal(audio.timers.size,0);
  audio.update({paused:true,capturing:false});assert.equal(audio.timers.size,0);
  audio.update({paused:false});assert.equal(audio.timers.size,1);
  audio.clearKeys();audio.playKeys();const active=[...audio.sources];audio.update({pose:'attention'});
  assert.ok(active.every(source=>source.stopped));assert.equal(audio.timers.size,0);assert.equal(gains[1].value,0);
});
test('failed recordings stay silent and can retry; closing during load never starts playback', async t=>{
  let broken=true;const {audio,started,fetchOk}=audioFixture(async()=>broken?{ok:false}:fetchOk());t.after(()=>audio.close());
  await assert.rejects(audio.enable(),/载入/);assert.equal(started.length,0);assert.equal(audio.state.enabled,false);
  broken=false;await audio.enable();assert.equal(started.length,1);
  const loading=deferred(),other=audioFixture(()=>loading.promise);const pending=other.audio.enable();await other.audio.close();loading.resolve(await fetchOk());assert.equal(await pending,false);assert.equal(other.started.length,0);
});
test('bundled ambience files match their source manifest and all keyboard phrases fit', async()=>{
  const base=new URL('../prototypes/live2d-codex/assets/ambience/',import.meta.url),manifest=JSON.parse(await readFile(new URL('sources.json',base),'utf8'));
  for(const recording of manifest.recordings){const data=await readFile(new URL(recording.file,base));assert.equal(data.length,recording.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),recording.sha256);assert.equal(recording.license,'CC0-1.0');}
  const keys=manifest.recordings.find(item=>item.file==='soft-keyboard.ogg');
  for(const [start,duration] of manifest.keyboardClips)assert.ok(start>=0&&duration>0&&start+duration<=keys.duration);
});
