import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { WorkspaceStore } from '../backend/workspace-store.mjs';
import { QwenSpeech } from '../backend/qwen-speech.mjs';
import { speechProfile } from '../backend/speech-plan.mjs';
import { WallpaperScenes } from '../renderer/wallpaper-scenes.mjs';

async function fixture(t) {
  const base = resolve(import.meta.dirname, '../../../work/runtime/character-tests');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'case-'));
  assert.ok(dir.startsWith(base + sep));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new WorkspaceStore(dir); await store.load();
  return { store, dir };
}

test('wallpaper styles preserve independent voices and playback preferences across restart', async t => {
  const {store,dir}=await fixture(t);
  await store.updateSettings({ttsEngine:'kokoro',speed:.9,qwenVoice:'Dylan',voice:59});
  for(const wallpaperMotion of [true,false,true]) {
    const before=speechProfile(store.data.settings);
    await store.updateSettings({wallpaperMotion});
    assert.equal(speechProfile(store.data.settings),before);
    const reload=new WorkspaceStore(dir);await reload.load();
    for(const [key,value] of Object.entries({character:'female',wallpaperMotion,qwenVoice:'Dylan',voice:59,ttsEngine:'kokoro',speed:.9,ttsResident:false,autoSpeak:false}))assert.equal(reload.data.settings[key],value);
  }
});

test('legacy workspaces migrate removed male artwork to anime stills and preserve valid custom voices', async t => {
  const { store } = await fixture(t);
  for (const [settings, expected] of [
    [{ qwenVoice: 'Vivian', voice: 46 }, ['female', 'Vivian', 46]],
    [{ character: 'male', wallpaperMotion: true }, ['female', 'Serena', 3]],
    [{ character: 'male', wallpaperMotion: true, qwenVoice: 'Uncle_Fu', voice: 60 }, ['female', 'Uncle_Fu', 60]],
    [{ character: 'unknown', voice: -1, qwenVoice: 'constructor' }, ['female', 'Serena', 3]],
  ]) {
    await writeFile(store.file, JSON.stringify({ format: 1, projects: [], drafts: {}, settings }));
    const original=await readFile(store.file,'utf8');
    await store.load();
    assert.equal(await readFile(store.file,'utf8'),original);
    if(settings.character==='male')assert.equal(store.data.settings.wallpaperMotion,false);
    assert.deepEqual([store.data.settings.character, store.data.settings.qwenVoice, store.data.settings.voice], expected);
  }
});

test('invalid character or voice patches are rejected atomically', async t => {
  const { store } = await fixture(t);
  for (const patch of [{ character: 'male' }, { character: 'unknown' }, { character: 'constructor' }, { character: 'male', voice: 103 }, { character: 'male', qwenVoice: 'toString' }, { voice: 2 }, { voice: 58.5 }]) {
    await assert.rejects(store.updateSettings(patch));
    assert.equal(store.data.settings.character, 'female'); assert.equal(store.data.settings.qwenVoice, 'Serena'); assert.equal(store.data.settings.voice, 3);
  }
});

test('male migration keeps projects, conversation pointers and drafts through the next durable save', async t => {
  const {store,dir}=await fixture(t);
  await store.add(dir);await store.remember({provider:'codex',cwd:dir,threadId:'kept-thread'});
  const target={provider:'codex',cwd:dir,threadId:'kept-thread'};
  await store.saveDraft(target,'保留未发送的中文草稿');
  const legacy=JSON.parse(await readFile(store.file,'utf8'));
  Object.assign(legacy.settings,{character:'male',wallpaperMotion:true,qwenVoice:'Dylan',voice:59,speed:1.1});
  await writeFile(store.file,JSON.stringify(legacy));
  await store.load();assert.deepEqual(store.data.projects,legacy.projects);assert.deepEqual(store.data.drafts,legacy.drafts);
  assert.equal(store.data.settings.character,'female');assert.equal(store.data.settings.wallpaperMotion,false);
  await store.updateSettings({completionSound:false});
  const reload=new WorkspaceStore(dir);await reload.load();
  assert.deepEqual(reload.data.projects,legacy.projects);assert.equal(reload.draft(target),'保留未发送的中文草稿');
  assert.equal(reload.data.settings.qwenVoice,'Dylan');assert.equal(reload.data.settings.voice,59);assert.equal(reload.data.settings.speed,1.1);
  assert.equal(reload.data.settings.character,'female');assert.equal(reload.data.settings.wallpaperMotion,false);
});

