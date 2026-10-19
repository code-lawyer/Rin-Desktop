import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftSession } from '../renderer/draft-session.mjs';

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
