import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { WorkspaceStore } from '../backend/workspace-store.mjs';
import { AmbientBarrier } from '../backend/ambient-barrier.cjs';
import characters from '../backend/character-profiles.cjs';
import choices from '../backend/wallpaper-choice.cjs';

const main = await fs.readFile(new URL('../main.cjs', import.meta.url), 'utf8');
const confirmSource = main.slice(main.indexOf('async function confirmWallpaper('), main.indexOf('function recoverWallpaperRenderer('));
const playbackSource = main.slice(main.indexOf("    handler('speech:playback'"), main.indexOf("    handler('wallpaper:control'"));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

async function characterFixture(t) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'rin-wallpaper-commit-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let fail = false, pending, writes = 0;
  const count = to => { if (to.endsWith('workspaces.json')) { writes++; if (fail) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
  const store = new WorkspaceStore(dir, { io: { ...fs,
    async open(path, ...args) { if (pending && path.endsWith('workspaces.json.tmp')) await pending.promise; return fs.open(path, ...args); },
    rename: async (from, to) => { count(to); return fs.rename(from, to); },
    renameSync: (from, to) => { count(to); renameSync(from, to); },
  } });
  await store.load(); await store.updateSettings({ qwenVoice: 'Vivian', voice: 48 });
  const context = vm.createContext({ store, isCharacter: characters.isCharacter, isWallpaperKind: choices.isWallpaperKind,
    wallpaperStatus: { phase: 'loading', character: 'male', wallpaperKind: 'artwork', requestId: 1 }, appliedWallpaperRequest: -1, wallpaperCommit: null,
    setTimeout, clearTimeout, presentation: () => ({ paused: false }), stopSpeech() {}, notifyWorkspace() {}, console: { error() {} } });
  vm.runInContext(confirmSource, context);
  t.after(async () => { context.cancelWallpaperCommit(); await store.queue.catch(() => {}); });
  const info = id => ({ ready: true, character: context.wallpaperStatus.character, wallpaperKind: 'artwork', requestId: id });
  const apply = async value => await context.confirmWallpaper(value) && context.finishWallpaper(value, true);
  return { store, context, info, apply, fail: value => fail = value, hold: () => pending = deferred(), writes: () => writes };
}

test('decoded character is not accepted on disk failure; explicit retry commits both default voices', async t => {
  const h = await characterFixture(t), previous = h.store.snapshot(); h.fail(true);
  assert.equal(await h.apply(h.info(1)), false);
  assert.deepEqual(h.store.snapshot(), previous); assert.equal(h.context.wallpaperStatus.phase, 'error');
  assert.equal(h.context.appliedWallpaperRequest, -1);
  h.fail(false); h.context.wallpaperStatus = { ...h.context.wallpaperStatus, phase: 'loading', requestId: 2 };
  assert.equal(await h.apply(h.info(2)), true);
  assert.equal(h.store.data.settings.character, 'male'); assert.equal(h.store.data.settings.qwenVoice, 'Dylan'); assert.equal(h.store.data.settings.voice, 58);
  assert.deepEqual(JSON.parse(await fs.readFile(h.store.file, 'utf8')).settings, h.store.data.settings);
  const reload = new WorkspaceStore(join(h.store.file, '..')); await reload.load();
  for (const key of ['character', 'wallpaperKind', 'qwenVoice', 'voice']) assert.equal(reload.data.settings[key], h.store.data.settings[key]);
});

test('pending preparations coalesce; a newer selection cancels an unpainted character without changing custom voices', async t => {
  const h = await characterFixture(t), gate = h.hold(), before = h.writes();
  const old = h.info(1), male = h.context.confirmWallpaper(old), duplicate = h.context.confirmWallpaper(old); await tick();
  h.context.wallpaperStatus = { phase: 'loading', character: 'female', wallpaperKind: 'artwork', requestId: 2 };
  const female = h.apply(h.info(2)); gate.resolve();
  assert.equal(await male, false); assert.equal(await duplicate, false); assert.equal(await female, true);
  assert.equal(h.writes() - before, 0); assert.equal(h.context.wallpaperStatus.phase, 'ready');
  assert.equal(h.store.data.settings.character, 'female'); assert.equal(h.store.data.settings.qwenVoice, 'Vivian');
  assert.equal(h.context.finishWallpaper(old, true), false); assert.equal(await h.context.confirmWallpaper(old), false);
  const writes = h.writes(); assert.equal(await h.apply(h.info(2)), true); assert.equal(h.writes(), writes, 'pose changes do not rewrite settings');
});

test('pause cancels prepared bytes; queued custom edits and a failed later choice retain the original persisted profile', async t => {
  const h = await characterFixture(t), original = await fs.readFile(h.store.file, 'utf8'), info = h.info(1);
  assert.equal(await h.context.confirmWallpaper(info), true);
  assert.equal(await fs.readFile(h.store.file, 'utf8'), original); assert.equal(h.store.data.settings.character, 'female');
  const edit = h.store.updateSettings({ qwenVoice: 'Serena', voice: 48, speed: 1.1 });
  assert.equal(h.context.finishWallpaper(info, false), false); await edit;
  h.context.wallpaperStatus = { phase: 'loading', character: 'male', wallpaperKind: 'artwork', requestId: 2 }; h.fail(true);
  assert.equal(await h.apply(h.info(2)), false);
  const saved = JSON.parse(await fs.readFile(h.store.file, 'utf8')).settings;
  assert.equal(saved.character, 'female'); assert.equal(saved.qwenVoice, 'Serena'); assert.equal(saved.speed, 1.1);
  h.context.wallpaperStatus = { phase: 'loading', character: 'female', wallpaperKind: 'artwork', requestId: 3 };
  assert.equal(await h.apply(h.info(3)), true); assert.equal(h.store.data.settings.qwenVoice, 'Serena');
});

test('renderer exit and preparation expiry release the store queue without accepting a late paint', async t => {
  const h = await characterFixture(t), timers = new Map(); let serial = 0;
  h.context.setTimeout = fn => { timers.set(++serial, fn); return serial; }; h.context.clearTimeout = id => timers.delete(id);
  const old = h.info(1); await h.context.confirmWallpaper(old);
  h.context.cancelWallpaperCommit(); await h.store.updateSettings({ speed: 1.1 });
  assert.equal(h.context.finishWallpaper(old, true), false); assert.equal(h.store.data.settings.character, 'female');
  h.context.wallpaperStatus = { phase: 'loading', character: 'male', requestId: 2 };
  const newer = h.info(2); await h.context.confirmWallpaper(newer); timers.values().next().value();
  await h.store.queue; assert.equal(h.context.wallpaperStatus.phase, 'error'); assert.equal(h.context.finishWallpaper(newer, true), false);
  assert.equal(h.store.data.settings.character, 'female'); assert.equal(timers.size, 0);
});

test('speech cleanup failure cannot publish settings, and post-commit notification failure cannot reject an accepted frame', async t => {
  const h = await characterFixture(t), original = await fs.readFile(h.store.file, 'utf8');
  h.context.stopSpeech = () => { throw new Error('chat disposed'); };
  assert.equal(await h.apply(h.info(1)), false); await h.store.queue;
  assert.equal(await fs.readFile(h.store.file, 'utf8'), original); assert.equal(h.store.data.settings.character, 'female');
  h.context.stopSpeech = () => {};
  h.context.wallpaperStatus = { phase: 'loading', character: 'male', requestId: 2 };
  const info = h.info(2); assert.equal(await h.context.confirmWallpaper(info), true);
  h.context.notifyWorkspace = () => { throw new Error('notification disposed'); };
  assert.equal(h.context.finishWallpaper(info, true), true);
  assert.equal(h.store.data.settings.character, 'male'); assert.equal(h.store.data.settings.qwenVoice, 'Dylan');
});

function playbackFixture() {
  const handlers = new Map(), waits = [], notices = [];
  const chat = { webContents: { send() {} } };
  const context = vm.createContext({ chat, captureTarget: null, suspended: false, screenLocked: false, speaking: false, playbackRevision: 0,
    notifyPresentation() { notices.push(context.speaking); }, speech: { stop: async () => {} }, console,
    applyAmbientBeforeAudio() { const gate = deferred(); waits.push(gate); return gate.promise; }, handler: (name, fn) => handlers.set(name, fn) });
  vm.runInContext(playbackSource + '\n' + main.slice(main.indexOf('function stopSpeech()'), main.indexOf('async function confirmWallpaper(')), context);
  return { context, waits, notices, play: active => handlers.get('speech:playback')({ sender: chat.webContents }, active) };
}

test('late failure from cancelled playback cannot clear the newer narration state', async () => {
  const h = playbackFixture(), old = h.play(true), rejected = assert.rejects(old, /old timeout/);
  await h.play(false); const newer = h.play(true);
  h.waits[0].reject(new Error('old timeout')); await rejected; assert.equal(h.context.speaking, true);
  h.waits[1].resolve(); await newer; assert.equal(h.context.speaking, true);
  await h.play(false); assert.equal(h.context.speaking, false);
});

test('late playback success cannot revive a stopped request; current failures still clear their own state', async () => {
  const h = playbackFixture(), old = h.play(true), cancelled = assert.rejects(old, /取消/);
  h.context.stopSpeech(); const newer = h.play(true), failed = assert.rejects(newer, /new timeout/);
  h.waits[0].resolve(); await cancelled; assert.equal(h.context.speaking, true);
  h.waits[1].reject(new Error('new timeout')); await failed; assert.equal(h.context.speaking, false);
});

test('a confirmed wallpaper exit releases audio waits and recovery reinstates acknowledgement protection', async t => {
  const handlers = new Map(), events = new Map(), timers = new Map(); let serial = 0, reloads = 0;
  const target = { provider: 'codex', cwd: 'project', threadId: 'thread' };
  const chat = { webContents: { on() {}, send() {} } };
  const avatar = { isDestroyed: () => false, webContents: { on: (name, fn) => events.set(name, fn), reload() { reloads++; events.get('did-start-loading')(); } } };
  const barrier = new AmbientBarrier({ publish() {}, timeout: 15 }); t.after(() => barrier.close());
  const context = vm.createContext({ chat, avatar, wallpaperMode: true, ambientBarrier: barrier, store: { data: { settings: { ambienceEnabled: false } } },
    captureTarget: null, captureTimer: null, provider: 'codex', changingProvider: false, suspended: false, screenLocked: false, speaking: false, playbackRevision: 0, submissions: { active: new Set() },
    wallpaperStatus: { phase: 'ready', character: 'female', requestId: 0, frameRevision: 20, pose: 'window' }, ambienceStatus: {}, lastPresentation: '',
    notifyPresentation() {}, notifyWorkspace() {}, stopSpeech() {}, cancelWallpaperCommit() {}, showWorkbench() {}, speech: { status: () => ({ asr: true }) }, backend: { state: target },
    setTimeout: callback => { const id = ++serial; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    handler: (name, fn) => handlers.set(name, fn) });
  vm.runInContext(main.match(/^const applyAmbientBeforeAudio = .*;$/m)[0], context);
  vm.runInContext(main.slice(main.indexOf("    chat.webContents.on('render-process-gone'"), main.indexOf('    const handler =')), context);
  vm.runInContext(main.slice(main.indexOf('function recoverWallpaperRenderer('), main.indexOf('function switchAllowed()')), context);
  vm.runInContext(main.slice(main.indexOf("    handler('speech:capture'"), main.indexOf('    const { speechProfile }')) + playbackSource, context);
  const event = { sender: chat.webContents }, capture = value => handlers.get('speech:capture')(event, value), play = value => handlers.get('speech:playback')(event, value);
  const waiting = capture({ ...target }); events.get('render-process-gone')(); await waiting;
  assert.equal(barrier.stopped, true); await capture(null);
  await play(true); assert.equal(context.speaking, true); await play(false);
  await capture({ ...target }); await capture(null);
  context.recoverWallpaperRenderer(); assert.equal(reloads, 1); assert.equal(barrier.stopped, false); assert.equal(context.wallpaperStatus.phase, 'loading');
  assert.equal(context.wallpaperStatus.frameRevision, undefined); assert.equal(context.wallpaperStatus.pose, undefined);
  await assert.rejects(capture({ ...target }), /未能及时静音/); assert.equal(context.captureTarget, null);
  // Turning ambience off cannot prove a hung audio owner is silent.
  const ready = capture({ ...target }); barrier.acknowledge(barrier.revision); await ready; await capture(null);
  context.recoverWallpaperRenderer(); assert.equal(reloads, 1, 'a responsive owner is not reloaded');
  assert.equal(timers.size, 0);
});
