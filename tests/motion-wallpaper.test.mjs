import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MotionPlayer } from '../prototypes/live2d-codex/renderer/motion-player.mjs';
import { motionCatalog, motionTarget, MOTION_IDS } from '../prototypes/live2d-codex/renderer/motion-catalog.mjs';
import { createMotionMedia } from '../prototypes/live2d-codex/backend/motion-media.mjs';
import { acceptWallpaperReport } from '../prototypes/live2d-codex/backend/wallpaper-report.cjs';
import { WorkspaceStore } from '../prototypes/live2d-codex/backend/workspace-store.mjs';
import { StillSequence } from '../prototypes/live2d-codex/renderer/still-sequence.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const manifest = () => ({ format: 1, clips: MOTION_IDS.map(id => ({ id, file: id + '.mp4', duration: 3, fps: 24 })), posters: { work: 'work.png', user: 'user.png' } });
const gate = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(t) {
  let hold, fail, stalled = false, clock = 0;
  const visible = [], changes = [], decks = [0,1].map(index => ({
    time: 0, shown: false, running: false, disposed: false,
    async prepare(clip, _time, signal) {
      this.running = false; this.shown = false; this.clip = clip; this.time = 0;
      if (hold) { const pending = hold; hold = null; await pending.promise; }
      if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      if (fail) { fail = false; throw new Error('missing file'); }
    },
    play() { this.running = true; return Promise.resolve(); }, pause() { this.running = false; },
    async present() { if (stalled) await stalled.promise; }, seek(time) { this.time = time; return Promise.resolve(); },
    show(value) { this.shown = value; if (value) visible.push(this.clip.id); },
    watch(callback) { this.callback = callback; return () => { this.callback = null; }; },
    dispose() { this.disposed = true; this.running = false; this.shown = false; },
    end() { this.time = 3; this.onEnded?.(); }, index,
  }));
  const player = new MotionPlayer({ decks, catalog: motionCatalog(manifest()), changed: s => changes.push(s),
    now: () => clock, interval: () => 1, clear() {} });
  t.after(() => player.close());
  return { player, decks, visible, changes, async start() { player.start(); await tick(); },
    async end() { decks[player.active].end(); await tick(); }, hold() { return hold = gate(); },
    stall() { return stalled = gate(); }, unstall() { stalled = false; }, fail() { fail = true; }, advance() { clock += 13000; } };
}

test('work and user play real forward loops with both authored transitions', async t => {
  const h = fixture(t); await h.start(); await h.end();
  assert.deepEqual(h.visible, ['work-loop','work-loop']);
  h.player.setTarget('user'); await tick(); await h.end(); await h.end(); await h.end();
  assert.deepEqual(h.visible.slice(2), ['work-user','user-loop','user-loop']);
  h.player.setTarget('work'); await tick(); await h.end(); await h.end();
  assert.deepEqual(h.visible.slice(-2), ['user-work','work-loop']);
  assert.equal(h.decks.filter(deck => deck.shown).length, 1);
  assert.equal(h.player.snapshot().typing, true);
});

test('rapid requests before a turn starts discard obsolete preparation without flashing it', async t => {
  const h = fixture(t); await h.start(); const pending = h.hold();
  h.player.setTarget('user'); await tick(); h.player.setTarget('work'); await tick();
  pending.resolve(); await tick(); await h.end();
  assert.deepEqual(h.visible, ['work-loop','work-loop']);
});

test('a started turn finishes in its destination before serving the newest request', async t => {
  const h = fixture(t); await h.start(); h.player.setTarget('user'); await tick(); await h.end();
  h.player.setTarget('work'); await tick(); await h.end(); await h.end(); await h.end();
  assert.deepEqual(h.visible, ['work-loop','work-user','user-loop','user-work','work-loop']);
});

test('pause while a replacement decodes retains the visible frame; resume uses the latest intent', async t => {
  const h = fixture(t); await h.start(); const pending = h.hold();
  h.player.setTarget('user'); h.player.setPaused(true); pending.resolve(); await tick();
  assert.deepEqual(h.visible, ['work-loop']); assert.equal(h.decks.some(deck => deck.running), false);
  h.player.setTarget('work'); await tick(); h.player.setPaused(false); await h.end();
  assert.deepEqual(h.visible, ['work-loop','work-loop']);
});

