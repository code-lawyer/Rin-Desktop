import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { animeCatalog, animeTarget, animePresentation } from '../prototypes/live2d-codex/renderer/anime-catalog.mjs';
import { AnimePlayer } from '../prototypes/live2d-codex/renderer/anime-player.mjs';
import { createMotionMedia } from '../prototypes/live2d-codex/backend/motion-media.mjs';
import { WorkspaceStore } from '../prototypes/live2d-codex/backend/workspace-store.mjs';
import { wallpaperChoice } from '../prototypes/live2d-codex/backend/wallpaper-choice.cjs';
import { inspectAnimeAssets, copyAnimeAssets } from '../tools/release/anime-assets.mjs';

const manifest = JSON.parse(await readFile(new URL('../prototypes/live2d-codex/assets/motion/anime/manifest.json', import.meta.url), 'utf8'));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const played = [], decks = [0, 1].map(() => ({
    time: 0, shown: false, running: false,
    async prepare(clip, time, signal) { this.clip = clip; this.time = time; this.running = false; this.shown = false; if (signal.aborted) throw new DOMException('aborted', 'AbortError'); },
    async play() { this.running = true; }, pause() { this.running = false; }, async present() {}, async seek(time) { this.time = time; },
    show(value) { this.shown = value; if (value) played.push(this.clip); }, watch() { return () => {}; }, dispose() { this.pause(); },
  }));
  const player = new AnimePlayer({ decks, catalog: animeCatalog(manifest), interval: () => 0, clear() {} });
  t.after(() => player.close());
  return { player, played, decks, async start() { player.start(); await tick(); }, async end() { player.boundary(); await tick(); } };
}
test('all states and one-shot actions use authored endpoints, including cup to attention through work', async t => {
  const h = fixture(t); await h.start(); await h.end();
  h.player.setTarget('attention'); await tick(); await h.end(); await h.end();
  for (const action of ['nod', 'wave']) { h.player.requestAction(action); await tick(); await h.end(); await h.end(); }
  h.player.setTarget('cup'); await tick(); await h.end(); await h.end(); await h.end();
  h.player.requestAction('sip'); await tick(); await h.end(); await h.end();
  h.player.setTarget('attention'); await tick(); await h.end(); await h.end(); await h.end();
  assert.equal(new Set(h.played.map(clip => clip.id)).size, 10);
  for (let i = 1; i < h.played.length; i++) assert.equal(h.played[i - 1].to, h.played[i].from);
  for (const action of ['attention-nod', 'attention-wave', 'cup-sip']) assert.equal(h.played.filter(clip => clip.id === action).length, 1);
  assert.equal(h.decks.filter(deck => deck.shown).length, 1);
});
test('new intent finishes the current turn and replaces obsolete queued actions', async t => {
  const h = fixture(t); await h.start(); h.player.setTarget('cup'); await tick(); await h.end();
  h.player.requestAction('sip'); h.player.requestAction('wave'); await tick(); await h.end(); await h.end(); await h.end();
  assert.deepEqual(h.played.map(c => c.id), ['work-loop', 'work-cup', 'cup-work', 'work-attention', 'attention-wave']);
});
test('pause retains frame ownership, latest state resumes, and listening cancels queued sip', async t => {
  const h = fixture(t); await h.start(); h.player.setPaused(true); h.player.requestAction('sip'); await tick(); await h.end();
  assert.equal(h.played.length, 1); assert.equal(h.decks.some(deck => deck.running), false);
  h.player.setTarget('attention', true); await tick(); h.player.setPaused(false); await tick(); await h.end();
  assert.deepEqual(h.played.map(c => c.id), ['work-loop', 'work-attention', 'attention-loop']);
  assert.equal(h.player.snapshot().typing, false);
});
test('failed next clip keeps the visible frame; retry starts at the same authored endpoint', async t => {
  const h = fixture(t); await h.start(); const deck = h.decks[1], prepare = deck.prepare;
  deck.prepare = async () => { throw new Error('decode failed'); };
  h.player.setTarget('cup'); await tick();
  assert.equal(h.player.snapshot().phase, 'error'); assert.equal(h.played.length, 1); assert.equal(h.decks[0].shown, true);
  deck.prepare = prepare; h.player.retry(); await tick();
  assert.equal(h.played.at(-1).id, 'work-cup');
});
test('dialogue wakes a pinned cup pose; completion restores it and legacy poses use automatic policy', () => {
  for (const flag of ['capturing', 'speaking', 'chatVisible']) assert.equal(animeTarget({}, { [flag]: true, stills: { stillPose: 'cup' } }), 'attention');
  assert.equal(animeTarget({}, { stills: { stillPose: 'cup' } }), 'cup');
  assert.equal(animeTarget({}, { stills: { stillPose: 'window' } }, 'cup'), 'cup');
  assert.equal(animeTarget({ status: 'working' }, {}, 'cup'), 'work');
  const original = { stills: { stillPose: 'window' } };
  assert.equal(animePresentation(original).stills.stillPose, 'auto'); assert.equal(original.stills.stillPose, 'window');
});
test('catalogue rejects invalid routes, aliases, dimensions and window placement', () => {
  for (const mutate of [v => v.clips.pop(), v => v.clips[0].file = '../private.mp4', v => v.clips[0].id = 'cup-attention', v => v.clips[0].frames = NaN, v => v.posters.work = 'anchors/../A.png', v => v.window.placement[2] = 1024, v => v.canvas[1] = 720]) {
    const value = structuredClone(manifest); mutate(value); assert.throws(() => animeCatalog(value));
  }
});
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rin-anime-test-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
test('new workspaces use original anime poses; legacy video requests cannot re-enable the withdrawn player', async t => {
  const dir = await directory(t), store = new WorkspaceStore(dir); await store.load();
  assert.equal(store.data.settings.animePlayback, 'poses');
  await store.updateSettings({ stillPose: 'window', qwenVoice: 'Vivian', voice: 48 });
  const before = store.snapshot(); await store.updateSettings({ animePlayback: 'video' });
  const reload = new WorkspaceStore(dir); await reload.load();
  assert.equal(reload.data.settings.animePlayback, 'poses'); assert.equal(reload.data.settings.stillPose, 'window');
  assert.equal(reload.data.settings.qwenVoice, 'Vivian'); assert.equal(reload.data.settings.voice, 48); assert.deepEqual(reload.snapshot().drafts, before.drafts);
  assert.equal(wallpaperChoice({ wallpaperMotion: true }, reload.data.settings).animePlayback, 'poses');
  assert.equal(wallpaperChoice({ animePlayback: 'video' }, reload.data.settings).animePlayback, 'poses');
  await assert.rejects(reload.updateSettings({ animePlayback: 'unknown' }));
  assert.throws(() => wallpaperChoice({ animePlayback: 'unknown' }, reload.data.settings));
});

