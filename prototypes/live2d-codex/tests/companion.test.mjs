import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AvatarRpc } from '../backend/rpc.mjs';
import { CodexCompanion, cliEnvironment } from '../backend/codex.mjs';
import { approvalResult } from '../backend/approvals.mjs';

async function fixture(t) {
  const base = resolve(dirname(fileURLToPath(import.meta.url)), '../../../work/runtime/avatar-unit-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'case-'));
  if (!directory.startsWith(base + sep)) throw new Error('Test directory escaped workspace.');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const c = new CodexCompanion({ projectRoot: directory, storageDir: directory });
  c.state.connection = 'ready'; c.state.status = 'idle'; c.state.threadId = 'owned';
  c.rpc = { closed: false, reply() {}, reject() {}, request: async () => ({}) };
  return c;
}

function fakeServer(calls, resumed, accountType = 'chatgpt') {
  const child = new EventEmitter();
  child.accountType = accountType;
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
  child.stdin.on('data', bytes => {
    const { id, method, params } = JSON.parse(bytes.toString()); calls.push({ method, params });
    if (id === undefined) return;
    const result = method === 'account/read' ? { account: child.accountType ? { type: child.accountType } : null } :
      method === 'account/login/start' ? { type: 'chatgpt', loginId: 'test-login', authUrl: 'https://auth.openai.com/authorize?state=test-only' } :
      method === 'model/list' ? { data: [{ model: 'test-model', isDefault: true }] } :
      method === 'thread/resume' ? resumed ?? { thread: { id: params.threadId, turns: [] } } : {};
    child.stdout.write(JSON.stringify({ id, result }) + '\n');
  });
  return child;
}

test('first use signs in through the bundled CLI and ignores cancelled or unrelated login events', async t => {
  const base = await fixture(t), calls = [], child = fakeServer(calls, undefined, null);
  const c = new CodexCompanion({ projectRoot: base.projectRoot, storageDir: base.storageDir, binary: process.execPath, spawnServer: () => child });
  await c.connect(); t.after(() => c.close());
  assert.equal(c.state.connection, 'authentication'); assert.equal(c.state.login, null);
  assert.equal(calls.some(call => call.method === 'model/list'), false);
  assert.match(await c.startLogin(), /^https:\/\/auth\.openai\.com\//);
  await assert.rejects(c.startLogin(), /不能/);
  await c.completeLogin({ loginId: 'unrelated', success: true });
  assert.equal(c.state.connection, 'authentication');
  await c.cancelLogin(); child.accountType = 'chatgpt';
  await c.completeLogin({ loginId: 'test-login', success: true });
  assert.equal(c.state.connection, 'authentication');
  await c.startLogin(); await c.completeLogin({ loginId: 'test-login', success: true });
  assert.equal(c.state.connection, 'ready'); assert.equal(c.state.login, 'chatgpt');
  assert.equal(c.state.loginPending, false);
  assert.equal(JSON.stringify(c.snapshot()).includes('auth.openai.com'), false);
  assert.ok(calls.some(call => call.method === 'account/login/cancel'));
});

test('late login-start response cannot replace a newer login after cancellation', async t => {
  const c = await fixture(t), starts = [], cancelled = [];
  c.state.connection = 'authentication';
  c.rpc.request = (method, params) => method === 'account/login/start'
    ? new Promise(resolve => starts.push(resolve))
    : (cancelled.push(params.loginId), Promise.resolve({}));
  const first = c.startLogin();
  const rejected = assert.rejects(first, /取消/);
  await c.cancelLogin(); const second = c.startLogin();
  starts[1]({type:'chatgpt',loginId:'new',authUrl:'https://auth.openai.com/new'});
  await second;
  starts[0]({type:'chatgpt',loginId:'old',authUrl:'https://auth.openai.com/old'});
  await rejected;
  assert.equal(c.loginId, 'new'); assert.equal(c.state.loginPending, true);
  assert.deepEqual(cancelled, ['old']);
});

test('a stale login verification error cannot reset a successfully authenticated newer login', async t => {
  const c = await fixture(t); let failOld;
  c.state.connection = 'authentication'; c.loginId = 'old';
  c.rpc.request = () => new Promise((_, reject) => { failOld = reject; });
  const oldCompletion = c.completeLogin({loginId:'old',success:true});
  await c.cancelLogin(); c.loginId = 'new';
  c.rpc.request = async () => ({account:{type:'chatgpt'}});
  c.finishConnection = async () => { c.state.connection = 'ready'; };
  await c.completeLogin({loginId:'new',success:true});
  failOld(new Error('stale failure')); await oldCompletion;
  assert.equal(c.state.connection, 'ready'); assert.equal(c.state.error, null);
});

test('startup restores an active turn and rejects new sends and switches until that turn ends', async t => {
  const base = await fixture(t), calls = [];
  await writeFile(base.metadataPath, JSON.stringify({ format: 1, cwd: base.projectRoot, threadId: 'saved', model: 'test-model' }));
  const c = new CodexCompanion({ projectRoot: base.projectRoot, storageDir: base.storageDir, binary: process.execPath,
    spawnServer: () => fakeServer(calls, { thread: { id: 'saved', turns: [{ id: 'active', status: 'inProgress', items: [] }] } }) });
  await c.connect(); t.after(() => c.close());
  assert.equal(c.state.connection, 'ready'); assert.equal(c.state.turnId, 'active'); assert.equal(c.state.status, 'working'); assert.equal(c.busy, true);
  await assert.rejects(c.send('must not submit'), /等待/); await assert.rejects(c.newConversation(), /停止/);
  assert.equal(calls.some(call => call.method === 'turn/start'), false);
  await c.interrupt(); assert.ok(calls.some(call => call.method === 'turn/interrupt' && call.params.turnId === 'active'));
  c.onNotification({ method: 'turn/completed', params: { threadId: 'saved', turn: { id: 'active', status: 'interrupted' } } });
  assert.equal(c.busy, false); assert.equal(c.state.turnId, null);
});

test('a crash-interrupted historical turn restores as idle without a completion alert', async t => {
  const base = await fixture(t);
  await writeFile(base.metadataPath, JSON.stringify({ format: 1, cwd: base.projectRoot, threadId: 'saved', model: 'test-model' }));
  const c = new CodexCompanion({ projectRoot: base.projectRoot, storageDir: base.storageDir, binary: process.execPath,
    spawnServer: () => fakeServer([], { thread: { id: 'saved', turns: [{ id: 'ended', status: 'interrupted', items: [] }] } }) });
  const replies = []; c.on('reply-completed', event => replies.push(event));
  await c.connect(); t.after(() => c.close());
  assert.equal(c.state.status, 'idle'); assert.equal(c.state.turnId, null); assert.equal(c.busy, false); assert.deepEqual(replies, []);
});

test('an unavailable saved project keeps its identity and metadata until the directory is restored', async t => {
  const base = await fixture(t), calls = [], missing = join(base.projectRoot, 'temporarily-unavailable');
  const saved = JSON.stringify({ format: 1, cwd: missing, threadId: 'saved-thread', model: 'test-model' });
  await writeFile(base.metadataPath, saved);
  const create = () => new CodexCompanion({ projectRoot: base.projectRoot, storageDir: base.storageDir,
    binary: process.execPath, spawnServer: () => fakeServer(calls) });
  const c = create(); await c.connect();
  assert.equal(c.state.connection, 'ready'); assert.equal(c.state.status, 'error');
  assert.equal(c.state.cwd, missing); assert.equal(c.state.threadId, 'saved-thread');
  assert.equal(await readFile(c.metadataPath, 'utf8'), saved);
  assert.equal(calls.some(call => call.method === 'thread/resume'), false);
  await assert.rejects(c.send('do not use the fallback project'), /恢复/);
  await assert.rejects(c.newConversation());
  await assert.rejects(c.chooseModel('test-model'), /恢复/);
  assert.equal(c.state.status, 'error'); assert.equal(await readFile(c.metadataPath, 'utf8'), saved);
  await c.close(); await mkdir(missing);
  const reopened = create(); await reopened.connect();
  assert.equal(reopened.state.threadId, 'saved-thread'); assert.equal(reopened.state.restored, true);
  assert.equal(reopened.state.status, 'idle');
  assert.equal(calls.filter(call => call.method === 'thread/resume').length, 1);
  await reopened.close();
});

test('an unavailable project can be replaced only by an explicit valid project selection', async t => {
  const base = await fixture(t), calls = [], notDirectory = join(base.projectRoot, 'former-project');
  await writeFile(notDirectory, 'not a directory');
  const saved = JSON.stringify({ format: 1, cwd: notDirectory, threadId: 'saved-thread', model: 'test-model' });
  await writeFile(base.metadataPath, saved);
  const c = new CodexCompanion({ projectRoot: base.projectRoot, storageDir: base.storageDir,
    binary: process.execPath, spawnServer: () => fakeServer(calls) });
  await c.connect(); assert.equal(c.state.status, 'error');
  assert.equal(await readFile(c.metadataPath, 'utf8'), saved);
  await c.newConversation(base.projectRoot);
  assert.equal(c.state.status, 'idle'); assert.equal(c.state.threadId, null);
  assert.deepEqual(JSON.parse(await readFile(c.metadataPath, 'utf8')), { format: 1, cwd: base.projectRoot, threadId: null, model: 'test-model' });
  await c.close();
});

test('unreadable session metadata cannot silently create a replacement session', async t => {
  const base = await fixture(t), saved = '{invalid'; let starts = 0;
  await writeFile(base.metadataPath, saved);
  const c = new CodexCompanion({ projectRoot: base.projectRoot, storageDir: base.storageDir,
    binary: process.execPath, spawnServer: () => { starts++; return fakeServer([]); } });
  await c.connect();
  assert.equal(c.state.status, 'error'); assert.equal(starts, 0);
  assert.equal(await readFile(c.metadataPath, 'utf8'), saved); await c.close();
});

test('real-time completion before start acknowledgment does not leave the UI busy or duplicate messages', async t => {
  const c = await fixture(t);
  c.rpc.request = async (method, params) => {
    assert.equal(method, 'turn/start');
    c.onNotification({ method: 'turn/started', params: { threadId: 'owned', turn: { id: 'turn-1' } } });
    c.onNotification({ method: 'item/started', params: { threadId: 'owned', turnId: 'turn-1', item: { id: 'u1', type: 'userMessage', content: params.input } } });
    c.onNotification({ method: 'item/agentMessage/delta', params: { threadId: 'owned', turnId: 'turn-1', itemId: 'a1', delta: '回答' } });
    c.onNotification({ method: 'item/completed', params: { threadId: 'owned', turnId: 'turn-1', item: { id: 'a1', type: 'agentMessage', text: '回答' } } });
    c.onNotification({ method: 'turn/completed', params: { threadId: 'owned', turn: { id: 'turn-1', status: 'completed' } } });
    return { turn: { id: 'turn-1' } };
  };
  await c.send('问题');
  assert.equal(c.busy, false); assert.equal(c.state.turnId, null); assert.equal(c.state.messages.length, 2);
  assert.deepEqual(c.state.messages.map(m => [m.role, m.text]), [['user', '问题'], ['assistant', '回答']]);
});

test('a pending start prevents duplicate submissions and project changes', async t => {
  const c = await fixture(t); let release;
  c.rpc.request = () => new Promise(resolve => { release = resolve; });
  const first = c.send('只发送一次');
  await assert.rejects(c.send('重复发送'), /等待/);
  await assert.rejects(c.newConversation(), /停止/);
  release({ turn: { id: 'one' } }); await first;
  assert.equal(c.state.messages.length, 1);
});

test('stopping during first thread creation prevents task submission and permits a later intentional send', async t => {
  const c = await fixture(t), calls = []; let release;
  c.state.threadId = null;
  c.rpc.request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/start') return new Promise(resolve => { release = resolve; });
    assert.equal(method, 'turn/start'); return { turn: { id: 'intentional' } };
  };
  const sending = c.send('cancel this');
  await c.interrupt(); assert.equal(c.state.status, 'stopping');
  await assert.rejects(c.send('must wait'), /等待/);
  release({ thread: { id: 'created' } });
  assert.deepEqual(await sending, { accepted: false, cancelled: true });
  assert.deepEqual(calls.map(call => call.method), ['thread/start']);
  assert.equal(c.busy, false); assert.equal(c.state.messages.length, 0);
  assert.equal(JSON.parse(await readFile(c.metadataPath, 'utf8')).threadId, 'created');
  await c.send('intentional retry');
  assert.deepEqual(calls.map(call => call.method), ['thread/start', 'turn/start']);
  assert.equal(c.state.turnId, 'intentional');
});

test('stopping an unacknowledged turn interrupts its eventual ID without reading a premature thread', async t => {
  const c = await fixture(t), calls = []; let release;
  c.rpc.request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'turn/start') return new Promise(resolve => { release = resolve; });
    assert.equal(method, 'turn/interrupt'); assert.equal(params.turnId, 'late-turn');
    c.onNotification({ method: 'turn/completed', params: { threadId: 'owned', turn: { id: 'late-turn', status: 'interrupted' } } });
    return {};
  };
  const sending = c.send('stop before acknowledgment'); await c.interrupt();
  release({ turn: { id: 'late-turn' } }); await sending;
  assert.deepEqual(calls.map(call => call.method), ['turn/start', 'turn/interrupt']);
  assert.equal(c.state.status, 'idle'); assert.equal(c.state.turnId, null); assert.equal(c.busy, false);
});

