import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { installSpeech } from '../renderer/speech-ui.js';

const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(t, stage) {
  const globals = ['document', 'window', 'navigator', 'AudioContext', 'AudioWorkletNode'];
  const previous = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, value] of previous) value ? Object.defineProperty(globalThis, key, value) : delete globalThis[key]; });
  const nodes = new Map(), contexts = [], requests = [], inserted = [], errors = [], recognition = gate();
  const get = id => { if (!nodes.has(id)) nodes.set(id, { hidden: true, textContent: '', setAttribute() {} }); return nodes.get(id); };
  globalThis.document = { getElementById: get, addEventListener() {} };
  globalThis.window = { addEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } } });
  globalThis.AudioContext = class {
    constructor() { this.pending = gate(); this.closed = gate(); this.sampleRate = 16000; this.state = 'running'; this.sources = 0; this.destination = {}; this.audioWorklet = { addModule: () => stage === 'module' ? this.pending.promise : Promise.resolve() }; contexts.push(this); }
    resume() { return stage === 'resume' ? this.pending.promise : Promise.resolve(); }
    close() { this.state = 'closed'; return stage === 'close' ? this.closed.promise : Promise.resolve(); }
    createMediaStreamSource() { this.sources++; return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: {}, connect() {} }; }
  };
  globalThis.AudioWorkletNode = class {
    constructor() { this.port = { postMessage: () => queueMicrotask(() => this.port.onmessage({ data: 'flushed' })) }; }
    connect() {} disconnect() {}
  };
  const state = { provider: 'codex', cwd: 'project', threadId: 'thread', messages: [] };
  const api = {
    workspace: async () => ({ ok: true, value: { settings: {}, speech: {} } }), onWorkspace() {}, onSpeech() {},
    stopSpeech: async () => ({ ok: true }), capture: async target => { requests.push(target); return { ok: true }; },
    transcribe: () => recognition.promise
  };
  const control = installSpeech({ api, state: () => state, insert: text => inserted.push(text), error: e => errors.push(e), measure() {} });
  return { control, get, contexts, requests, recognition, inserted, errors, state };
}
for (const stage of ['module', 'resume']) {
  test(`cancel during audio ${stage} cannot install nodes or timers in a new capture`, async t => {
    const h = harness(t, stage); await tick();
    const first = h.control.toggleCapture(); await tick();
    await h.get('cancel-recording').onclick();
    const second = h.control.toggleCapture(); await tick();
    h.contexts[0].pending.resolve(); await first;
    assert.equal(h.contexts[1].sources, 0); assert.equal(h.get('record-button').textContent, '电脑听写');
    h.contexts[1].pending.resolve(); await second;
    assert.equal(h.contexts[0].sources, 0); assert.equal(h.contexts[1].sources, 1);
    await h.get('cancel-recording').onclick(); assert.deepEqual(h.errors, []);
  });
}
test('late AudioContext.close does not clear a new capture target or its controls', async t => {
  const h = harness(t, 'close'); await tick(); await h.control.toggleCapture();
  const cancelling = h.get('cancel-recording').onclick();
  await h.control.toggleCapture();
  h.contexts[0].closed.resolve(); await cancelling;
  assert.ok(h.requests.at(-1)); assert.equal(h.get('record-button').textContent, '完成听写');
  h.contexts[1].closed.resolve(); await h.get('cancel-recording').onclick();
  assert.deepEqual(h.errors, []);
});
test('cancelled recognition cannot release a new recording or insert its late text', async t => {
  const h = harness(t); await tick(); await h.control.toggleCapture();
  const finishing = h.control.toggleCapture(); await tick();
  await h.get('cancel-recording').onclick(); await h.control.toggleCapture();
  h.recognition.resolve({ ok: true, value: { text: 'old result' } }); await finishing;
  assert.ok(h.requests.at(-1)); assert.deepEqual(h.inserted, []); assert.equal(h.control.isCapturing(), true);
  await h.get('cancel-recording').onclick(); assert.deepEqual(h.errors, []);
});
test('recognition cannot fill another provider with the same directory and thread identifier', async t => {
  const h = harness(t); await tick(); await h.control.toggleCapture();
  const finishing = h.control.toggleCapture(); await tick(); h.state.provider = 'claude';
  h.recognition.resolve({ ok: true, value: { text: 'old provider result' } }); await finishing;
  assert.deepEqual(h.inserted, []); assert.deepEqual(h.errors, []);
});

for (const changed of [{ threadId: 'other-thread' }, { cwd: 'other-project', threadId: 'other-thread' }, { provider: 'claude' }]) {
  test(`recording retains its starting target when ${Object.keys(changed).join('/')} changes before stop`, async t => {
    const h = harness(t); await tick(); await h.control.toggleCapture();
    const original = { ...h.requests.find(value => value) };
    Object.assign(h.state, changed);
    const finishing = h.control.toggleCapture(); await tick();
    h.recognition.resolve({ ok: true, value: { text: 'belongs to the original target' } }); await finishing;
    assert.deepEqual(original, { provider: 'codex', cwd: 'project', threadId: 'thread' });
    assert.deepEqual(h.inserted, [], 'a target change during recording must not redirect recognized text');
    assert.equal(h.control.isCapturing(), false); assert.deepEqual(h.errors, []);
  });
}

