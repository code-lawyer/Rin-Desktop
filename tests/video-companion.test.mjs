import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideoCompanion } from '../prototypes/video-companion/player.mjs';
import { validateManifest } from '../prototypes/video-companion/catalog.mjs';
import { importSample, sampleScenes } from '../tools/project/import-video-sample.mjs';
import { byteRange, createPreviewServer } from '../tools/project/video-preview-server.mjs';

const scenes = validateManifest({ version: 1, scenes: sampleScenes }).scenes;
const flush = () => new Promise(resolve => setImmediate(resolve));
class FakeDeck {
  ready = false; time = 0; visible = false; paused = true; callbacks = new Set();
  async prepare(scene, time, signal, source) {
    this.pause(); this.show(false);
    if (this.delay) await this.delay(scene, signal);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (source === 'broken' || this.failPrepare) throw new Error('Broken media');
    this.ready = true; this.time = time; this.scene = scene;
  }
  async play() { if (this.failPlay) throw new Error('Decode failure'); this.paused = false; }
  async present(signal) { if (this.presentation) await this.presentation(signal); if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); }
  pause() { this.paused = true; }
  show(value) { this.visible = value; }
  watch(callback) { this.callbacks.add(callback); return () => this.callbacks.delete(callback); }
  async seek(time) { this.time = time; }
  frame(time) { this.time = time; for (const callback of this.callbacks) callback(time); }
  dispose() { this.disposed = true; this.pause(); }
}
function setup(t) { const decks = [new FakeDeck(), new FakeDeck()]; const player = new VideoCompanion({ decks }); t.after(() => player.close()); return { player, decks }; }
function blocked(signal) { return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })); }