test('a late started notification stops immediately and late approvals cannot revive a cancelled task', async t => {
  const c = await fixture(t), calls = [], replies = []; let release;
  c.rpc.reply = (id, result) => replies.push({ id, result });
  c.rpc.request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'turn/start') return new Promise(resolve => { release = resolve; });
    assert.equal(method, 'turn/interrupt'); return {};
  };
  const sending = c.send('cancel'); await c.interrupt();
  c.onNotification({ method: 'turn/started', params: { threadId: 'owned', turn: { id: 'late-turn' } } });
  c.onRequest({ id: 'late-approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'owned', turnId: 'late-turn' } });
  assert.equal(c.state.status, 'stopping'); assert.equal(c.state.approvals.length, 0);
  assert.deepEqual(replies, [{ id: 'late-approval', result: { decision: 'cancel' } }]);
  release({ turn: { id: 'late-turn' } }); await sending;
  assert.equal(calls.filter(call => call.method === 'turn/interrupt').length, 1);
  c.onNotification({ method: 'turn/completed', params: { threadId: 'owned', turn: { id: 'late-turn', status: 'interrupted' } } });
  assert.equal(c.busy, false); assert.equal(c.state.status, 'idle');
});

test('foreign and already completed turns cannot approve actions or reset the active turn', async t => {
  const c = await fixture(t); const rejected = [], accepted = [];
  c.rpc.reject = id => rejected.push(id); c.rpc.reply = (...args) => accepted.push(args);
  c.state.turnId = 'current'; c.state.status = 'working'; c.completedTurns.add('old');
  for (const [threadId, id] of [['other', 'current'], ['owned', 'old'], ['owned', 'unknown']]) c.onNotification({ method: 'turn/completed', params: { threadId, turn: { id, status: 'completed' } } });
  assert.equal(c.state.status, 'working'); assert.equal(c.state.turnId, 'current');
  for (const [id, threadId, turnId] of [[1, 'other', 'current'], [2, 'owned', 'old'], [3, 'owned', 'unknown']]) {
    c.onRequest({ id, method: 'item/commandExecution/requestApproval', params: { threadId, turnId } });
  }
  assert.deepEqual(rejected, [1, 2, 3]); assert.equal(c.state.approvals.length, 0); assert.equal(accepted.length, 0);
});