test('recording still inserts into its unchanged starting target', async t => {
  const h = harness(t); await tick(); await h.control.toggleCapture();
  const finishing = h.control.toggleCapture(); await tick();
  h.recognition.resolve({ ok: true, value: { text: 'current target draft' } }); await finishing;
  assert.deepEqual(h.inserted, ['current target draft']); assert.deepEqual(h.errors, []);
});

const main = await readFile(new URL('../main.cjs', import.meta.url), 'utf8');
const captureHandlers = main.slice(main.indexOf("    handler('speech:capture'"), main.indexOf('    const { speechProfile }'));
function mainCaptureHarness(outcome = 'success') {
  const handlers = new Map(), timers = new Map(), recognition = gate(), cancelled = [];
  let timerId = 0;
  const target = { provider: 'codex', cwd: 'project', threadId: 'thread' };
  const chat = { webContents: { send: event => cancelled.push(event) } };
  const context = vm.createContext({
    captureTarget: null, captureTimer: null, changingProvider: false, provider: 'codex', suspended: false, screenLocked: false, submissions: { active: new Set() },
    notifyPresentation() {}, applyAmbientBeforeAudio: async () => {},
    chat, backend: { state: { ...target } }, showWorkbench() {}, stopSpeech() {},
    speech: { status: () => ({ asr: true }), transcribe: async () => {
      await recognition.promise;
      if (outcome === 'failure') throw new Error('recognition failed');
      return { text: 'old result' };
    } },
    handler: (name, callback) => handlers.set(name, callback),
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(captureHandlers, context);
  const event = { sender: chat.webContents };
  return { context, timers, recognition, cancelled,
    capture: () => handlers.get('speech:capture')(event, { ...target }),
    cancel: () => handlers.get('speech:capture')(event, null),
    transcribe: () => handlers.get('speech:transcribe')(event, {}) };
}

for (const phase of ['connecting', 'starting', 'configuring', 'lifecycle', 'submission', 'unassigned-thread']) {
  test(`computer and RC003 capture cannot begin during ${phase}`, async () => {
    const h = mainCaptureHarness();
    if (phase === 'lifecycle') h.context.backend.lifecycle = { active: Symbol('switch') };
    else if (phase === 'submission') h.context.submissions.active.add('codex');
    else if (phase === 'unassigned-thread') { h.context.backend.busy = true; Object.assign(h.context.backend.state, { status: 'working', threadId: null }); }
    else h.context.backend.state.status = phase;
    await assert.rejects(h.capture(), /连接、切换对话或发送任务/);
    assert.equal(h.context.captureTarget, null); assert.equal(h.timers.size, 0);

    Object.assign(h.context, { closing: false, quitting: false, changingData: false, voiceResources: { active: false } });
    const begin = main.slice(main.indexOf('      begin:async id => {'), main.indexOf('      transcribe:data =>'));
    vm.runInContext(`globalThis.remoteBegin = ({${begin}}).begin;`, h.context);
    await assert.rejects(h.context.remoteBegin('recording'), /切换、暂停或启动/);
    assert.equal(h.context.captureTarget, null);
  });
}

test('capture remains available for follow-up drafts during an established working turn', async () => {
  const h = mainCaptureHarness(); h.context.backend.busy = true; h.context.backend.state.status = 'working';
  await h.capture(); assert.ok(h.context.captureTarget); await h.cancel();
});

for (const outcome of ['success', 'failure']) test(`late main-process transcription ${outcome} preserves the new recording watchdog`, async () => {
  const h = mainCaptureHarness(outcome);
  await h.capture();
  const pending = h.transcribe();
  const completion = outcome === 'failure' ? assert.rejects(pending, /recognition failed/) : pending;
  await h.cancel(); await h.capture();
  const target = h.context.captureTarget, timer = h.context.captureTimer;
  h.recognition.resolve(); await completion;
  assert.equal(h.context.captureTarget, target);
  assert.equal(h.timers.has(timer), true, 'the new capture keeps its timeout');
  h.timers.get(timer)();
  assert.equal(h.context.captureTarget, null);
  assert.deepEqual(h.cancelled, ['speech:cancel']);
});

test('the owning main-process transcription clears its own target and watchdog', async () => {
  const h = mainCaptureHarness();
  await h.capture();
  const pending = h.transcribe();
  h.recognition.resolve(); await pending;
  assert.equal(h.context.captureTarget, null);
  assert.equal(h.context.captureTimer, null);
  assert.equal(h.timers.size, 0);
});

test('main capture remains pending until ambient mute is acknowledged and releases ownership on failure', async () => {
  const h=mainCaptureHarness(), muted=gate(); let opened=false;
  h.context.applyAmbientBeforeAudio=()=>muted.promise;
  const start=h.capture().then(()=>{opened=true;}); await tick();
  assert.equal(opened,false); assert.ok(h.context.captureTarget);
  muted.resolve(); await start; assert.equal(opened,true); await h.cancel();
  h.context.applyAmbientBeforeAudio=async()=>{throw new Error('mute failed');};
  await assert.rejects(h.capture(),/mute failed/); assert.equal(h.context.captureTarget,null); assert.equal(h.timers.size,0);
});