test('pause during first-frame presentation cannot publish a new frame until resume', async t => {
  const h = fixture(t); await h.start(); h.player.setTarget('user'); await tick();
  const pending = h.stall(); h.decks[h.player.active].end(); await tick(); h.player.setPaused(true);
  pending.resolve(); await tick(); h.unstall();
  assert.deepEqual(h.visible, ['work-loop']);
  h.player.setPaused(false); await tick(); assert.deepEqual(h.visible, ['work-loop','work-user']);
});

test('load failure retains the character frame and stops automatic attempts until explicit retry', async t => {
  const h = fixture(t); await h.start(); h.fail(); h.player.setTarget('user'); await tick();
  assert.equal(h.player.snapshot().phase, 'error'); assert.equal(h.decks.filter(deck => deck.shown).length, 1);
  assert.equal(h.player.snapshot().typing, false); assert.deepEqual(h.visible, ['work-loop']);
  h.player.setTarget('work'); await tick(); assert.equal(h.player.snapshot().phase, 'error');
  h.player.retry(); await tick(); assert.deepEqual(h.visible, ['work-loop','work-loop']);
});

test('pause aborting an unresolved initial play releases the handoff and resumes once', async t => {
  const h=fixture(t), pending=gate(); let attempts=0;
  h.decks[0].play=()=>{attempts++;return attempts===1?pending.promise:Promise.resolve();};
  h.player.start();await tick();h.player.setPaused(true);
  pending.reject(Object.assign(new Error('pause interrupted play'),{name:'AbortError'}));await tick();
  h.player.setPaused(false);await tick();
  assert.equal(attempts,2);assert.deepEqual(h.visible,['work-loop']);assert.equal(h.player.snapshot().phase,'loop');
});

test('resume during asynchronous rewind after a paused handoff cannot leave a frozen boundary', async t => {
  const h=fixture(t);await h.start();h.player.setTarget('user');await tick();
  const presentation=h.stall(),seek=gate();
  h.decks[h.player.pending.index].seek=()=>seek.promise;
  h.decks[h.player.active].end();await tick();h.player.setPaused(true);
  presentation.resolve();await tick();h.unstall();h.player.setPaused(false);seek.resolve();await tick();
  assert.deepEqual(h.visible,['work-loop','work-user']);assert.equal(h.player.atBoundary,false);
});

test('stalled decoding reports failure and closing invalidates late preparations', async t => {
  const h = fixture(t); await h.start(); h.player.checkProgress(); h.advance(); h.player.checkProgress();
  assert.equal(h.player.snapshot().phase, 'error');
  const pending = h.hold(); h.player.retry(); h.player.close(); pending.resolve(); await tick();
  assert.deepEqual(h.visible, ['work-loop']); assert.ok(h.decks.every(deck => deck.disposed));
});

test('motion policy gives microphone and speech priority while supporting pinned auditions', () => {
  for (const property of ['capturing','speaking']) assert.equal(motionTarget({}, { [property]: true, stills: { stillPose: 'work' } }), 'user');
  assert.equal(motionTarget({status:'waiting'}, {}), 'user');
  assert.equal(motionTarget({status:'working'}, {chatVisible:true}), 'user');
  assert.equal(motionTarget({}, {stills:{stillPose:'attention'}}), 'user');
  assert.equal(motionTarget({}, {stills:{stillPose:'cup'}}), 'work');
  assert.equal(motionTarget({}, {stills:{stillPose:'work'},chatVisible:true}), 'work');
});

test('a newly painted pose clears its load failure; retained, stale and uncommitted reports cannot', () => {
  const failed = { character: 'female', requestId: 7, phase: 'error', error: 'load failed', frameRevision: 1, errorFrameRevision: 3 };
  const info = { ready: true, model: 'static-stills', wallpaperKind: 'artwork', character: 'female', requestId: 7,
    pose: 'window', activity: 'manual', frameRevision: 4, painted: true };
  const recovered = acceptWallpaperReport(failed, info, 7, 'female');
  assert.equal(recovered.phase, 'ready'); assert.equal(recovered.pose, 'window'); assert.equal(recovered.error, undefined);
  for (const patch of [{frameRevision:2},{painted:false},{requestId:6},{character:'male'},{model:'unknown'}]) {
    assert.equal(acceptWallpaperReport(failed, {...info,...patch}, 7, 'female'), failed);
  }
  assert.equal(acceptWallpaperReport(failed, info, 6, 'female'), failed);
  assert.equal(acceptWallpaperReport(failed, info, 7, 'male'), failed);
});

