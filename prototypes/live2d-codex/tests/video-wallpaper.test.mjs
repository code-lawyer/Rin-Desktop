import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createVideoMedia } from '../backend/video-media.mjs';
import { WorkspaceStore } from '../backend/workspace-store.mjs';
import choices from '../backend/wallpaper-choice.cjs';
import { videoScene, videoAnchor } from '../renderer/video-state.mjs';

async function fixture(t) {
  const base = resolve(tmpdir()), dir = await mkdtemp(join(base, 'rin-video-desktop-'));
  t.after(async () => { assert.ok(dir.startsWith(base + sep)); await rm(dir, { recursive: true, force: true }); }); return dir;
}
test('video state follows work, approvals and chat without treating idle as active work', () => {
  assert.equal(videoScene({status:'idle'}, {}), 'idle');
  assert.equal(videoScene({status:'idle'}, {chatVisible:true}), 'attention');
  for (const status of ['starting','working','stopping']) assert.equal(videoScene({status}, {chatVisible:true}), 'focus');
  for (const status of ['waiting','error']) assert.equal(videoScene({status}, {chatVisible:false}), 'attention');
  assert.equal(videoScene({connection:'error',status:'working'}, {}), 'attention');
  assert.equal(videoScene({status:'working'}, {videoScene:'idle'}), 'idle');
  assert.equal(videoScene({status:'working'}, {videoScene:'unknown'}), 'focus');
});
test('video anchor uses uniform scaling and remains a valid bubble anchor on wide and tall screens', () => {
  for(const [width,height] of [[1920,1080],[3840,2400],[3440,1440],[800,1280]]) {
    const a=videoAnchor(width,height);assert.ok(a.left<=a.x && a.x<=a.right);
    for(const n of Object.values(a))assert.ok(n>=0 && n<=1);
  }
  assert.equal(videoAnchor(1920,1080).x,.68);
});
test('wallpaper requests are validated before they can change character or voices', () => {
  const settings={character:'male',wallpaperKind:'artwork'};
  assert.throws(()=>choices.wallpaperChoice({wallpaperKind:'video'},settings));
  assert.deepEqual(choices.wallpaperChoice({wallpaperKind:'artwork'},settings),{character:'male',wallpaperKind:'artwork'});
  assert.deepEqual(choices.wallpaperChoice({character:'male'},settings),{character:'male',wallpaperKind:'artwork'});
  assert.equal(choices.wallpaperChoice({speed:1.1},settings),null);
  for(const patch of [{wallpaperKind:'remote'},{character:'male',wallpaperKind:'video'},{character:'unknown'}])assert.throws(()=>choices.wallpaperChoice(patch,settings));
  assert.equal(settings.character,'male');
});
test('artwork restores preserve settings and reject retired video selections atomically', async t => {
  const directory=await fixture(t),store=new WorkspaceStore(directory);await store.load();
  await store.updateSettings({character:'male',ttsResident:true,autoSpeak:true,playbackVolume:.6,speed:1.1});
  const remote=structuredClone(store.data.settings.remoteKeys);
  await store.updateSettings({character:'female',wallpaperKind:'artwork'});
  const s=store.data.settings;assert.equal(s.qwenVoice,'Serena');assert.equal(s.voice,3);
  assert.equal(s.ttsResident,true);assert.equal(s.autoSpeak,true);assert.equal(s.playbackVolume,.6);assert.equal(s.speed,1.1);assert.deepEqual(s.remoteKeys,remote);
  await store.updateSettings({qwenVoice:'Vivian',voice:7});await store.updateSettings({character:'female',wallpaperKind:'artwork'});
  assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,7);
  const before=store.snapshot();await assert.rejects(store.updateSettings({wallpaperKind:'video'}));assert.deepEqual(store.snapshot(),before);
  const restored=new WorkspaceStore(directory);await restored.load();assert.equal(restored.data.settings.wallpaperKind,'artwork');
  assert.equal(restored.data.settings.qwenVoice,'Vivian');assert.equal(restored.data.settings.voice,7);
});
test('female video settings migrate to artwork without resetting custom voices or drafts', async t => {
  const directory=await fixture(t),saved={format:1,projects:[],drafts:{'example|new':{text:'保留草稿'}},settings:{character:'female',wallpaperKind:'video',qwenVoice:'Vivian',voice:7,playbackVolume:.4}};
  const file=join(directory,'workspaces.json');await writeFile(file,JSON.stringify(saved));
  const store=new WorkspaceStore(directory);await store.load();
  assert.equal(store.data.settings.wallpaperKind,'artwork');assert.equal(store.data.settings.character,'female');
  assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,7);assert.equal(store.data.settings.playbackVolume,.4);
  assert.equal(store.draft({cwd:'example',threadId:null}),'保留草稿');assert.equal(JSON.parse(await readFile(file,'utf8')).settings.wallpaperKind,'video','Read migration does not overwrite original user file');
});
test('legacy settings default to artwork and cannot restore video with the male character', async t => {
  const directory=await fixture(t);
  await writeFile(join(directory,'workspaces.json'),JSON.stringify({format:1,projects:[],drafts:{},settings:{character:'male',wallpaperKind:'video',qwenVoice:'Uncle_Fu',voice:60}}));
  const store=new WorkspaceStore(directory);await store.load();assert.equal(store.data.settings.wallpaperKind,'artwork');assert.equal(store.data.settings.qwenVoice,'Uncle_Fu');
});
test('desktop custom protocol streams ranges from the media allowlist and responds to missing files', async t => {
  const directory=await fixture(t),scenes=['idle','focus','attention'].map(id=>({id,file:id+'.webm',poster:id+'.jpg',fps:30,loopStart:0,loopEnd:1}));
  for(const s of scenes)for(const name of [s.file,s.poster])await writeFile(join(directory,name),'0123456789');
  await writeFile(join(directory,'manifest.json'),JSON.stringify({version:1,scenes}));
  const media=await createVideoMedia(directory);assert.equal(media.available,true);
  const get=(path,init)=>media.respond(new Request('app://local/video/'+path,init));
  const r=await get('idle.webm',{headers:{Range:'bytes=3-6'}});assert.equal(r.status,206);assert.equal(await r.text(),'3456');
  assert.equal((await get('idle.webm',{method:'HEAD'})).headers.get('content-length'),'10');
  assert.equal((await get('idle.webm',{headers:{Range:'bytes=99-'}})).status,416);
  for(const path of ['../workspaces.json','%2e%2e%2fworkspaces.json','unknown.webm'])assert.ok([403,404].includes((await get(path)).status));
  assert.equal((await get('idle.webm',{method:'POST'})).status,405);
  await rm(join(directory,'focus.webm'));assert.equal((await get('focus.webm')).status,404);
  const missing=await createVideoMedia(directory);assert.equal(missing.available,false);assert.equal((await missing.respond(new Request('app://local/video/manifest.json'))).status,503);
});
test('render acknowledgement preserves voices on failure and rejects retired video acknowledgements', async t => {
  // Execute the real main-process function against a store, without Electron or accounts.
  const main=await readFile(new URL('../main.cjs',import.meta.url),'utf8');
  const body=main.slice(main.indexOf('async function confirmWallpaper('),main.indexOf('\nfunction switchAllowed()'));
  const directory=await fixture(t),store=new WorkspaceStore(directory);await store.load();await store.updateSettings({character:'male'});
  // Lexical state deliberately matches the main process, including late confirmations.
  const wrapped=Function('store','isCharacter','isWallpaperKind',`let wallpaperStatus={phase:'loading',character:'female',wallpaperKind:'artwork',requestId:1};let appliedWallpaperRequest=-1,wallpaperCommit;const presentation=()=>({paused:false});const stopSpeech=()=>{};const notifyWorkspace=()=>{};${body};return {run:async info=>await confirmWallpaper(info)&&finishWallpaper(info,true),state:()=>wallpaperStatus,retry:()=>{wallpaperStatus={...wallpaperStatus,phase:'loading',requestId:2};}};`);
  const fixtureApi=wrapped(store,id=>['female','male'].includes(id),choices.isWallpaperKind);
  await fixtureApi.run({character:'female',wallpaperKind:'artwork',requestId:1,error:'broken'});
  assert.equal(store.data.settings.character,'male');assert.equal(store.data.settings.qwenVoice,'Dylan');assert.equal(fixtureApi.state().phase,'error');
  await fixtureApi.run({character:'female',wallpaperKind:'video',requestId:1,ready:true});
  assert.equal(store.data.settings.character,'male');
  fixtureApi.retry();
  await fixtureApi.run({character:'female',wallpaperKind:'artwork',requestId:2,ready:true});
  assert.equal(store.data.settings.character,'female');assert.equal(store.data.settings.wallpaperKind,'artwork');assert.equal(store.data.settings.qwenVoice,'Serena');
});