for (const wallpaperMotion of [false, true]) for (const playback of [undefined, 'poses', 'video']) test(`saved ${playback ?? 'legacy'} anime setting restores poses while preserving realistic=${wallpaperMotion} and user data`, async t => {
  const dir = await directory(t), store = new WorkspaceStore(dir); await store.load();
  await store.add(dir);
  const target = { cwd: dir, provider: 'codex', threadId: null };
  await store.saveDraft(target, 'Keep this unsent draft');
  await store.updateSettings({ wallpaperMotion, stillPose: 'window', qwenVoice: 'Vivian', voice: 48, playbackVolume: .6, ambienceEnabled: true, rainVolume: .2 });
  const saved = JSON.parse(await readFile(store.file, 'utf8'));
  saved.settings.animePlayback = playback;
  const original = JSON.stringify(saved); await writeFile(store.file, original);
  const restored = new WorkspaceStore(dir); await restored.load();
  assert.equal(restored.data.settings.animePlayback, 'poses');
  for (const key of ['wallpaperMotion', 'stillPose', 'qwenVoice', 'voice', 'playbackVolume', 'ambienceEnabled', 'rainVolume']) assert.equal(restored.data.settings[key], saved.settings[key]);
  assert.deepEqual(restored.data.projects, saved.projects); assert.deepEqual(restored.data.drafts, saved.drafts);
  assert.equal(restored.draft(target), 'Keep this unsent draft');
  assert.equal(await readFile(store.file, 'utf8'), original, 'reading migration must preserve the original saved bytes');
  await restored.updateSettings({ keyVolume: .12 });
  const again = new WorkspaceStore(dir); await again.load();
  assert.equal(again.data.settings.animePlayback, 'poses'); assert.equal(again.data.settings.wallpaperMotion, wallpaperMotion);
  assert.equal(again.draft(target), 'Keep this unsent draft'); assert.deepEqual(again.data.projects, saved.projects);
});
test('runtime import and package copy include only verified media; private provenance is omitted', async t => {
  const dir = await directory(t), source = join(dir, 'source'), output = join(dir, 'package');
  await mkdir(source); const value = structuredClone(manifest), bytes = Buffer.from('synthetic-media');
  for (const name of animeCatalog(value).files) {
    await mkdir(dirname(join(source, name)), { recursive: true }); await writeFile(join(source, name), bytes);
    value.integrity[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  value.sourceJob = 'private'; await writeFile(join(source, 'manifest.json'), JSON.stringify(value));
  await writeFile(join(source, 'private-prompt.txt'), 'private');
  const copied = await copyAnimeAssets(source, output); assert.equal(copied.sourceJob, undefined);
  assert.equal((await inspectAnimeAssets(output)).names.length, 14);
  await assert.rejects(readFile(join(output, 'private-prompt.txt')));
  await writeFile(join(source, value.window.file), 'bad'); await assert.rejects(inspectAnimeAssets(source));
});
test('anime media uses allowlisted range responses and detects missing rain on explicit retry', async t => {
  const dir = await directory(t); await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  for (const name of animeCatalog(manifest).files) { await mkdir(dirname(join(dir, name)), { recursive: true }); await writeFile(join(dir, name), '0123456789'); }
  const media = await createMotionMedia(dir, { prefix: '/assets/motion/anime/', parse: animeCatalog });
  const request = (name, init) => media.respond(new Request('app://local/assets/motion/anime/' + name, init));
  assert.equal(media.available, true);
  const part = await request('window-layer.webm', { headers: { range: 'bytes=2-5' } });
  assert.equal(part.status, 206); assert.equal(await part.text(), '2345'); assert.equal(part.headers.get('content-type'), 'video/webm');
  assert.equal((await request('private-prompt.txt')).status, 404);
  await rm(join(dir, 'window-layer.webm')); assert.equal((await request('manifest.json')).status, 503);
  await writeFile(join(dir, 'window-layer.webm'), 'restored'); assert.equal((await request('manifest.json')).status, 200);
});
