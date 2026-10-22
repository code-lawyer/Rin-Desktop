import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore, draftKey } from '../backend/workspace-store.mjs';
import { writeJson, readJson } from '../backend/durable-json.mjs';
import { validateDataDirectory, selectDataDirectory } from '../backend/data-directory.mjs';
import { createDraftSession } from '../renderer/draft-session.mjs';
import { recoverDataCopy } from '../backend/data-recovery.mjs';
import storage from '../backend/storage-location.cjs';

async function fixture(t, io) {
  const root = await fs.mkdtemp(join(tmpdir(), 'rin-data-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new WorkspaceStore(join(root, 'data'), { io });
  await store.load(); await store.add(root);
  return { root, store, target: { provider: 'codex', cwd: root, threadId: 'saved' } };
}

for (const failure of ['open', 'sync', 'rename']) test(`failed ${failure} keeps committed data and memory, then permits retry`, async t => {
  let fail = false;
  const io = { ...fs,
    async open(file, mode) {
      if (fail && failure === 'open' && file.endsWith('workspaces.json.tmp')) throw new Error('disk full');
      const handle = await fs.open(file, mode);
      return { writeFile: (...args) => handle.writeFile(...args), close: () => handle.close(), sync: () => fail && failure === 'sync' && file.endsWith('workspaces.json.tmp') ? Promise.reject(new Error('flush failed')) : handle.sync() };
    },
    async rename(from, to) { if (fail && failure === 'rename' && to.endsWith('workspaces.json')) throw new Error('file locked'); return fs.rename(from, to); },
  };
  const { store, target } = await fixture(t, io);
  await store.saveDraft(target, 'original'); const before = await fs.readFile(store.file, 'utf8');
  fail = true; await assert.rejects(store.saveDraft(target, 'new input'));
  assert.equal(store.draft(target), 'original'); assert.equal(await fs.readFile(store.file, 'utf8'), before);
  const reloaded = new WorkspaceStore(join(store.file, '..')); await reloaded.load(); assert.equal(reloaded.draft(target), 'original');
  fail = false; await store.saveDraft(target, 'retry'); assert.equal(store.draft(target), 'retry');
  assert.equal(JSON.parse(await fs.readFile(store.file + '.bak', 'utf8')).drafts[draftKey(target)].text, 'original');
});

test('a failed settings mutation cannot leak into a later successful draft transaction', async t => {
  let fail = false;
  const { store, target } = await fixture(t, { ...fs, rename: async (a, b) => { if (fail && b.endsWith('workspaces.json')) throw new Error('locked'); return fs.rename(a, b); } });
  const old = structuredClone(store.data.settings); fail = true;
  await assert.rejects(store.updateSettings({ autoSpeak: true })); fail = false;
  await store.saveDraft(target, 'preserved'); assert.deepEqual(store.data.settings, old);
});

test('concurrent dictation and draft mutations retain each accepted recording exactly once', async t => {
  const { store, target } = await fixture(t);
  await store.saveDraft(target, 'typed');
  await Promise.all([store.appendDictation(target, 'one', '1'), store.appendDictation(target, 'two', '2'), store.appendDictation(target, 'one', '1')]);
  assert.equal(store.draft(target), 'typed one two');
});

test('legacy projects, paths, voices, Codex IDs and all provider drafts survive adoption without copying or editing the source', async t => {
  const { root, store, target } = await fixture(t);
  for (const provider of ['codex','claude','grok','opencode']) await store.saveDraft({ ...target, provider }, provider + ' text');
  await store.remember({ ...target });
  const before = await fs.readFile(store.file);
  const pointer = join(root, 'new-default', 'data-location.json');
  const selected = await selectDataDirectory(join(store.file, '..'), pointer);
  assert.equal(selected, await fs.realpath(join(store.file, '..')));
  assert.deepEqual(await fs.readFile(store.file), before);
  const reopened = new WorkspaceStore(selected); await reopened.load();
  for (const provider of ['codex','claude','grok','opencode']) assert.equal(reopened.draft({ ...target, provider }), provider + ' text');
  assert.equal(reopened.data.projects[0].lastThreadId, 'saved');
});

test('invalid provider metadata or interrupted pointer writes cannot replace an existing data selection', async t => {
  const { root, store } = await fixture(t), pointer = join(root, 'pointer.json');
  await writeJson(pointer, { format: 1, directory: root }); const before = await fs.readFile(pointer);
  const dir = join(store.file, '..'); await fs.mkdir(join(dir, 'agents', 'grok'), { recursive: true });
  await fs.writeFile(join(dir, 'agents/grok/session.json'), JSON.stringify({ format: 1, provider: 'claude', cwd: root }));
  await assert.rejects(selectDataDirectory(dir, pointer), /会话记录/); assert.deepEqual(await fs.readFile(pointer), before);
  await fs.writeFile(join(dir, 'agents/grok/session.json'), JSON.stringify({ format: 1, provider: 'grok', cwd: root }));
  await assert.rejects(selectDataDirectory(dir, pointer, { io: { ...fs, rename: async (a, b) => { if (b === pointer) throw new Error('locked'); return fs.rename(a, b); } } }));
  assert.deepEqual(await fs.readFile(pointer), before);
});

test('missing projects retain drafts and are not silently replaced by a new directory', async t => {
  const { root, store } = await fixture(t), project = join(root, 'temporary-project'); await fs.mkdir(project);
  await store.add(project); const target = { cwd: project, threadId: 'old' }; await store.saveDraft(target, 'keep');
  await fs.rmdir(project);
  const reload = new WorkspaceStore(join(store.file, '..')); await reload.load();
  assert.equal(reload.draft(target), 'keep'); assert.equal(reload.data.projects.length, 2);
  await assert.rejects(reload.add(project)); assert.equal(reload.draft(target), 'keep');
});

test('case variants and a directory junction share one project and retain conflicting legacy drafts', async t => {
  const { root, store, target } = await fixture(t), alias = join(root, 'alias'), project = join(root, 'project');
  await fs.mkdir(project); await fs.symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const first = await store.add(project), second = await store.add(alias); assert.equal(first.id, second.id);
  const a = { ...target, cwd: project }, b = { ...target, cwd: alias };
  await store.saveDraft(a, 'canonical'); assert.equal(store.draft(b), 'canonical');
  const legacy = JSON.parse(await fs.readFile(store.file, 'utf8'));
  legacy.drafts[alias.toLowerCase() + '|saved'] = { text: 'alias input' };
  await fs.writeFile(store.file, JSON.stringify(legacy));
  const reload = new WorkspaceStore(join(store.file, '..')); await reload.load();
  assert.equal(reload.draft(a), 'canonical\n\nalias input'); assert.equal(reload.draft(b), reload.draft(a));
  if (process.platform === 'win32') assert.equal(reload.draft({ ...a, cwd: project.toUpperCase() }), reload.draft(a));
  await reload.saveDraft(b, 'merged explicitly'); assert.equal(reload.draft(a), 'merged explicitly');
});

test('a missing project below an existing junction keeps its canonical draft identity', async t => {
  const { root, store } = await fixture(t);
  const parent = join(root, 'canonical-parent'), alias = join(root, 'junction-parent');
  const directory = join(parent, 'temporary', 'project');
  await fs.mkdir(directory, { recursive: true });
  await fs.symlink(parent, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const selected = join(alias, 'temporary', 'project'), project = await store.add(selected);
  const target = { cwd: selected, threadId: 'retained' }, canonical = { ...target, cwd: project.cwd };
  const originalKey = draftKey(target);
  await store.saveDraft(target, 'keep through the missing suffix');
  await fs.rmdir(directory); await fs.rmdir(join(parent, 'temporary'));
  assert.equal(await fs.realpath(alias), await fs.realpath(parent), 'the alias parent still exists');
  assert.equal(draftKey(target), originalKey);
  assert.equal(store.draft(target), 'keep through the missing suffix');
  const reload = new WorkspaceStore(join(store.file, '..')); await reload.load();
  assert.equal(reload.draft(target), 'keep through the missing suffix');
  assert.equal(reload.draft(canonical), 'keep through the missing suffix');
  assert.equal(reload.project(project.id).cwd, project.cwd);
  assert.equal(reload.data.projects.length, 2);
  await assert.rejects(reload.add(selected));
  await reload.saveDraft(target, 'edited while the project is missing');
  assert.equal(reload.draft(canonical), 'edited while the project is missing');
  assert.equal(Object.keys(reload.data.drafts).length, 1, 'aliases do not fork the saved draft');
});

test('corrupt or missing primary with recovery artifacts fails closed and leaves every byte intact', async t => {
  const { root, store, target } = await fixture(t); await store.saveDraft(target, 'original'); await store.saveDraft(target, 'latest');
  const backup = await fs.readFile(store.file + '.bak');
  await fs.writeFile(store.file, '{broken');
  await assert.rejects(new WorkspaceStore(join(store.file, '..')).load(), /原文件已保留/);
  await assert.rejects(validateDataDirectory(join(store.file, '..')));
  assert.deepEqual(await fs.readFile(store.file + '.bak'), backup); assert.equal(await fs.readFile(store.file, 'utf8'), '{broken');
  const absent = join(root, 'missing.json'); await fs.writeFile(absent + '.tmp', '{}');
  await assert.rejects(readJson(absent), /恢复副本/);
  assert.equal(await fs.readFile(absent + '.tmp', 'utf8'), '{}');
});

test('failed draft promotion leaves its original slot, and confirmation never clears a later edit', async () => {
  let text = '', failed = false; const saved = new Map([['new','original']]);
  const drafts = createDraftSession({ getText: () => text, setText: value => text = value, error: () => { failed = true; }, request: async (target, value) => {
    if (value === undefined) return { ok: true, value: saved.get(target.threadId ?? 'new') ?? '' };
    if (target.threadId === 'assigned' && value) return { ok: false, error: 'disk full' };
    saved.set(target.threadId ?? 'new', value); return { ok: true };
  } });
  const originalTarget = { cwd: 'project', threadId: null }, target = { ...originalTarget, threadId: 'assigned' };
  drafts.restore(originalTarget); await Promise.resolve();
  await drafts.restore(target, { creatingThread: true }); assert.equal(failed, true); assert.equal(saved.get('new'), 'original');
  text = 'new edit'; drafts.edited(); await drafts.consume({ text: 'original', originalTarget, target }); assert.equal(text, 'new edit');
});

test('recovery previews first, copies a valid backup into a new directory and never overwrites source or destination', async t => {
  const { root, store, target } = await fixture(t);
  await store.saveDraft(target, 'recover me'); await store.saveDraft(target, 'latest');
  await fs.writeFile(store.file, 'damaged'); const output = join(root, 'recovered');
  const plan = await recoverDataCopy(join(store.file, '..'), output); assert.equal(plan.applied, false); await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  await recoverDataCopy(join(store.file, '..'), output, { run: true });
  const recovered = new WorkspaceStore(output); await recovered.load(); assert.equal(recovered.draft(target), 'recover me');
  assert.equal(await fs.readFile(store.file, 'utf8'), 'damaged');
  await assert.rejects(recoverDataCopy(join(store.file, '..'), output, { run: true }), /已存在/);
  await assert.rejects(recoverDataCopy(join(store.file, '..'), join(store.file, '../nested'), { run: true }), /之外/);
});

test('test build storage is isolated and broken adopted-directory pointers cannot silently open empty data', async t => {
  const { root } = await fixture(t);
  const normal = storage.dataHome(root), testing = storage.dataHome(root, { testBuild: { id: 'data-agent-01' } });
  assert.notEqual(testing, normal); assert.ok(testing.endsWith(join('test-builds', 'data-agent-01')));
  assert.throws(() => storage.dataHome(root, { testBuild: { id: '../escape' } }), /无效/);
  await fs.mkdir(testing, { recursive: true }); await fs.writeFile(join(testing, 'data-location.json'), JSON.stringify({ format: 1, directory: join(root, 'missing') }));
  assert.throws(() => storage.storageLocation({ defaultStorage: testing, packaged: true }), /未切换到空白/);
  assert.equal(storage.storageLocation({ defaultStorage: normal, packaged: true }), normal);
  assert.equal(storage.storageLocation({ defaultStorage: testing, packaged: true, override: root }), root);
});