test('Qwen transmits the selected male speaker and matching style to the worker', async () => {
  const worker = new QwenSpeech('unused'), commands = [];
  worker.child = {}; worker.wait = () => Promise.resolve(); worker.send = command => commands.push(command);
  for (const voice of ['Dylan', 'Uncle_Fu', 'Serena', 'Vivian']) await worker.synthesize('你好。', { qwenVoice: voice });
  assert.deepEqual(commands.map(command => command.speaker), ['Dylan', 'Uncle_Fu', 'Serena', 'Vivian']);
  assert.ok(commands.slice(0, 2).every(command => command.instruct.includes('成年男性') && !command.instruct.includes('女性')));
  assert.ok(commands.slice(2).every(command => command.instruct.includes('成年女性')));
});

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
test('rapid wallpaper choices keep the current scene visible and discard a superseded load', async () => {
  const pending = deferred(), shown = [], disposed = [];
  const scenes = new WallpaperScenes({ load: id => id === 'anime' ? { id } : pending.promise, show: scene => shown.push(scene.id), dispose: scene => disposed.push(scene.id) });
  await scenes.select('anime');
  const switching = scenes.select('realistic');
  assert.deepEqual(shown, ['anime']); assert.deepEqual(disposed, []);
  scenes.select('anime'); pending.resolve({ id: 'realistic' }); await switching;
  assert.deepEqual(shown, ['anime']); assert.deepEqual(disposed, ['realistic']);
  await scenes.select('realistic');
  assert.deepEqual(shown, ['anime', 'realistic']); assert.deepEqual(disposed, ['realistic', 'anime']);
  await scenes.close(); assert.deepEqual(disposed, ['realistic', 'anime', 'realistic']);
});

test('wallpaper load failures preserve the working scene and can be retried', async () => {
  let fail = true; const shown = [], disposed = [];
  const scenes = new WallpaperScenes({ load: async id => { if (id === 'realistic' && fail) throw new Error('missing texture'); return { id }; }, show: scene => shown.push(scene.id), dispose: scene => disposed.push(scene.id) });
  await scenes.select('anime'); await assert.rejects(scenes.select('realistic'), /missing texture/);
  assert.equal(scenes.currentId, 'anime'); assert.deepEqual(disposed, []);
  fail = false; await scenes.select('realistic'); assert.deepEqual(shown, ['anime', 'realistic']); assert.deepEqual(disposed, ['anime']);
  await scenes.close();
});

test('closing during a load disposes both active and late scenes without showing the late one', async () => {
  const pending = deferred(), shown = [], disposed = [];
  const scenes = new WallpaperScenes({ load: id => id === 'realistic' ? pending.promise : { id }, show: scene => shown.push(scene.id), dispose: scene => disposed.push(scene.id) });
  await scenes.select('anime'); scenes.select('realistic'); const closing = scenes.close();
  pending.resolve({ id: 'realistic' }); await closing;
  assert.deepEqual(shown, ['anime']); assert.deepEqual(disposed.sort(), ['anime', 'realistic']);
  await scenes.select('anime'); assert.equal(scenes.current, null);
});

test('removed male wallpaper assets cannot be selected or shipped from the checkout', async () => {
  const assets = resolve(import.meta.dirname, '../assets');
  for(const name of ['rainy-window-male','stills/male','character-previews/male.png'])await assert.rejects(access(join(assets,name)),{code:'ENOENT'});
  const profiles=(await import('../backend/character-profiles.cjs')).default;
  assert.deepEqual(Object.keys(profiles.CHARACTERS),['female']);
  assert.equal(profiles.isCharacter('male'),false);
  const manifest=JSON.parse(await readFile(join(assets,'stills/manifest.json'),'utf8'));
  assert.deepEqual(Object.keys(manifest.active),['female']);
  assert.ok(manifest.images.every(image=>!image.file.startsWith('male/')));
});
