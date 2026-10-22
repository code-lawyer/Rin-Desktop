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
      closing: false, backend: old, store: {}, provider: 'codex', changingProvider: false, providerChange: null,
      captureTarget: null, avatar: null, chat: null, workbench: null, previousState: null, rememberedTarget: null,
      tray: null, storageDir: 'fixture', stopSpeech() {}, isCliAgent: () => true, bindBackend() {},
      makeBackend: async () => { await pause('construct'); return replacement; },
      mkdir: () => pause('mkdir'), writeFile: () => pause('write'), join: (...parts) => parts.join('/'), agentName: kind => kind,
      app: { on: (_name, fn) => beforeQuit = fn, exit: () => events.push('exit') },
      globalShortcut: { unregisterAll() {} }, clearTimeout() {}, captureTimer: null,
      remote: null, voiceResources: null, speech: null, wallpaperHost: null, characterBox: null
    });
    vm.runInContext(change + '\n' + quit, context);
    const switching = context.changeProvider('claude');
    await entered.promise;
    beforeQuit({ preventDefault() {} });
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
