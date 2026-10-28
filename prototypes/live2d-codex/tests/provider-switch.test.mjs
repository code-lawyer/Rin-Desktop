import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the actual main-process boundaries with controlled I/O and no Electron,
// hardware or CLI. A deferred dependency exposes each shutdown interleaving.
const main = await readFile(new URL('../main.cjs', import.meta.url), 'utf8');
const change = main.slice(main.indexOf('async function changeProvider('), main.indexOf('function positionChat()'));
const quit = main.slice(main.indexOf("  app.on('before-quit'"), main.indexOf("  app.on('window-all-closed'"));
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const stage of ['construct', 'old-close', 'mkdir', 'write', 'connect']) {
  test(`quit during provider ${stage} waits for ownership and never revives a closed backend`, async () => {
    const entered = gate(), release = gate(), disposed = gate(), events = [];
    const pause = async name => { if (stage === name) { entered.resolve(); await release.promise; } };
    const old = { busy: false, removeAllListeners() {}, async close() { await pause('old-close'); } };
    const replacement = {
      closed: false, snapshot() { return {}; },
      async close() { this.closed = true; events.push('dispose'); await disposed.promise; },
      async connect() { assert.equal(this.closed, false); events.push('connect'); await pause('connect'); }
    };
    let beforeQuit;
    const context = vm.createContext({
      closing: false, quitting: false, pendingDataSelection: null, pendingRelaunch: null, flushChatDraft: async () => {}, backend: old, store: {}, provider: 'codex', changingProvider: false, providerChange: null,
      captureTarget: null, avatar: null, chat: null, workbench: null, previousState: null, rememberedTarget: null,
      tray: null, storageDir: 'fixture', stopSpeech() {}, isCliAgent: () => true, bindBackend() {},
      makeBackend: async () => { await pause('construct'); return replacement; },
      mkdir: () => pause('mkdir'), writeFile: () => pause('write'), join: (...parts) => parts.join('/'), agentName: kind => kind,
      app: { on: (_name, fn) => beforeQuit = fn, exit: () => events.push('exit') },
      globalShortcut: { unregisterAll() {} }, clearTimeout() {}, captureTimer: null, ambientBarrier: {close() {}}, cancelWallpaperCommit() {},
      remote: null, voiceResources: null, speech: null, wallpaperHost: null, characterBox: null
    });
    vm.runInContext(change + '\n' + quit, context);
    const switching = context.changeProvider('claude');
    await entered.promise;
    beforeQuit({ preventDefault() {} });
    await tick(); // Draft confirmation precedes the existing resource shutdown.
    release.resolve(); await tick();
    assert.equal(events.includes('exit'), false, 'Quit waits for replacement disposal');
    disposed.resolve(); await switching; await tick();
    assert.equal(replacement.closed, true);
    assert.equal(events.filter(event => event === 'connect').length, stage === 'connect' ? 1 : 0);
    assert.equal(events.at(-1), 'exit');
    assert.equal(context.changingProvider, false); assert.equal(context.providerChange, null);
    await assert.rejects(context.changeProvider('codex'), /退出/);
  });
}

test('a failed quit preparation does not strand an already running provider switch', async () => {
  const release = gate(), entered = gate(), events = [];
  const old = { busy: false, removeAllListeners() {}, async close() { entered.resolve(); await release.promise; } };
  const replacement = { closed: false, snapshot: () => ({}), async close() { this.closed = true; }, async connect() { events.push('connected'); } };
  let beforeQuit;
  const context = vm.createContext({
    closing: false, quitting: false, pendingDataSelection: null, pendingRelaunch: null, backend: old, store: {}, provider: 'codex', changingProvider: false, providerChange: null,
    captureTarget: null, avatar: null, chat: null, workbench: null, previousState: null, rememberedTarget: null,
    tray: null, storageDir: 'fixture', stopSpeech() {}, isCliAgent: () => true, bindBackend() {},
    makeBackend: async () => replacement, mkdir: async () => {}, writeFile: async () => {}, join: (...parts) => parts.join('/'), agentName: kind => kind,
    app: { on: (_name, fn) => beforeQuit = fn, exit: () => events.push('exit') },
    globalShortcut: { unregisterAll() {} }, registerShortcuts() {}, clearTimeout() {}, captureTimer: null, ambientBarrier: { close() {} }, cancelWallpaperCommit() {},
    flushChatDraft: async () => { throw new Error('draft write failed'); }, dialog: { showErrorBox() {} },
    remote: null, voiceResources: null, speech: null, wallpaperHost: null, characterBox: null,
  });
  vm.runInContext(change + '\n' + quit, context);
  const switching = context.changeProvider('claude'); await entered.promise;
  beforeQuit({ preventDefault() {} }); await tick();
  assert.equal(context.quitting, false); assert.equal(context.closing, false);
  release.resolve(); await switching;
  assert.equal(context.backend, replacement); assert.equal(replacement.closed, false); assert.deepEqual(events, ['connected']);
});