test('closed-loop handoff presents one decoded deck at the configured interval', async t => {
  const { player, decks } = setup(t);
  await player.select(scenes[0]);
  const previous = player.active;
  previous.frame(scenes[0].loopEnd - .02); await flush();
  assert.equal(player.loops, 1); assert.notEqual(player.active, previous);
  assert.equal(player.active.time, scenes[0].loopStart); assert.equal(previous.paused, true);
  assert.equal(decks.filter(deck => deck.visible && deck.ready).length, 1);
  assert.equal(player.history.at(-1).type, 'loop');
});
test('read or play failures retain the displayed scene, and retry uses the intended clean source', async t => {
  const { player } = setup(t); await player.select(scenes[0]);
  const previous = player.active;
  await player.select(scenes[1], { sourceOverride: 'broken' });
  assert.equal(player.current, scenes[0]); assert.equal(player.target, scenes[1]);
  assert.equal(player.active, previous); assert.equal(previous.visible, true); assert.equal(previous.paused, true);
  assert.ok(player.error); await player.retry();
  assert.equal(player.current, scenes[1]); assert.equal(player.error, null); assert.equal(player.paused, false);
  const retained = player.active; player.spare.failPlay = true;
  await player.select(scenes[2]);
  assert.equal(player.active, retained); assert.ok(player.error); assert.equal(retained.visible, true);
  player.spare.failPlay = false; await player.retry(); assert.equal(player.current, scenes[2]);
});
test('rapid selections cancel stale loads and keep the newest target', async t => {
  const { player } = setup(t); await player.select(scenes[0]);
  player.spare.delay = (scene, signal) => scene === scenes[1] ? blocked(signal) : Promise.resolve();
  const slow = player.select(scenes[1]); const latest = player.select(scenes[2]);
  await Promise.all([slow, latest]);
  assert.equal(player.current, scenes[2]); assert.equal(player.target, scenes[2]);
  assert.equal(player.loading, false); assert.equal(player.error, null);
  assert.equal(player.history.filter(event => event.scene === 'focus').length, 0);
});
test('pause during first-frame presentation stays paused after a successful selection', async t => {
  const { player } = setup(t); await player.select(scenes[0]);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  player.spare.presentation = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const pending = player.select(scenes[1]); await started; await player.setPaused(true); release(); await pending;
  assert.equal(player.current, scenes[1]); assert.equal(player.paused, true); assert.equal(player.active.paused, true);
  await player.setSuspended(true); await player.setPaused(false); assert.equal(player.active.paused, true);
  await player.setSuspended(false); assert.equal(player.active.paused, false);
});
test('a new scene cancels a pending loop handoff without letting it overwrite the scene', async t => {
  const { player } = setup(t); await player.select(scenes[0]);
  let entered; const started = new Promise(resolve => { entered = resolve; });
  player.spare.presentation = async signal => { entered(); await blocked(signal); };
  const cycle = player.cycle(); await started; player.spare.presentation = null;
  await player.select(scenes[2]); await cycle;
  assert.equal(player.current, scenes[2]); assert.equal(player.loops, 0); assert.equal(player.error, null);
});
test('a speculative load failure becomes a recoverable loop error, and closing aborts pending work', async t => {
  const { player } = setup(t); player.decks[1].failPrepare = true;
  await player.select(scenes[0]); await player.cycle();
  assert.ok(player.error); assert.equal(player.current, scenes[0]); assert.equal(player.active.visible, true);
  player.spare.failPrepare = false; await player.retry(); assert.equal(player.error, null);
  player.spare.delay = (_scene, signal) => blocked(signal);
  const pending = player.select(scenes[1]); player.close(); await pending;
  assert.ok(player.decks.every(deck => deck.disposed && deck.paused)); assert.equal(player.current, scenes[0]);
});
test('manifest rejects path escapes, invalid media types, duplicate IDs and invalid loops', () => {
  for (const change of [{ file: '../private.webm' }, { file: 'https://example.org/a.webm' }, { poster: 'a.webm' }, { loopEnd: 3 }, { fps: NaN }]) assert.throws(() => validateManifest({ version: 1, scenes: [{ ...sampleScenes[0], ...change }] }));
  assert.throws(() => validateManifest({ version: 1, scenes: [sampleScenes[0], sampleScenes[0]] }));
});
test('media range parser covers open, suffix, clamped and invalid requests', () => {
  assert.deepEqual(byteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(byteRange('bytes=2-', 10), { start: 2, end: 9 });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange('bytes=2-999', 10), { start: 2, end: 9 });
  for (const value of ['bytes=10-', 'bytes=-0', 'bytes=5-3', 'bytes=0-2,4-6', 'bytes=-', 'bad']) assert.equal(byteRange(value, 10), false);
});
test('standalone server serves ranged media from its own allowlist and denies private paths/writes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rin-video-http-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: 1, scenes: sampleScenes }));
  await writeFile(join(directory, sampleScenes[0].file), '0123456789');
  await writeFile(join(directory, 'private.txt'), 'private');
  const server = await createPreviewServer({ mediaRoot: directory });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const partial = await fetch(`${url}/media/${sampleScenes[0].file}`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await partial.text(), '2345');
  const head = await fetch(`${url}/media/${sampleScenes[0].file}`, { method: 'HEAD', headers: { Range: 'bytes=2-' } });
  assert.equal(head.status, 206); assert.equal(head.headers.get('content-length'), '8'); assert.equal(await head.text(), '');
  assert.equal((await fetch(`${url}/media/${sampleScenes[0].file}`, { headers: { Range: 'bytes=99-' } })).status, 416);
  for (const path of ['/media/private.txt', '/media/../private.txt', '/media/%2e%2e%2fprivate.txt', '/package.json']) assert.equal((await fetch(url + path)).status, 404);
  assert.equal((await fetch(url + '/manifest.json', { method: 'POST', body: '{}' })).status, 405);
  const manifest = await fetch(url + '/manifest.json'); assert.match(manifest.headers.get('content-security-policy'), /media-src 'self'/); assert.equal((await manifest.json()).scenes.length, 3);
});
test('import copies only the six media files, is repeatable, and does not overwrite a different asset', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rin-video-import-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source'), target = join(directory, 'target');
  await mkdir(join(source, 'media/1080p'), { recursive: true }); await mkdir(join(source, 'images'));
  for (const scene of sampleScenes) { await writeFile(join(source, 'media/1080p', scene.file), scene.id); await writeFile(join(source, 'images', scene.poster), scene.id); }
  await writeFile(join(source, 'index.html'), 'unrelated source');
  assert.equal((await importSample(source, target)).count, 6); assert.equal((await importSample(source, target)).count, 6);
  assert.equal((await readdir(target)).length, 7); assert.equal((await readdir(target)).includes('index.html'), false);
  await writeFile(join(target, sampleScenes[0].file), 'keep'); await assert.rejects(importSample(source, target), /Destination differs/);
  assert.equal(await readFile(join(target, sampleScenes[0].file), 'utf8'), 'keep');
});