test('motion media streams bounded byte ranges and rejects undeclared files or incomplete sets', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rin-motion-')); t.after(() => rm(dir, {recursive:true,force:true}));
  const data = manifest(); await writeFile(join(dir,'manifest.json'), JSON.stringify(data));
  const unavailable = await createMotionMedia(dir); assert.equal(unavailable.available, false);
  for (const file of data.clips.map(clip=>clip.file).concat(Object.values(data.posters))) await writeFile(join(dir,file), '0123456789');
  const media = await createMotionMedia(dir); assert.equal(media.available, true);
  const base = 'app://local/assets/motion/female/';
  const part = await media.respond(new Request(base+'work-loop.mp4', {headers:{range:'bytes=2-5'}}));
  assert.equal(part.status, 206); assert.equal(await part.text(),'2345'); assert.equal(part.headers.get('content-range'),'bytes 2-5/10');
  assert.equal((await media.respond(new Request(base+'work-loop.mp4',{headers:{range:'bytes=99-'}}))).status,416);
  assert.equal((await media.respond(new Request(base+'secret.mp4'))).status,404);
  const head = await media.respond(new Request(base+'work-loop.mp4',{method:'HEAD'})); assert.equal(await head.text(),'');
  assert.equal(head.headers.get('content-length'),'10');
  const unsafe = manifest(); unsafe.clips[0].file='../secret.mp4'; assert.throws(()=>motionCatalog(unsafe));
});

test('motion choice persists without altering custom voices, drafts or character selection', async t => {
  const dir=await mkdtemp(join(tmpdir(),'rin-motion-settings-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new WorkspaceStore(dir); await store.load(); await store.updateSettings({qwenVoice:'Vivian',voice:48});
  const before=structuredClone(store.data); await store.updateSettings({wallpaperMotion:true});
  const reload=new WorkspaceStore(dir); await reload.load();
  assert.equal(reload.data.settings.wallpaperMotion,true);
  assert.equal(reload.data.settings.qwenVoice,before.settings.qwenVoice); assert.equal(reload.data.settings.voice,48);
  assert.deepEqual(reload.data.drafts,before.drafts); await assert.rejects(store.updateSettings({wallpaperMotion:'yes'}));
});

test('catalogue retry observes restored and damaged media without recreating the service', async t => {
  const dir=await mkdtemp(join(tmpdir(),'rin-motion-repair-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const media=await createMotionMedia(dir), base='app://local/assets/motion/female/';
  const request=()=>media.respond(new Request(base+'manifest.json'));
  assert.equal((await request()).status,503);
  const data=manifest(); await writeFile(join(dir,'manifest.json'),JSON.stringify(data));
  for(const file of data.clips.map(clip=>clip.file).concat(Object.values(data.posters)))await writeFile(join(dir,file),'0123456789');
  assert.deepEqual((await Promise.all([request(),request()])).map(response=>response.status),[200,200]);
  assert.equal(media.available,true);
  assert.equal((await media.respond(new Request(base+'work-loop.mp4'))).status,200);
  await rm(join(dir,'user-loop.mp4')); assert.equal((await request()).status,503); assert.equal(media.available,false);
  await writeFile(join(dir,'user-loop.mp4'),'repaired'); assert.equal((await request()).status,200);
  assert.equal(await (await media.respond(new Request(base+'user-loop.mp4'))).text(),'repaired');
});

test('ordinary status refreshes never retry a failed image; an explicit same-target selection can', async () => {
  let attempts=0, broken=true; const shown=[];
  const sequence=new StillSequence({load:async target=>{attempts++;if(broken)throw new Error('missing image');return target;},show:target=>shown.push(target)});
  await sequence.select('work');
  for(let i=0;i<6;i++) await sequence.setPaused(false);
  assert.equal(attempts,1);assert.deepEqual(shown,[]);
  broken=false;await sequence.select('work');assert.equal(attempts,2);assert.deepEqual(shown,['work']);sequence.close();
});
