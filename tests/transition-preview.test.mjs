import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { TransitionPlayer } from '../prototypes/video-companion/transition-player.mjs';
import { validateTransitions } from '../prototypes/video-companion/transition-catalog.mjs';
import { createTransitionServer } from '../tools/project/transition-preview-server.mjs';

const states = [{ id: 'work', label: '工作' }, { id: 'window', label: '望窗' }, { id: 'user', label: '看向我' }];
const raw = { schema: 'rin-three-state-transitions-v1', quality: 'upscaled-4k', initial: 'work', states,
  transitions: states.flatMap(from => states.filter(to => to !== from).map(to => ({ from: from.id, to: to.id, file: `${from.id}-${to.id}.mp4`, duration: 4.016667 }))) };
const manifest = validateTransitions(raw);
const flush = () => new Promise(resolve => setImmediate(resolve));
const blocked = signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
class FakeDeck {
  ready = false; visible = false; paused = true; time = 0; prepares = [];
  async prepare(clip, time, signal) {
    this.pause(); this.show(false); this.prepares.push(clip);
    await this.delay?.(clip, signal);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (this.failPrepare) throw new Error('Broken media');
    this.clip = clip; this.time = time; this.ready = true;
  }
  async present(signal) { await this.presentation?.(signal); if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); }
  async play() { await this.starting?.(); if (this.failPlay) throw new Error('Play rejected'); this.paused = false; }
  async seek(time) { this.time = time; }
  show(value) { this.visible = value; }
  pause() { this.paused = true; }
  end() { this.time = this.clip.duration; this.onEnded?.(); }
  dispose() { this.pause(); this.disposed = true; }
}
function setup(t, options = {}) {
  const decks = [new FakeDeck(), new FakeDeck()];
  const player = new TransitionPlayer({ decks, manifest, ...options });
  t.after(() => player.close()); return { player, decks };
}
function singleVisible(decks) { assert.equal(decks.filter(deck => deck.visible && deck.ready).length, 1); }

