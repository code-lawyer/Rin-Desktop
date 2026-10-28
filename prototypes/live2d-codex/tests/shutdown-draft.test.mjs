import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createDraftSession } from '../renderer/draft-session.mjs';

const main = await readFile(new URL('../main.cjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../renderer/app.js', import.meta.url), 'utf8');
const handlerSource = main.slice(main.indexOf('    const handler ='), main.indexOf("    handler('companion:snapshot'"));
const draftSource = main.slice(main.indexOf("    handler('workbench:draft'"), main.indexOf("    handler('workbench:settings'"));
const quitSource = main.slice(main.indexOf('  function flushChatDraft()'), main.indexOf("  app.on('window-all-closed'"));
const rendererSource = app.slice(app.indexOf('function installDraftShutdown()'), app.indexOf('function restoreDraft('));
const inputSource = app.slice(app.indexOf("  $('prompt').addEventListener('input'"), app.indexOf('  const resizeObserver'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

async function fixture({ autoFlush = true, hasRenderer = true, crashed = false } = {}) {
  const handlers = new Map(), ipcEvents = new Map(), appEvents = new Map(), rendererEvents = new Map();
  const timers = new Map(), inputTimers = new Map(), messages = [], errors = [], events = [], saved = new Map();
  let timerId = 0, fail = false, writeGate;
  const prompt = { value: '', readOnly: false, focus() {}, addEventListener: (name, fn) => rendererEvents.set(name, fn) };
  const key = target => `${target.provider}|${target.cwd}|${target.threadId}`;
  const store = {
    queue: Promise.resolve(),
    draftSnapshot: target => ({ text: saved.get(key(target)) || '', dictationIds: [] }),
    saveDraft(target, text) {
      this.queue = this.queue.catch(() => {}).then(async () => {
        if (writeGate) await writeGate.promise;
        if (fail) throw new Error('disk full');
        saved.set(key(target), text); events.push('saved');
      });
      return this.queue;
    },
  };
  const sender = { isDestroyed: () => false, isCrashed: () => crashed,
    send(channel, value) {
      messages.push({ channel, value });
      if (channel === 'draft:flush' && autoFlush) rendererEvents.get(channel)?.(value);
      if (channel === 'draft:flush-cancelled') rendererEvents.get(channel)?.(value);
    },
  };
  const chat = hasRenderer ? { isDestroyed: () => false, webContents: sender } : null;
  const event = { sender, senderFrame: { url: 'app://local/renderer/index.html' } };
  const context = vm.createContext({
    closing: false, quitting: false, draftFlushRequest: null, draftFlushSerial: 0, pendingRelaunch: null, pendingDataSelection: null,
    changingProvider: false, changingData: false, provider: 'codex', submissions: { active: new Set() },
    trusted: candidate => candidate.sender === sender && candidate.senderFrame?.url === event.senderFrame.url,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => ipcEvents.set(name, fn) },
    store, chat, app: { on: (name, fn) => appEvents.set(name, fn), exit: () => events.push('exit'), relaunch: () => events.push('relaunch') },
    globalShortcut: { unregisterAll: () => events.push('shortcuts-off') }, registerShortcuts: () => events.push('shortcuts-restored'),
    tray: { destroy: () => events.push('tray-destroyed') }, captureTimer: null, ambientBarrier: { close() {} }, cancelWallpaperCommit() {},
    remote: null, voiceResources: null, speech: null, wallpaperHost: null, backend: { close: async () => events.push('backend-closed') }, providerChange: null, characterBox: null,
    showChat: () => events.push('show-chat'), dialog: { showErrorBox: (_title, message) => errors.push(message) },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(handlerSource + draftSource + quitSource, context);
  const request = (...args) => handlers.get('workbench:draft')(event, ...args);
  const drafts = createDraftSession({ request, getText: () => prompt.value, setText: value => { prompt.value = value; }, error: message => errors.push(message) });
  const target = { provider: 'codex', cwd: 'project', threadId: 'thread' };
  drafts.restore(target); await tick();
  const renderer = vm.createContext({
    quitRequest: null, draftTimer: null, drafts, $: () => prompt, window: { addEventListener: (name, fn) => rendererEvents.set(name, fn) },
    api: { onDraftFlush: fn => rendererEvents.set('draft:flush', fn), onDraftFlushCancelled: fn => rendererEvents.set('draft:flush-cancelled', fn),
      draftFlushed: (id, result) => ipcEvents.get('draft:flushed')(event, id, result) },
    speechControls: { cancelCapture: async () => events.push('capture-cancelled') }, composerControls: { refresh() {} },
    error: message => errors.push(message), growPrompt() {}, saveDraft: () => drafts.save(),
    setTimeout: callback => { const id = ++timerId; inputTimers.set(id, callback); return id; }, clearTimeout: id => inputTimers.delete(id),
  });
  vm.runInContext(rendererSource + '\ninstallDraftShutdown();\n' + inputSource, renderer);
  return { context, renderer, store, drafts, target, prompt, saved, events, messages, errors, timers, inputTimers,
    edit(text) { prompt.value = text; rendererEvents.get('input')(); },
    quit: () => appEvents.get('before-quit')({ preventDefault() {} }),
    invoke: (name, ...args) => handlers.get(name)(event, ...args),
    acknowledge: (id, result = { ok: true }, candidate = event) => ipcEvents.get('draft:flushed')(candidate, id, result),
    setFailure: value => { fail = value; }, pauseWrites: () => { writeGate = gate(); return writeGate; }, key,
  };
}

test('normal quit saves the last input before its debounce and closes only after acknowledgement', async () => {
  const h = await fixture(); h.edit('last input before quitting');
  assert.equal(h.inputTimers.size, 1); h.quit(); await tick();
  assert.equal(h.inputTimers.size, 0);
  assert.equal(h.saved.get(h.key(h.target)), 'last input before quitting');
  assert.ok(h.events.indexOf('saved') < h.events.indexOf('backend-closed'));
  assert.equal(h.events.at(-1), 'exit'); assert.equal(h.context.closing, true); assert.deepEqual(h.errors, []);
});

test('quit waits for an already pending save even when the draft is no longer dirty', async () => {
  const h = await fixture(), pending = h.pauseWrites(); h.edit('pending write');
  const save = h.drafts.save(); h.quit(); await tick();
  assert.equal(h.events.includes('backend-closed'), false); assert.equal(h.prompt.readOnly, true);
  pending.resolve(); await save; await tick();
  assert.equal(h.saved.get(h.key(h.target)), 'pending write'); assert.equal(h.events.at(-1), 'exit');
});

test('failed draft persistence aborts quit, preserves editing and can be retried', async () => {
  const h = await fixture(); h.setFailure(true); h.edit('keep this draft'); h.quit(); await tick();
  assert.equal(h.events.includes('exit'), false); assert.equal(h.events.includes('backend-closed'), false);
  assert.equal(h.context.quitting, false); assert.equal(h.prompt.readOnly, false); assert.equal(h.prompt.value, 'keep this draft');
  assert.ok(h.errors.some(value => value.includes('退出已取消'))); assert.ok(h.events.includes('shortcuts-restored'));
  h.setFailure(false); h.edit('keep this draft and the next edit'); h.quit(); await tick();
  assert.equal(h.saved.get(h.key(h.target)), 'keep this draft and the next edit'); assert.equal(h.events.at(-1), 'exit');
});

test('a requested restart is scheduled only after draft confirmation and discarded when quit fails', async () => {
  for (const fail of [false, true]) {
    const h = await fixture(); h.setFailure(fail); h.edit('draft before restart'); h.context.pendingRelaunch = { args: ['--mode=avatar'] };
    h.quit(); await tick();
    if (!fail) assert.ok(h.events.indexOf('saved') < h.events.indexOf('relaunch'));
    else {
      assert.equal(h.events.includes('relaunch'), false); assert.equal(h.context.pendingRelaunch, null);
      h.setFailure(false); h.quit(); await tick(); assert.equal(h.events.includes('relaunch'), false);
    }
    assert.equal(h.events.at(-1), 'exit');
  }
});

for (const outcome of ['success', 'save-failure', 'timeout', 'pointer-failure']) test(`data selection waits for draft confirmation: ${outcome}`, async () => {
  const h = await fixture({ autoFlush: outcome !== 'timeout' }); let pointer = 'original';
  h.context.pendingDataSelection = async () => {
    if (outcome === 'pointer-failure') throw new Error('pointer write failed');
    pointer = 'selected'; h.events.push('pointer-changed');
  };
  h.context.pendingRelaunch = { args: ['--storage=selected'] };
  if (outcome === 'save-failure') h.setFailure(true);
  h.edit('draft before data selection'); h.quit();
  if (outcome === 'timeout') [...h.timers.values()][0]();
  await tick();
  if (outcome === 'success') {
    assert.equal(pointer, 'selected'); assert.ok(h.events.indexOf('saved') < h.events.indexOf('pointer-changed')); assert.ok(h.events.indexOf('pointer-changed') < h.events.indexOf('relaunch')); assert.equal(h.events.at(-1), 'exit');
  } else {
    assert.equal(pointer, 'original'); assert.equal(h.events.includes('exit'), false); assert.equal(h.events.includes('relaunch'), false);
    assert.equal(h.context.pendingDataSelection, null); assert.equal(h.context.quitting, false);
  }
});

test('flush retries unsaved copies from other conversations without mixing their targets', async () => {
  const h = await fixture(), other = { ...h.target, provider: 'claude', threadId: 'other' };
  h.setFailure(true); h.edit('first target'); await h.drafts.save(); h.drafts.restore(other); await tick();
  h.edit('second target'); h.setFailure(false); h.quit(); await tick();
  assert.equal(h.saved.get(h.key(h.target)), 'first target'); assert.equal(h.saved.get(h.key(other)), 'second target');
  assert.equal(h.events.at(-1), 'exit');
});

test('unresponsive renderer aborts quit and late or untrusted acknowledgements cannot close a later attempt', async () => {
  const h = await fixture({ autoFlush: false }); h.quit(); h.quit();
  assert.equal(h.messages.filter(value => value.channel === 'draft:flush').length, 1);
  const first = h.messages.at(-1).value; [...h.timers.values()][0](); await tick();
  assert.equal(h.events.includes('exit'), false); assert.equal(h.context.quitting, false);
  h.quit(); const second = h.messages.at(-1).value; assert.notEqual(first, second);
  h.acknowledge(first); h.acknowledge(second, { ok: true }, { sender: {}, senderFrame: { url: 'app://local/renderer/index.html' } });
  await tick(); assert.equal(h.events.includes('exit'), false);
  h.acknowledge(second); await tick(); assert.equal(h.events.filter(value => value === 'exit').length, 1);
});

test('a timed-out write cannot acknowledge a cancelled quit after editing resumes', async () => {
  const h = await fixture(), pending = h.pauseWrites(); h.edit('first edit'); h.quit(); await tick();
  [...h.timers.values()][0](); await tick();
  assert.equal(h.prompt.readOnly, false); h.edit('newer edit after timeout'); pending.resolve(); await tick();
  assert.equal(h.events.includes('exit'), false);
  h.quit(); await tick(); assert.equal(h.saved.get(h.key(h.target)), 'newer edit after timeout'); assert.equal(h.events.at(-1), 'exit');
});

for (const absent of ['missing', 'crashed']) test(`${absent} renderer still drains dispatched writes before quit`, async () => {
  const h = await fixture({ hasRenderer: absent !== 'missing', crashed: absent === 'crashed' }), pending = h.pauseWrites();
  const write = h.store.saveDraft(h.target, 'already dispatched'); h.quit(); await tick();
  assert.equal(h.messages.length, 0); assert.equal(h.events.includes('exit'), false);
  pending.resolve(); await write; await tick(); assert.equal(h.events.at(-1), 'exit');
});

test('shutdown allows draft writes while rejecting new work, then closes the draft IPC gate', async () => {
  const h = await fixture({ autoFlush: false });
  vm.runInContext("handler('companion:send', () => { throw new Error('must not run'); });", h.context);
  h.quit(); await h.drafts.save();
  const refused = await h.invoke('companion:send', 'new task'); assert.equal(refused.ok, false); assert.match(refused.error, /保存草稿并退出/);
  h.edit('saved during shutdown'); await h.drafts.save();
  assert.equal(h.saved.get(h.key(h.target)), 'saved during shutdown');
  const id = h.messages.find(value => value.channel === 'draft:flush').value; h.acknowledge(id); await tick();
  h.edit('too late'); await h.drafts.save(); assert.equal(h.saved.get(h.key(h.target)), 'saved during shutdown');
  assert.ok(h.errors.includes('应用正在退出。'));
});

test('unbound nonempty text refuses flush instead of claiming it was saved', async () => {
  const drafts = createDraftSession({ request: assert.fail, getText: () => 'unbound text', setText() {}, error: assert.fail });
  await assert.rejects(drafts.flush(), /尚未绑定到对话/);
});
