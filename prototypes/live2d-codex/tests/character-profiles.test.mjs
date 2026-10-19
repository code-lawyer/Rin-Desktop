import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { resolve, join, sep, isAbsolute } from 'node:path';
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

test('character changes persist both engine voices without enabling playback or changing engine and speed', async t => {
  const { store, dir } = await fixture(t);
  assert.equal(store.data.settings.character, 'female');
  await store.updateSettings({ ttsEngine: 'kokoro', speed: .9, qwenVoice: 'Vivian' });
  const previous = { ...store.data.settings };
  await store.updateSettings({ character: 'male' });
  const next = store.data.settings;
  assert.equal(next.qwenVoice, 'Dylan'); assert.equal(next.voice, 58);
  for (const key of ['ttsEngine', 'speed', 'ttsResident', 'autoSpeak', 'prepareSpeech']) assert.equal(next[key], previous[key]);
  for (const ttsEngine of ['qwen', 'kokoro']) assert.notEqual(speechProfile({ ...previous, ttsEngine }), speechProfile({ ...next, ttsEngine }), 'Old audio cannot match the new voice');
  const reloaded = new WorkspaceStore(dir); await reloaded.load();
  assert.equal(reloaded.data.settings.character, 'male'); assert.equal(reloaded.data.settings.qwenVoice, 'Dylan'); assert.equal(reloaded.data.settings.voice, 58);
  await reloaded.updateSettings({ qwenVoice: 'Uncle_Fu', voice: 102 });
  await reloaded.updateSettings({ character: 'male' });
  assert.equal(reloaded.data.settings.qwenVoice, 'Uncle_Fu'); assert.equal(reloaded.data.settings.voice, 102, 'Reselecting the same character preserves manual choices');
  await reloaded.updateSettings({ character: 'female' });
  assert.equal(reloaded.data.settings.qwenVoice, 'Serena'); assert.equal(reloaded.data.settings.voice, 3);
});

test('legacy workspaces keep their voices; missing male voices derive from the saved character', async t => {
  const { store } = await fixture(t);
  for (const [settings, expected] of [
    [{ qwenVoice: 'Vivian', voice: 46 }, ['female', 'Vivian', 46]],
    [{ character: 'male' }, ['male', 'Dylan', 58]],
    [{ character: 'unknown', voice: -1, qwenVoice: 'constructor' }, ['female', 'Serena', 3]],
  ]) {
    await writeFile(store.file, JSON.stringify({ format: 1, projects: [], drafts: {}, settings }));
    await store.load();
    assert.deepEqual([store.data.settings.character, store.data.settings.qwenVoice, store.data.settings.voice], expected);
  }
});

test('invalid character or voice patches are rejected atomically', async t => {
  const { store } = await fixture(t);
  for (const patch of [{ character: 'unknown' }, { character: 'constructor' }, { character: 'male', voice: 103 }, { character: 'male', qwenVoice: 'toString' }, { voice: 2 }, { voice: 58.5 }]) {
    await assert.rejects(store.updateSettings(patch));
    assert.equal(store.data.settings.character, 'female'); assert.equal(store.data.settings.qwenVoice, 'Serena'); assert.equal(store.data.settings.voice, 3);
  }
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
  const scenes = new WallpaperScenes({ load: id => id === 'female' ? { id } : pending.promise, show: scene => shown.push(scene.id), dispose: scene => disposed.push(scene.id) });
  await scenes.select('female');
  const switching = scenes.select('male');
  assert.deepEqual(shown, ['female']); assert.deepEqual(disposed, []);
  scenes.select('female'); pending.resolve({ id: 'male' }); await switching;
  assert.deepEqual(shown, ['female']); assert.deepEqual(disposed, ['male']);
  await scenes.select('male');
  assert.deepEqual(shown, ['female', 'male']); assert.deepEqual(disposed, ['male', 'female']);
  await scenes.close(); assert.deepEqual(disposed, ['male', 'female', 'male']);
});

test('wallpaper load failures preserve the working scene and can be retried', async () => {
  let fail = true; const shown = [], disposed = [];
  const scenes = new WallpaperScenes({ load: async id => { if (id === 'male' && fail) throw new Error('missing texture'); return { id }; }, show: scene => shown.push(scene.id), dispose: scene => disposed.push(scene.id) });
  await scenes.select('female'); await assert.rejects(scenes.select('male'), /missing texture/);
  assert.equal(scenes.currentId, 'female'); assert.deepEqual(disposed, []);
  fail = false; await scenes.select('male'); assert.deepEqual(shown, ['female', 'male']); assert.deepEqual(disposed, ['female']);
  await scenes.close();
});

test('closing during a load disposes both active and late scenes without showing the late one', async () => {
  const pending = deferred(), shown = [], disposed = [];
  const scenes = new WallpaperScenes({ load: id => id === 'male' ? pending.promise : { id }, show: scene => shown.push(scene.id), dispose: scene => disposed.push(scene.id) });
  await scenes.select('female'); scenes.select('male'); const closing = scenes.close();
  pending.resolve({ id: 'male' }); await closing;
  assert.deepEqual(shown, ['female']); assert.deepEqual(disposed.sort(), ['female', 'male']);
  await scenes.select('female'); assert.equal(scenes.current, null);
});

test('shipped male model has all runtime resources and preview images', async () => {
  const assets = resolve(import.meta.dirname, '../assets'), male = join(assets, 'rainy-window-male');
  const model = JSON.parse(await readFile(join(male, 'Generated_artwork.model3.json'), 'utf8'));
  for (const file of [model.FileReferences.Moc, model.FileReferences.DisplayInfo, ...model.FileReferences.Textures]) {
    assert.ok(!isAbsolute(file) && !file.includes('..')); await access(join(male, file));
  }
  for (const id of ['female', 'male']) await access(join(assets, 'character-previews', `${id}.png`));
});
