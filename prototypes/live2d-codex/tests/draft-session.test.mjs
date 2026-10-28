import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftSession } from '../renderer/draft-session.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

test('a failed save survives navigation and can be retried without mixing providers', async () => {
  let text = '', fail = true; const errors = [], saved = new Map([['codex|a', 'old draft']]);
  const key = t => `${t.provider}|${t.threadId}`;
  const drafts = createDraftSession({ getText: () => text, setText: value => text = value, error: e => errors.push(e),
    request: async (t, value) => {
      if (value !== undefined) { if (fail) return { ok: false, error: 'write failed' }; saved.set(key(t), value); }
      return { ok: true, value: saved.get(key(t)) || '' };
    } });
  const a = { provider: 'codex', cwd: 'project', threadId: 'a' }, b = { ...a, provider: 'claude' };
  drafts.restore(a); await tick(); text = 'old draft plus new input'; drafts.edited();
  drafts.restore(b); await tick(); assert.equal(text, '');
  text = 'separate provider'; drafts.edited(); drafts.restore(a); await tick();
  assert.equal(text, 'old draft plus new input'); assert.ok(errors.length);
  fail = false; await drafts.save(); assert.equal(saved.get(key(a)), text);
  drafts.restore(b); await tick(); assert.equal(text, 'separate provider'); await drafts.save();
  drafts.restore(a); await tick(); assert.equal(text, 'old draft plus new input');
});

test('returning while a save is pending retains the newer edit after an old success arrives', async () => {
  let text = ''; const saves = [], errors = [];
  const drafts = createDraftSession({ getText: () => text, setText: value => text = value, error: e => errors.push(e),
    request: (_t, value) => {
      if (value === undefined) return Promise.resolve({ ok: true, value: 'disk draft' });
      const wait = deferred(); saves.push(wait); return wait.promise;
    } });
  const a = { cwd: 'project', threadId: 'a' }, b = { ...a, threadId: 'b' };
  drafts.restore(a); await tick(); text = 'first edit'; drafts.edited(); const first = drafts.save();
  drafts.restore(b); await tick(); drafts.restore(a); await tick(); assert.equal(text, 'first edit');
  text = 'newest edit'; drafts.edited(); const second = drafts.save();
  saves[1].resolve({ ok: false, error: 'disk full' }); await second;
  saves[0].resolve({ ok: true }); await first;
  drafts.restore(b); await tick(); drafts.restore(a); await tick(); assert.equal(text, 'newest edit');
  for (const save of saves.slice(2)) save.resolve({ ok: false, error: 'disk full' });
  await tick(); assert.equal(text, 'newest edit');
});

test('failed promotion keeps the assigned thread draft, and late cleanup cannot delete a replacement new draft', async () => {
  for (const success of [false, true]) {
    let text = ''; const saved = new Map(), gate = deferred(); let first = true;
    const drafts = createDraftSession({ getText: () => text, setText: value => text = value, error() {},
      request: async (t, value) => {
        const id = t.threadId ?? 'new';
        if (value !== undefined) {
          if (id === 'assigned' && first) { first = false; await gate.promise; if (!success) return { ok: false, error: 'disk full' }; }
          saved.set(id, value);
        }
        return { ok: true, value: saved.get(id) ?? '' };
      } });
    const initial = { cwd: 'project', threadId: null }, assigned = { ...initial, threadId: 'assigned' };
    drafts.restore(initial); await tick(); text = 'follow-up'; drafts.edited(); await drafts.save();
    const promotion = drafts.restore(assigned, { creatingThread: true });
    drafts.restore(initial); await tick(); text = 'new unrelated task'; drafts.edited(); await drafts.save();
    gate.resolve(); await promotion;
    assert.equal(saved.get('new'), 'new unrelated task');
    drafts.restore(assigned); await tick(); assert.equal(text, 'follow-up');
  }
});