test('manual approvals retain the server ID, show file changes, and expire after response', async t => {
  const c = await fixture(t); const replies = [];
  c.rpc.reply = (id, result) => replies.push({ id, result });
  c.state.turnId = 'active';
  c.receiveItem({ type: 'fileChange', id: 'file1', changes: [{ path: 'example.txt', kind: { type: 'add' }, diff: '+hello' }] }, 'active');
  c.onRequest({ id: 17, method: 'item/fileChange/requestApproval', params: { threadId: 'owned', turnId: 'active', itemId: 'file1', reason: 'test' } });
  assert.equal(replies.length, 0); assert.match(c.state.approvals[0].details, /example.txt[\s\S]*\+hello/);
  await assert.rejects(c.respond('17', { decision: 'acceptForSession' }), /请选择/);
  assert.equal(replies.length, 0);
  await c.respond('17', { decision: 'decline' });
  assert.deepEqual(replies, [{ id: 17, result: { decision: 'decline' } }]);
  await assert.rejects(c.respond('17', { decision: 'accept' }), /已结束/);
});

test('permission grants use only the requested permissions and expire at turn scope', () => {
  const request = { method: 'item/permissions/requestApproval', params: { permissions: { network: { enabled: true } } } };
  assert.deepEqual(approvalResult(request, { allow: false }), { permissions: {}, scope: 'turn' });
  const result = approvalResult(request, { allow: true, permissions: { fileSystem: { write: ['C:/'] } } });
  assert.deepEqual(result, { permissions: { network: { enabled: true } }, scope: 'turn' });
  result.permissions.network.enabled = false; assert.equal(request.params.permissions.network.enabled, true);
});

