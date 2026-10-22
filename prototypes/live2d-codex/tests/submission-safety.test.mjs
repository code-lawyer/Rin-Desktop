import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../backend/workspace-store.mjs';
import { SubmissionGuard, submissionBaseline, matchesSubmission } from '../backend/submission-guard.mjs';
import { CodexCompanion } from '../backend/codex.mjs';
import { NativeAgent } from '../backend/native-agent.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
async function fixture(t, io) {
  const root = await fs.mkdtemp(join(tmpdir(), 'rin-submission-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new WorkspaceStore(root, { io }); await store.load(); const project = await store.add(root);
  const agent = new CodexCompanion({ projectRoot: root, storageDir: root });
  Object.assign(agent.state, { connection: 'ready', status: 'idle', threadId: 'thread' });
  agent.rpc = { closed: false }; const guard = new SubmissionGuard(store);
  return { root, project, store, agent, guard, target: { provider: 'codex', cwd: root, threadId: 'thread' } };
}

test('accepted request with lost receipt survives restart; reconciliation reads history and never resends', async t => {
  const { root, store, agent, guard, target } = await fixture(t); let sends = 0;
  const rows = [];
  agent.rpc.request = async method => {
    if (method === 'thread/read') return { thread: { cwd: root, turns: structuredClone(rows) } };
    assert.equal(method, 'turn/start'); sends++;
    rows.push({ id: 'accepted', items: [{ id: 'remote-user', type: 'userMessage', content: [{ type: 'text', text: 'do once' }] }] });
    throw Object.assign(new Error('receipt lost'), { code: 'TIMEOUT' });
  };
  await assert.rejects(guard.send(agent, 'codex', 'do once'), /receipt lost/);
  assert.equal(guard.snapshot('codex').status, 'unknown'); assert.equal(store.draft(target), 'do once');
  await assert.rejects(guard.send(agent, 'codex', 'do once'), /核查/); assert.equal(sends, 1);
  const restored = new WorkspaceStore(root); await restored.load(); const afterRestart = new SubmissionGuard(restored);
  agent.state.status = 'idle';
  const result = await afterRestart.reconcile(agent, 'codex', afterRestart.snapshot('codex').id);
  assert.equal(result.status, 'confirmed'); assert.equal(sends, 1); assert.equal(restored.draft(target), '');
});

test('lack of history is unknown, requires explicit review, and release never dispatches a request', async t => {
  const { store, agent, guard, target, root } = await fixture(t); let sends = 0;
  agent.rpc.request = async method => { if (method === 'thread/read') return { thread: { cwd: root, turns: [] } }; sends++; throw new Error('disconnected'); };
  await assert.rejects(guard.send(agent, 'codex', 'keep this'));
  const id = guard.snapshot('codex').id; agent.state.status = 'idle';
  await assert.rejects(guard.release(agent, 'codex', id), /先核查/);
  await guard.reconcile(agent, 'codex', id); assert.equal(guard.snapshot('codex').status, 'unknown');
  await guard.release(agent, 'codex', id); assert.equal(sends, 1); assert.equal(store.draft(target), 'keep this');
});

test('an accepted notification before a lost RPC reply cannot regress a confirmed receipt', async t => {
  const { root, store, agent, guard, target } = await fixture(t);
  agent.rpc.request = async method => {
    if (method === 'thread/read') return { thread: { cwd: root, turns: [] } };
    agent.onNotification({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'accepted' } } });
    throw new Error('reply lost');
  };
  assert.equal((await guard.send(agent, 'codex', 'request')).accepted, true);
  assert.match(agent.state.error, /请求已送达/);
  assert.equal(guard.snapshot('codex').status, 'confirmed'); assert.equal(store.draft(target), '');
});

test('new thread identity reaches disk before its prompt, and restart retains the original draft', async t => {
  const { root, store, agent, guard } = await fixture(t); agent.state.threadId = null;
  agent.rpc.request = async method => {
    if (method === 'thread/start') return { thread: { id: 'created' } };
    if (method === 'thread/read') return { thread: { cwd: root, turns: [] } };
    assert.equal(JSON.parse(await fs.readFile(store.file, 'utf8')).submissions.codex.target.threadId, 'created');
    throw new Error('dropped');
  };
  await assert.rejects(guard.send(agent, 'codex', 'new request'));
  const reload = new WorkspaceStore(root); await reload.load();
  assert.equal(reload.data.submissions.codex.status, 'unknown'); assert.equal(reload.draft({ cwd: root }), 'new request');
  agent.state.status = 'idle'; await guard.reconcile(agent, 'codex', guard.snapshot('codex').id); await guard.release(agent, 'codex', guard.snapshot('codex').id);
  assert.equal(store.draft({ cwd: root, threadId: 'created' }), 'new request');
});

test('failure to persist before dispatch prevents any Agent submission', async t => {
  let fail = false;
  const { root, agent, guard, store } = await fixture(t, { ...fs, rename: async (a, b) => { if (fail && b.endsWith('workspaces.json')) throw new Error('disk full'); return fs.rename(a,b); } });
  agent.rpc.request = () => assert.fail('must not dispatch'); fail = true;
  await assert.rejects(guard.send(agent, 'codex', 'retained in input'), /disk full/);
  assert.equal(store.data.submissions, undefined); const reload = new WorkspaceStore(root); await reload.load(); assert.equal(reload.data.projects.length, 1);
});