test('first send promotes the follow-up draft into its assigned thread without leaking into a new conversation', async () => {
  const saved = new Map(); let text = '';
  const key = t => `${t.cwd}|${t.threadId ?? 'new'}`;
  const drafts = createDraftSession({ getText: () => text, setText: value => { text = value; }, error: assert.fail,
    request: async (target, value) => { if (value !== undefined) saved.set(key(target), value); return { ok: true, value: saved.get(key(target)) || '' }; } });
  drafts.restore({ cwd: 'project', threadId: null }); await Promise.resolve();
  text = '首条任务'; await drafts.save(); text = ''; await drafts.save();
  text = '等待 thread/start 时键入的追问'; drafts.edited();
  drafts.restore({ cwd: 'project', threadId: 'first' }, { creatingThread: true }); await Promise.resolve();
  assert.equal(text, '等待 thread/start 时键入的追问');
  assert.equal(saved.get('project|first'), text); assert.equal(saved.get('project|new'), '');
  drafts.restore({ cwd: 'project', threadId: null }); await Promise.resolve();
  assert.equal(text, '', 'An unrelated new conversation must not inherit this follow-up');
  drafts.restore({ cwd: 'project', threadId: 'first' }); await Promise.resolve();
  assert.equal(text, '等待 thread/start 时键入的追问');
});

test('delayed draft reads cannot overwrite edits or the draft of a different conversation', async () => {
  const reads = []; let text = '';
  const drafts = createDraftSession({ getText: () => text, setText: value => { text = value; }, error: assert.fail,
    request: (_target, value) => value === undefined ? new Promise(resolve => reads.push(resolve)) : Promise.resolve({ ok: true }) });
  drafts.restore({ cwd: 'project', threadId: 'a' });
  text = 'typed'; drafts.edited(); text = ''; drafts.edited();
  reads[0]({ ok: true, value: 'stale old draft' }); await Promise.resolve(); assert.equal(text, '');
  drafts.restore({ cwd: 'project', threadId: 'b' });
  drafts.restore({ cwd: 'project', threadId: 'c' });
  reads[2]({ ok: true, value: 'current draft' }); reads[1]({ ok: true, value: 'wrong target' });
  await Promise.resolve(); assert.equal(text, 'current draft');
});

test('leaving a draft before its read completes never saves the empty loading placeholder', async () => {
  const saved = new Map([['a', 'Draft A'], ['b', 'Draft B'], ['c', 'Draft C']]);
  let text = '', finishB;
  const drafts = createDraftSession({ getText: () => text, setText: value => { text = value; }, error: assert.fail,
    request: (target, value) => {
      if (value !== undefined) { saved.set(target.threadId, value); return Promise.resolve({ ok: true }); }
      const result = { ok: true, value: saved.get(target.threadId) };
      return target.threadId === 'b' ? new Promise(resolve => { finishB = () => resolve(result); }) : Promise.resolve(result);
    } });
  drafts.restore({ cwd: 'project', threadId: 'a' }); await Promise.resolve();
  drafts.restore({ cwd: 'project', threadId: 'b' });
  await drafts.save(); // Includes an autosave/unload during loading.
  drafts.restore({ cwd: 'project', threadId: 'c' });
  finishB(); await Promise.resolve();
  assert.equal(text, 'Draft C'); assert.equal(saved.get('b'), 'Draft B');
});

test('providers have separate draft identities even with identical project and thread values', async () => {
  let text = ''; const saved = new Map();
  const key = target => `${target.provider}|${target.threadId}`;
  const drafts = createDraftSession({ getText: () => text, setText: value => { text = value; }, error: assert.fail,
    request: async (target, value) => { if (value !== undefined) saved.set(key(target), value); return { ok: true, value: saved.get(key(target)) || '' }; } });
  const codex = { provider: 'codex', cwd: 'project', threadId: 'same' }, dots = { ...codex, provider: 'dots' };
  drafts.restore(codex); await Promise.resolve(); text = 'Codex draft'; drafts.edited(); await drafts.save();
  drafts.restore(dots); await Promise.resolve(); assert.equal(text, '');
  text = 'Dots draft'; drafts.edited(); await drafts.save();
  drafts.restore(codex); await Promise.resolve(); assert.equal(text, 'Codex draft');
  drafts.restore(dots); await Promise.resolve(); assert.equal(text, 'Dots draft');
});
