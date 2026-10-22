import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeAgent } from '../backend/native-agent.mjs';
import { ClaudeCompanion } from '../backend/claude-agent.mjs';
import { AcpCompanion } from '../backend/acp-agent.mjs';
import { CodexCompanion } from '../backend/codex.mjs';
import { currentReply, restoreHistory } from '../backend/reply-state.mjs';
import { WorkspaceStore } from '../backend/workspace-store.mjs';
import { ResidentSpeech } from '../backend/resident-speech.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'rin-contract-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
class FakeNative extends NativeAgent {
  constructor(options) {
    super(options); this.binary = 'unused'; this.opened = []; this.transport = { closed: false };
    Object.assign(this.state, { connection: 'ready', status: 'idle', threadId: 'original', messages: [] });
  }
  async persist() {}
  async cancelNative() {}
  async disposeNative() {
    const transport = this.transport; this.transport = null;
    if (transport) { await this.disposeWait?.promise; transport.closed = true; }
  }
  async openNative() {
    const transport = { closed: false }; this.opened.push(transport); this.transport = transport;
    await this.openWait?.promise;
    this.state.threadId ||= 'new';
  }
}

for (const outcome of [undefined, 'completed', 'interrupted', 'failed']) test(`cached native history preserves text and requires an explicit successful outcome: ${outcome}`, async t => {
  const path = await directory(t), agent = new NativeAgent({ provider: 'claude', projectRoot: path, storageDir: path });
  await mkdir(agent.storageDir, { recursive: true });
  const messages = [{ id: 'reply', turnId: 'turn', role: 'assistant', text: 'saved reply', complete: true, turnStatus: outcome }];
  await writeFile(join(agent.storageDir, 'index.json'), JSON.stringify({ format: 1, provider: 'claude', sessions: { saved: { id: 'saved', cwd: path, messages } } }));
  await writeFile(join(agent.storageDir, 'session.json'), JSON.stringify({ format: 1, provider: 'claude', cwd: path, threadId: 'saved' }));
  await agent.load();
  assert.equal(agent.state.messages[0].text, 'saved reply');
  assert.equal(agent.state.messages[0].turnStatus, outcome ?? 'unknown');
  assert.equal(currentReply(agent.state.messages).readable, outcome === 'completed');
});

for (const provider of ['claude', 'grok', 'opencode']) test(`${provider}: new/resume/send cannot overlap a pending conversation switch`, async t => {
  const path = await directory(t), c = new FakeNative({ provider, projectRoot: path, storageDir: path });
  c.known.set('saved', { id: 'saved', cwd: path });
  const first = c.newConversation(path);
  await assert.rejects(c.newConversation(path), /停止|切换/);
  await assert.rejects(c.resumeConversation('saved', path), /停止|切换/);
  await assert.rejects(c.send('must not be submitted'), /停止|切换/);
  await first;
  assert.equal(c.opened.length, 1); assert.equal(c.busy, false);
  assert.equal(c.opened.filter(item => !item.closed).length, 1);
  await c.close(); assert.ok(c.opened.every(item => item.closed));
});

test('invalid directory preserves the live session and releases the switch lock', async t => {
  const path = await directory(t), c = new FakeNative({ provider: 'claude', projectRoot: path, storageDir: path });
  const original = c.transport;
  await assert.rejects(c.newConversation(join(path, 'missing')));
  assert.equal(c.state.threadId, 'original'); assert.equal(c.transport, original);
  assert.equal(c.state.status, 'idle'); assert.equal(c.busy, false);
  await c.newConversation(path); assert.equal(c.opened.length, 1); await c.close();
});

test('closing while directory validation is pending cannot open a new transport', async t => {
  const path = await directory(t), c = new FakeNative({ provider: 'claude', projectRoot: path, storageDir: path });
  const pending = c.newConversation(path), rejected = assert.rejects(pending, /关闭/);
  await c.close(); await rejected;
  assert.equal(c.opened.length, 0);
  await assert.rejects(c.newConversation(path), /关闭|停止/);
});

test('closing while native open is pending disposes the owned transport without a ready event', async t => {
  const path = await directory(t), c = new FakeNative({ provider: 'claude', projectRoot: path, storageDir: path });
  c.openWait = deferred(); let changedAfterClose = 0;
  c.on('state', () => { if (c.closed) changedAfterClose++; });
  const started = deferred(), originalOpen = c.openNative.bind(c);
  c.openNative = () => { const result = originalOpen(); started.resolve(); return result; };
  const pending = c.newConversation(path), rejected = assert.rejects(pending, /关闭/);
  await started.promise; await c.close(); c.openWait.resolve(); await rejected;
  assert.ok(c.opened.every(item => item.closed)); assert.equal(changedAfterClose, 0);
});