test('each directed clip plays once, holds its decoded end frame, and never auto-loops', async t => {
  const { player, decks } = setup(t); await player.start();
  assert.equal(player.current, 'work'); assert.equal(decks[0].paused, true);
  player.request('user'); await flush();
  assert.equal(player.snapshot().phase, 'transition'); assert.equal(player.current, 'work'); singleVisible(decks);
  const active = player.operation.deck; active.end(); await flush();
  assert.equal(player.current, 'user'); assert.equal(active.time, 4.016667); assert.equal(active.paused, true);
  assert.equal(player.operation, null); assert.equal(player.stable, active); singleVisible(decks);
  player.request('work'); await flush();
  assert.equal(player.operation.clip.from, 'user'); assert.equal(player.operation.clip.to, 'work');
  player.operation.deck.end(); assert.equal(player.current, 'work');
});
test('all six directed routes choose their own clip and retain the reached endpoint', async t => {
  const { player } = setup(t); await player.start();
  for (const next of ['user', 'window', 'work', 'window', 'user', 'work']) {
    const from = player.current; player.request(next); await flush();
    assert.equal(player.operation.clip.file, `${from}-${next}.mp4`);
    player.operation.deck.end(); await flush(); assert.equal(player.current, next); assert.equal(player.operation, null);
  }
});
test('rapid selections cancel unseen loads; visible turns finish before the latest target', async t => {
  const { player, decks } = setup(t); await player.start();
  decks[1].delay = (clip, signal) => clip.to === 'window' ? blocked(signal) : undefined;
  player.request('window'); const cancelled = player.operation;
  player.request('user'); await flush();
  assert.ok(cancelled.controller.signal.aborted); assert.equal(player.operation.to, 'user');
  player.request('window'); player.request('work');
  assert.equal(player.operation.to, 'user'); singleVisible(decks);
  player.operation.deck.end(); await flush();
  assert.equal(player.operation.clip.from, 'user'); assert.equal(player.operation.clip.to, 'work');
  player.operation.deck.end(); assert.equal(player.current, 'work'); assert.equal(player.error, null);
});
test('load and playback failures retain the prior frame and explicit retry restores progress', async t => {
  const { player, decks } = setup(t); await player.start(); const retained = player.stable;
  decks[1].failPrepare = true; player.request('user'); await flush();
  assert.equal(player.snapshot().phase, 'error'); assert.equal(player.current, 'work'); assert.equal(retained.visible, true);
  const attempts = decks[1].prepares.length; await flush(); assert.equal(decks[1].prepares.length, attempts);
  decks[1].failPrepare = false; player.retry(); await flush();
  assert.equal(player.snapshot().phase, 'transition'); singleVisible(decks);
  player.operation.deck.onFailure(new Error('Decode failed'));
  assert.equal(player.snapshot().phase, 'error'); assert.equal(retained.visible, true); assert.equal(player.current, 'work');
  player.retry(); await flush(); player.operation.deck.end();
  assert.equal(player.current, 'user'); assert.equal(player.error, null); singleVisible(decks);
});
test('initial failure retries, and an intent during initial load is not lost', async t => {
  const { player, decks } = setup(t); decks[0].failPrepare = true;
  await player.start(); assert.equal(player.snapshot().phase, 'error');
  decks[0].failPrepare = false; player.request('window'); await flush();
  assert.equal(player.current, 'work'); assert.equal(player.operation.to, 'window');
  player.operation.deck.end(); assert.equal(player.current, 'window');
});
test('pause before handoff keeps old image; hidden-tab suspension never clears manual pause', async t => {
  const { player, decks } = setup(t); await player.start();
  let release;
  decks[1].starting = () => new Promise(resolve => { release = resolve; });
  player.request('user'); await flush(); assert.equal(typeof release, 'function');
  player.setPaused(true); release(); await flush();
  assert.equal(decks[0].visible, true); assert.equal(decks[1].paused, true); assert.equal(player.operation.phase, 'prepared');
  player.setSuspended(true); player.setSuspended(false);
  assert.equal(player.manualPaused, true); assert.equal(decks[1].paused, true);
  decks[1].starting = undefined; player.setPaused(false); await flush();
  assert.equal(player.snapshot().phase, 'transition'); assert.equal(decks[1].paused, false);
  player.setSuspended(true); assert.equal(decks[1].paused, true);
  player.setSuspended(false); await flush(); assert.equal(decks[1].paused, false);
});
test('stale completion and errors cannot replace a newer successful transition', async t => {
  const { player, decks } = setup(t); await player.start();
  player.request('user'); await flush(); const staleEnd = decks[1].onEnded, staleFail = decks[1].onFailure;
  decks[1].end(); player.request('window'); await flush(); const operation = player.operation;
  staleEnd(); staleFail(new Error('Late failure'));
  assert.equal(player.operation, operation); assert.equal(player.error, null);
  operation.deck.end(); assert.equal(player.current, 'window'); singleVisible(decks);
});
test('play rejection and an actual playback stall provide retry without losing the last frame', async t => {
  const { player, decks } = setup(t, { stallMs: 15 }); await player.start();
  decks[1].failPlay = true; player.request('user'); await flush();
  assert.equal(player.snapshot().phase, 'error'); assert.equal(decks[0].visible, true);
  decks[1].failPlay = false; player.retry(); await flush();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(player.snapshot().phase, 'error'); assert.match(player.error, /停滞/); assert.equal(decks[0].visible, true);
});
test('catalog rejects missing routes, duplicate routes and paths outside the media bundle', () => {
  assert.equal(manifest.transitions.length, 6);
  assert.throws(() => validateTransitions({ ...raw, quality: 'native-4k' }));
  assert.throws(() => validateTransitions({ ...raw, transitions: raw.transitions.slice(1) }));
  assert.throws(() => validateTransitions({ ...raw, transitions: [...raw.transitions, raw.transitions[0]] }));
  for (const file of ['../secret.mp4', '/file.mp4', 'C:\\private.mp4', 'https://example.com/video.mp4']) {
    assert.throws(() => validateTransitions({ ...raw, transitions: raw.transitions.map((clip, index) => index ? clip : { ...clip, file }) }));
  }
});
test('new preview and inspection commands default to help without file reads, writes or subprocesses', () => {
  for (const entry of ['../tools/project/preview-transitions.mjs', '../tools/qa/transition-media.mjs', '../tools/qa/transition-trim-analysis.mjs', '../tools/qa/idle-loop-media.mjs', '../tools/qa/video-seam.mjs', '../tools/project/compose-transition-demo.mjs', '../tools/project/prepare-idle-loop-kit.mjs', '../tools/project/compose-work-idle-demo.mjs']) for (const flags of [[], ['--run', '--help']]) {
    const code = `import fs from 'node:fs/promises'; import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';
      const forbid = () => { throw new Error('Help performed an effect'); };
      fs.readFile = forbid; fs.mkdir = forbid; fs.writeFile = forbid; cp.spawn = forbid; syncBuiltinESMExports();
      process.argv = ['node', 'tool', ...${JSON.stringify(flags)}]; await import(${JSON.stringify(new URL(entry, import.meta.url).href)});`;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.match(output, /npm run/);
  }
});
test('preview serves only allowlisted media with bounded range, HEAD and method handling', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rin-transitions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...raw, secret: 'must-not-be-served' }));
  for (const clip of raw.transitions) await writeFile(join(dir, clip.file), Buffer.from('0123456789'));
  await writeFile(join(dir, 'private.json'), 'not public');
  const server = await createTransitionServer({ mediaRoot: dir });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = 'http://127.0.0.1:' + server.address().port;
  const config = await (await fetch(url + '/manifest.json')).json(); assert.equal(config.secret, undefined);
  const range = await fetch(url + '/media/work-user.mp4', { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('Content-Range'), 'bytes 2-5/10'); assert.equal(await range.text(), '2345');
  assert.equal((await fetch(url + '/media/work-user.mp4', { headers: { Range: 'bytes=99-' } })).status, 416);
  const head = await fetch(url + '/media/work-user.mp4', { method: 'HEAD' }); assert.equal(head.headers.get('Content-Length'), '10'); assert.equal(await head.text(), '');
  assert.equal((await fetch(url + '/private.json')).status, 404);
  assert.equal((await fetch(url + '/media/private.json')).status, 404);
  assert.equal((await fetch(url + '/manifest.json', { method: 'POST' })).status, 405);
  const script = await fetch(url + '/transition-player.mjs'); assert.equal(script.status, 200); assert.match(script.headers.get('Content-Type'), /javascript/);
});