test('questions preserve IDs and reject incomplete answers', () => {
  const request = { method: 'item/tool/requestUserInput', params: { questions: [{ id: 'a' }, { id: 'b' }] } };
  assert.throws(() => approvalResult(request, { answers: { a: 'yes' } }), /每个问题/);
  assert.deepEqual(approvalResult(request, { answers: { a: 'yes', b: 'no' } }), { answers: { a: { answers: ['yes'] }, b: { answers: ['no'] } } });
});

test('interrupt cancels approval and addresses the exact active turn', async t => {
  const c = await fixture(t); const calls = [];
  c.state.turnId = 'active'; c.state.status = 'working';
  c.rpc.reply = (id, result) => calls.push({ id, result });
  c.rpc.request = async (method, params) => { calls.push({ method, params }); };
  c.onRequest({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'owned', turnId: 'active' } });
  await c.interrupt();
  assert.deepEqual(calls, [{ id: 'approval', result: { decision: 'cancel' } }, { method: 'turn/interrupt', params: { threadId: 'owned', turnId: 'active' } }]);
  assert.equal(c.state.approvals.length, 0);
});

test('metadata contains no conversation text or credentials', async t => {
  const c = await fixture(t); c.state.messages.push({ text: 'private task' }); c.state.login = 'chatgpt';
  await c.persist(); const saved = JSON.parse(await readFile(c.metadataPath, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['cwd', 'format', 'model', 'threadId']);
  assert.equal(JSON.stringify(saved).includes('private task'), false);
});

test('Windows API-key casing cannot override cached ChatGPT login', () => {
  const original = { PATH: 'test', OpenAI_Api_Key: 'secret', codex_api_key: 'secret', OPENAI_ACCESS_TOKEN: 'secret', Electron_Run_As_Node: '1', CODEX_HOME: 'existing' };
  assert.deepEqual(cliEnvironment(original), { PATH: 'test', CODEX_HOME: 'existing' });
  assert.equal(original.OpenAI_Api_Key, 'secret');
});

test('RPC server requests wait for an explicit response; connection failure rejects waiting work', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
  const rpc = new AvatarRpc(child), sent = [], requests = [];
  child.stdin.on('data', bytes => sent.push(JSON.parse(bytes.toString()))); rpc.on('request', request => requests.push(request));
  child.stdout.write(JSON.stringify({ id: 91, method: 'item/commandExecution/requestApproval', params: {} }) + '\n');
  assert.equal(requests.length, 1); assert.equal(sent.length, 0);
  rpc.reply(requests[0].id, { decision: 'decline' }); assert.deepEqual(sent[0], { id: 91, result: { decision: 'decline' } });
  const pending = rpc.request('turn/start', {}); child.emit('exit', 1);
  await assert.rejects(pending, /已结束/); await assert.rejects(rpc.request('account/read'), /断开/);
});