test('pending receipt is recovered as unknown and a failed confirmation retains the original', async t => {
  let fail = false;
  const { root, store, agent, guard, target } = await fixture(t, { ...fs, rename: async (a,b) => { if (fail && b.endsWith('workspaces.json')) throw new Error('locked'); return fs.rename(a,b); } });
  agent.rpc.request = async method => {
    if (method === 'thread/read') return { thread: { cwd: root, turns: [] } };
    fail = true; return { turn: { id: 'accepted' } };
  };
  await assert.rejects(guard.send(agent, 'codex', 'saved first'));
  assert.equal(store.draft(target), 'saved first');
  const reload = new WorkspaceStore(root); await reload.load(); assert.equal(reload.data.submissions.codex.status, 'unknown');
  assert.equal(reload.draft(target), 'saved first');
});

for (const provider of ['claude', 'grok', 'opencode']) test(`${provider}: local queue acceptance keeps the draft until remote evidence, including later edits`, async t => {
  const { root, store, guard } = await fixture(t), gate = deferred(), started = deferred();
  const agent = new NativeAgent({ provider, projectRoot: root, storageDir: root });
  Object.assign(agent.state, { connection: 'ready', status: 'idle', threadId: 'native' });
  agent.readSubmissionHistory = async () => [];
  agent.promptNative = async () => { started.resolve(); await gate.promise; agent.appendText('remote reply'); return {}; };
  const target = { provider, cwd: root, threadId: 'native' };
  const result = await guard.send(agent, provider, 'sent text'); await started.promise;
  assert.equal(result.pending, true); assert.equal(store.draft(target), 'sent text');
  await store.saveDraft(target, 'next draft'); gate.resolve(); await agent.run; await store.queue;
  assert.equal(guard.snapshot(provider).status, 'confirmed'); assert.equal(store.draft(target), 'next draft');
});

test('ambiguous, repeated, edited or truncated history cannot be mistaken for a receipt', () => {
  const previous = [{ id:'old', text:'repeat' }];
  const record = { text: 'repeat', baseline: submissionBaseline(previous) };
  assert.equal(matchesSubmission(record, previous), false);
  assert.equal(matchesSubmission(record, [...previous, { id:'new', text:'repeat' }]), true);
  assert.equal(matchesSubmission(record, [...previous, { text:'repeat' }, { text:'repeat' }]), false);
  assert.equal(matchesSubmission(record, [{ id:'changed', text:'repeat' }, { text:'repeat' }]), false);
  assert.equal(matchesSubmission(record, [{ text:'edited' }, { text:'repeat' }]), false);
  assert.equal(matchesSubmission({ ...record, baseline: null }, [{ text:'repeat' }]), false);
});

test('the originating target is checked before saving or dispatching a stale renderer request', async t => {
  const { agent, guard, target } = await fixture(t);
  agent.rpc.request = () => assert.fail('must not dispatch');
  await assert.rejects(guard.send(agent, 'codex', 'old target', { ...target, threadId: 'different' }), /已切换/);
});

for (const status of ['pending', 'unknown']) for (const field of ['target', 'originalTarget']) {
  test(`${status} receipt from another provider keeps its ${field} project reachable`, async t => {
    const { root, project, store } = await fixture(t);
    const active = join(root, 'active-project'); await fs.mkdir(active); await store.add(active);
    const draft = { provider: 'grok', cwd: project.cwd, threadId: 'old-thread' };
    await store.saveDraft(draft, 'preserve this original');
    await store.transaction(data => {
      const other = { provider: 'grok', cwd: active, threadId: 'new-thread' };
      data.submissions = {
        codex: { id: 'completed', status: 'confirmed', text: 'done', target: { provider: 'codex', cwd: active, threadId: 'done' } },
        grok: { id: 'unresolved', status, text: 'preserve this original', target: other, originalTarget: other, [field]: draft }
      };
    });
    const before = await fs.readFile(store.file);
    await assert.rejects(store.remove(project.id, active), /发送结果未确定.*核查/);
    assert.equal(store.project(project.id).cwd, project.cwd);
    assert.equal(store.draft(draft), 'preserve this original');
    assert.deepEqual(await fs.readFile(store.file), before);
  });
}

test('a submission queued before removal is protected by the same storage transaction order', async t => {
  const { root, project, store, target } = await fixture(t);
  const active = join(root, 'active-project'); await fs.mkdir(active); await store.add(active);
  const pending = store.transaction(data => {
    data.submissions = { codex: { id: 'queued', status: 'unknown', text: 'original', target, originalTarget: target } };
    store.setDraft(data, target, 'original');
  });
  const removing = store.remove(project.id, active);
  await assert.rejects(removing, /发送结果未确定/); await pending;
  assert.equal(store.project(project.id).cwd, project.cwd);
  assert.equal(store.draft(target), 'original');
});

for (const status of ['confirmed', 'released', 'not-sent']) {
  test(`${status} receipt permits removal without deleting its draft or journal`, async t => {
    const { root, project, store, target } = await fixture(t);
    const active = join(root, 'active-project'); await fs.mkdir(active); await store.add(active);
    await store.saveDraft(target, 'retained draft');
    const record = { id: 'handled', status, text: 'retained draft', target, originalTarget: target };
    await store.transaction(data => { data.submissions = { codex: record }; });
    await store.remove(project.id, active);
    assert.throws(() => store.project(project.id), /项目不在/);
    assert.equal(store.draft(target), 'retained draft');
    assert.deepEqual(store.data.submissions.codex, record);
  });
}