for (const provider of ['claude', 'grok', 'opencode']) test(`${provider}: app close waits for the old transport already being disposed during a switch`, async t => {
  const path = await directory(t), options = { provider, projectRoot: path, storageDir: path };
  const c = provider === 'claude' ? new ClaudeCompanion(options) : new AcpCompanion(options);
  Object.assign(c.state, { connection: 'ready', status: 'idle', threadId: 'old' });
  c.binary = 'unused'; c.persist = async () => {};
  c.openNative = async () => { assert.fail('closed switch must never open a replacement'); };
  const entered = deferred(); let inputEnded = 0, queryClosed = 0;
  // Synthetic child: no spawn, and the exit is released before any kill deadline.
  const child = Object.assign(new EventEmitter(), { pid: 2147483647, exitCode: null, signalCode: null,
    stdin: { end() { inputEnded++; entered.resolve(); } } });
  const exit = () => { child.exitCode = 0; child.emit('exit', 0); };
  t.after(exit);
  if (provider === 'claude') c.transport = { input: { close() {} }, children: [child], q: { close() { queryClosed++; } }, reader: Promise.resolve(), closing: false };
  else { const ep = { child, closing: false }; c.endpoints.add(ep); c.active = ep; }
  const switching = c.newConversation(path), rejected = assert.rejects(switching, /关闭/);
  await entered.promise;
  let closeReturned = false;
  const closing = c.close(); assert.equal(c.close(), closing);
  const finished = closing.then(() => { closeReturned = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closeReturned, false); assert.equal(inputEnded, 1);
  exit(); await finished; await rejected;
  assert.equal(closeReturned, true);
  if (provider === 'claude') { assert.equal(c.transport, null); assert.equal(queryClosed, 1); }
  else assert.equal(c.endpoints.size, 0);
});

test('Codex closed during initial filesystem work never starts its backend', async t => {
  const path = await directory(t); let spawns = 0;
  const c = new CodexCompanion({ projectRoot: path, storageDir: path, binary: process.execPath, spawnServer: () => { spawns++; throw new Error('must not spawn'); } });
  const start = c.connect(); await c.close(); await start;
  assert.equal(spawns, 0); assert.equal(c.rpc, null);
});

test('Codex closed during initialization rejects late protocol work and emits no ready state', async t => {
  const path = await directory(t), initialized = deferred(), calls = [];
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
  child.stdin.on('data', chunk => { const message = JSON.parse(String(chunk)); calls.push(message.method); if (message.method === 'initialize') initialized.resolve(); });
  const c = new CodexCompanion({ projectRoot: path, storageDir: path, binary: process.execPath, spawnServer: () => child });
  const states = []; c.on('state', state => states.push(state));
  const start = c.connect(); await initialized.promise; await c.close(); await start;
  assert.equal(c.rpc.closed, true); assert.deepEqual(calls, ['initialize']);
  assert.equal(states.some(state => state.connection === 'ready'), false);
  c.onNotification({ method: 'turn/started', params: { turn: { id: 'late' } } });
  assert.equal(c.state.turnId, null);
});

test('native completion text is exactly the visible final answer after tool commentary', async t => {
  const path = await directory(t), c = new FakeNative({ provider: 'claude', projectRoot: path, storageDir: path }), replies = [];
  c.promptNative = async () => {
    c.appendText('检查项目。'); c.state.messages.at(-1).complete = true; c.state.messages.at(-1).phase = 'commentary';
    c.appendText('最终结果。');
  };
  c.on('reply-completed', reply => replies.push(reply));
  await c.send('fixture request'); await c.run;
  assert.equal(replies.length, 1); assert.equal(replies[0].text, currentReply(c.state.messages).text);
  assert.equal(replies[0].text, '最终结果。'); await c.close();
});

const transcript = (status, phase = null) => [
  { id: 'user', role: 'user', text: 'fixture request', turnId: 'turn', complete: true, turnStatus: status },
  { id: 'answer', role: 'assistant', text: 'fixture answer', turnId: 'turn', complete: true, turnStatus: status, phase },
];
for (const provider of ['claude', 'grok', 'opencode']) test(`${provider}: history restore retains success, interruption, failure and commentary semantics`, async t => {
  const path = await directory(t), options = { provider, projectRoot: path, storageDir: path };
  for (const status of ['completed', 'interrupted', 'failed', 'inProgress']) for (const phase of [null, 'commentary']) {
    const c = provider === 'claude' ? new ClaudeCompanion(options) : new AcpCompanion(options);
    Object.assign(c.state, { version: '2.0.0', threadId: 'session', connection: 'ready', status: 'idle', messages: transcript(status, phase) });
    if (provider === 'claude') {
      const end = deferred();
      const q = { accountInfo: async () => ({ apiKeySource: 'ANTHROPIC_API_KEY' }), supportedModels: async () => [], async *[Symbol.asyncIterator]() { await end.promise; }, close() { end.resolve(); } };
      c.sdk = { query: () => q, getSessionMessages: async () => transcript(status, phase).map(m => ({ uuid: m.id, type: m.role, message: { content: m.text } })) };
    } else {
      c.endpoint = async () => ({ init: { agentCapabilities: { loadSession: true } }, conn: { loadSession: async () => {
        for (const m of transcript(status, phase)) c.update({ sessionUpdate: m.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk', content: { type: 'text', text: m.text } });
        return { sessionId: 'session' };
      }, extNotification: async () => {} } });
    }
    const before = currentReply(c.state.messages);
    try {
      await c.openNative(); const after = currentReply(c.state.messages);
      assert.equal(after.readable, before.readable, `${status} / ${phase}`);
      assert.equal(after.text, before.text);
      assert.equal(c.state.messages.at(-1).turnStatus, status);
    } finally { await c.disposeNative(); }
  }
});

test('unknown, edited and ambiguous native history cannot inherit a successful outcome', () => {
  const raw = transcript('completed').map(({ turnStatus, turnId, ...message }) => ({ ...message, id: 'remote-' + message.id }));
  assert.equal(currentReply(restoreHistory(raw)).readable, false);
  const edited = structuredClone(raw); edited[1].text += ' externally changed';
  assert.equal(currentReply(restoreHistory(edited, transcript('completed'))).readable, false);
  const duplicates = [...transcript('completed'), ...transcript('interrupted')];
  assert.equal(currentReply(restoreHistory([...raw, ...raw], duplicates)).readable, false);
  const segmented = [transcript('completed')[0], { ...transcript('completed')[1], text: 'first', phase: 'commentary' }, { ...transcript('completed')[1], id: 'final', text: 'last', phase: 'final_answer' }];
  const merged = [raw[0], { ...raw[1], text: 'firstlast' }];
  assert.equal(currentReply(restoreHistory(merged, segmented)).text, 'last');
});

test('more than 100 unsent drafts survive cross-provider saves and a disk reload', async t => {
  const path = await directory(t), second = join(path, 'second'); await mkdir(second);
  const store = new WorkspaceStore(path); await store.load(); await store.add(path); await store.add(second);
  const original = { provider: 'codex', cwd: path, threadId: 'original' };
  await store.saveDraft(original, 'unsent original');
  for (let i = 0; i < 105; i++) await store.saveDraft({ provider: ['claude', 'grok', 'opencode'][i % 3], cwd: i % 2 ? path : second, threadId: String(i) }, 'unsent ' + i);
  const restored = new WorkspaceStore(path); await restored.load();
  assert.equal(restored.draft(original), 'unsent original'); assert.equal(Object.keys(restored.data.drafts).length, 106);
  await restored.saveDraft({ provider: 'claude', cwd: second, threadId: '0' }, '');
  assert.equal(restored.draft(original), 'unsent original'); assert.equal(Object.keys(restored.data.drafts).length, 105);
});

for (const mode of ['sync', 'sync-throw', 'async', 'async-reject']) test(`failed speech load cleans up a ${mode} worker and can retry`, async () => {
  let attempts = 0, closed = 0;
  const speech = new ResidentSpeech('unused', { factory: () => ({
    load() { if (++attempts === 1) throw new Error('model unavailable'); },
    close() { closed++; if (mode === 'sync-throw') throw new Error('close failed'); if (mode === 'async-reject') return Promise.reject(new Error('close failed')); if (mode === 'async') return Promise.resolve(); },
  }) });
  await speech.configure({ ttsEngine: 'kokoro', ttsResident: true });
  assert.equal(speech.phase, 'error'); assert.equal(speech.worker, null); assert.equal(closed, 1);
  assert.match(speech.error, /model unavailable/);
  await speech.configure({ ttsEngine: 'kokoro', ttsResident: true }); assert.equal(speech.phase, 'ready');
  // Teardown failures are surfaced as state; this test never owns a real worker.
  await speech.close(); assert.equal(closed, 2);
});

test('late failed-worker cleanup cannot replace a newer ready speech state', async () => {
  const cleaning = deferred(), cleaned = deferred(); let count = 0;
  const speech = new ResidentSpeech('unused', { factory: () => ++count === 1 ? {
    load() { throw new Error('old model failed'); }, close() { cleaning.resolve(); return cleaned.promise; }
  } : { load() {}, close() {} } });
  const first = speech.configure({ ttsEngine: 'kokoro', ttsResident: true });
  await cleaning.promise;
  await speech.configure({ ttsEngine: 'qwen', ttsResident: true });
  const readyWorker = speech.worker; assert.equal(speech.phase, 'ready');
  cleaned.resolve(); await first;
  assert.equal(speech.phase, 'ready'); assert.equal(speech.worker, readyWorker); assert.equal(speech.error, '');
  await speech.close();
});
