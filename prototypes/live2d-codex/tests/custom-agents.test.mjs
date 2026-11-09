import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
const { mkdtemp, mkdir, writeFile, rm, readFile } = fs;
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import catalog from '../backend/agent-catalog.cjs';
import { parseCustomAgents, loadCustomAgents, CustomAgentStore } from '../backend/custom-agents.mjs';
import { agentSetupPrompt } from '../backend/agent-setup-prompt.mjs';
import { explicitAgentBinary } from '../backend/agent-process.mjs';
import { WorkspaceStore, draftKey } from '../backend/workspace-store.mjs';
import { validateDataDirectory } from '../backend/data-directory.mjs';
import { populateAgentPicker } from '../renderer/agent-picker.mjs';
import vm from 'node:vm';

const entry = () => ({ id: 'custom-example', name: 'Example', protocol: 'acp', command: process.execPath, args: ['bridge with spaces.mjs', '--stdio'] });
const document = (...agents) => ({ format: 1, agents });
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'rin-custom-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('custom configuration validates the complete document without allowing builtin replacement or path traversal', () => {
  for (const patch of [
    { id: 'codex' }, { id: 'dots' }, { id: 'custom-../elsewhere' }, { id: 'custom-X' }, { id: 'custom-' },
    { id: '__proto__' }, { name: '' }, { name: 'broken\nlabel' }, { protocol: 'http' },
    { command: 'node' }, { command: 'C:\\Tools\\agent.cmd' }, { command: process.execPath + '\u0000' },
    { args: '--stdio' }, { args: [3] }, { args: ['line\nbreak'] }, { args: Array(65).fill('x') },
    { env: { KEY: 'must-not-be-stored' } }, { shell: true }, { authMethodId: '' },
  ]) assert.throws(() => parseCustomAgents(document({ ...entry(), ...patch })), JSON.stringify(patch));
  for (const value of [null, [], { format: 2, agents: [] }, { format: 1, agents: {}, extra: true }, document(...Array(33).fill(entry())), document(entry(), entry())]) assert.throws(() => parseCustomAgents(value));
  const parsed = parseCustomAgents(document(entry()))[0];
  assert.deepEqual(parsed.args, entry().args);
  assert.equal(explicitAgentBinary(parsed.command), process.execPath);
  assert.throws(() => explicitAgentBinary('missing.exe'));
});

test('configuration is opt-in, supports an explicit file, and never exposes malformed JSON text', async t => {
  const path = await directory(t);
  assert.deepEqual(await loadCustomAgents(path, { env: {} }), []);
  const file = join(path, 'custom-agents.json');
  await writeFile(file, '\uFEFF' + JSON.stringify(document(entry())));
  assert.equal((await loadCustomAgents(path, { env: {} }))[0].id, 'custom-example');
  assert.equal((await loadCustomAgents(join(path, 'unused'), { env: { VIBE_AGENT_CONFIG: file } }))[0].name, 'Example');
  await assert.rejects(loadCustomAgents(path, { env: { VIBE_AGENT_CONFIG: 'relative.json' } }), /绝对路径/);
  await assert.rejects(loadCustomAgents(path, { env: { VIBE_AGENT_CONFIG: join(path, 'missing.json') } }), /无法读取/);
  await writeFile(file, '{"secret":"not-for-the-renderer"');
  await assert.rejects(loadCustomAgents(path, { env: {} }), error => /有效 JSON/.test(error.message) && !error.message.includes('not-for-the-renderer'));
  await writeFile(file, ' '.repeat(65537));
  await assert.rejects(loadCustomAgents(path, { env: {} }), /64 KiB/);
});

test('registration and both picker modes carry only names and stable IDs, preserve selection and label custom entries', t => {
  t.after(() => catalog.setCustomAgents([]));
  const config = { ...entry(), authMethodId: 'private-auth-choice' };
  catalog.setCustomAgents([config]);
  assert.deepEqual(catalog.customAgentChoices(), [{ id: config.id, name: config.name }]);
  assert.equal(catalog.AGENTS[config.id].command, undefined);
  assert.equal(catalog.AGENTS[config.id].authMethodId, undefined);
  const select = { value: config.id, dataset: {}, ownerDocument: { createElement: () => ({}) }, replaceChildren(...children) { this.children = children; this.value = children[0].value; } };
  populateAgentPicker(select, { dots: true, customAgents: catalog.customAgentChoices() });
  assert.equal(select.value, config.id);
  assert.match(select.children.find(option => option.value === config.id).textContent, /自定义.*实验/);
  assert.ok(select.children.some(option => option.value === 'dots'));
  const children = select.children;
  populateAgentPicker(select, { dots: true }); assert.equal(select.children, children);
  populateAgentPicker(select, { dots: false }); assert.equal(select.children.some(option => option.value === 'dots'), false);
  assert.equal(select.value, config.id);
  catalog.setCustomAgents([]);
  assert.equal(catalog.isCliAgent(config.id), false);
  assert.equal(catalog.isStoredCliAgent(config.id), true);
});

test('removing registration keeps separate drafts, pending receipts and data-directory validation usable', async t => {
  const path = await directory(t), store = new WorkspaceStore(path);
  await store.load(); await store.add(path);
  const targets = ['codex', 'custom-one', 'custom-two'].map(provider => ({ provider, cwd: path, threadId: 'same-session' }));
  for (const target of targets) await store.saveDraft(target, target.provider + ' draft');
  await store.transaction(data => {
    data.submissions = { 'custom-one': { id: 'receipt', status: 'pending', text: 'pending text', target: targets[1], originalTarget: targets[1] } };
  });
  const reloaded = new WorkspaceStore(path); await reloaded.load();
  assert.equal(catalog.isCliAgent('custom-one'), false);
  for (const target of targets) assert.equal(reloaded.draft(target), target.provider + ' draft');
  assert.equal(reloaded.data.submissions['custom-one'].status, 'unknown');
  assert.equal(new Set(targets.map(draftKey)).size, 3);
  await reloaded.saveDraft(targets[0], 'new codex draft');
  assert.equal(reloaded.draft(targets[1]), 'custom-one draft');
  await validateDataDirectory(path);
  const cache = join(path, 'agents', 'custom-one'); await mkdir(cache, { recursive: true });
  await writeFile(join(cache, 'session.json'), JSON.stringify({ format: 1, provider: 'custom-two', cwd: path }));
  await assert.rejects(validateDataDirectory(path), /custom-one/);
  await writeFile(join(cache, 'session.json'), JSON.stringify({ format: 1, provider: 'custom-one', cwd: path }));
  await validateDataDirectory(path);
});

test('settings CRUD round-trips every argument, keeps backups and never deletes session data', async t => {
  const root = await directory(t), store = new CustomAgentStore(root, { env: {} });
  let view = await store.reload();
  assert.equal(view.error, ''); assert.deepEqual(view.entries, []);
  const original = { ...entry(), args: ['', 'path with spaces.mjs', 'quoted "value"', '--stdio'], authMethodId: 'stored-login' };
  view = await store.save(original, view.revision, { creating: true });
  const other = { ...entry(), id: 'custom-other' };
  view = await store.save(other, view.revision, { creating: true });
  const before = await readFile(store.file, 'utf8');
  view = await store.save({ ...original, name: 'New name' }, view.revision);
  assert.equal(view.entries.length, 2); assert.deepEqual(view.entries[0].args, original.args);
  assert.equal(await readFile(store.file + '.bak', 'utf8'), before);
  const cache = join(root, 'agents', original.id); await mkdir(cache, { recursive: true });
  await writeFile(join(cache, 'session.json'), 'private-history-sentinel');
  view = await store.remove(original.id, view.revision);
  assert.deepEqual(view.entries.map(item => item.id), ['custom-other']);
  assert.equal(await readFile(join(cache, 'session.json'), 'utf8'), 'private-history-sentinel');
  const reloaded = new CustomAgentStore(root, { env: {} });
  assert.deepEqual((await reloaded.reload()).entries, view.entries);
});

test('stale editors, duplicate creates and concurrent stores cannot overwrite a newer configuration', async t => {
  const root = await directory(t), first = new CustomAgentStore(root, { env: {} }), second = new CustomAgentStore(root, { env: {} });
  const empty = await first.reload(); await second.reload();
  const saved = await first.save(entry(), empty.revision, { creating: true });
  await assert.rejects(second.save({ ...entry(), id: 'custom-other' }, empty.revision, { creating: true }), /其他操作修改/);
  await assert.rejects(first.save({ ...entry(), name: 'stale' }, empty.revision), /其他操作修改/);
  await assert.rejects(first.save(entry(), saved.revision, { creating: true }), /已存在/);
  await assert.rejects(first.save({ ...entry(), id: 'custom-renamed' }, saved.revision), /已被删除/);
  assert.equal(JSON.parse(await readFile(first.file, 'utf8')).agents[0].name, 'Example');
  const results = await Promise.allSettled([first.save({ ...entry(), name: 'one' }, saved.revision), first.save({ ...entry(), name: 'two' }, saved.revision)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
});

test('simultaneous stores and cooperating external writers cannot both enter a configuration write', async t => {
  const root = await directory(t); let pause = false, entered, release;
  const staged = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(release);
  const first = new CustomAgentStore(root, { env: {}, io: { ...fs, open: async (file, ...args) => {
    const handle = await fs.open(file, ...args);
    if (!pause || !file.endsWith('.tmp')) return handle;
    return { writeFile: (...values) => handle.writeFile(...values), close: () => handle.close(), sync: async () => { await handle.sync(); entered(); await gate; } };
  } } });
  let view = await first.reload(); view = await first.save(entry(), view.revision, { creating: true });
  const second = new CustomAgentStore(root, { env: {} }); await second.reload();
  pause = true;
  const writing = first.save({ ...entry(), name: 'First writer' }, view.revision);
  await staged;
  await assert.rejects(second.save({ ...entry(), id: 'custom-second' }, view.revision, { creating: true }), /正在被其他操作写入/);
  assert.equal(JSON.parse(await readFile(first.file, 'utf8')).agents[0].name, 'Example');
  release(); await writing;
  view = await second.reload();
  view = await second.save({ ...entry(), id: 'custom-second' }, view.revision, { creating: true });
  assert.deepEqual(view.entries.map(item => item.name), ['First writer', 'Example']);
  const lock = first.file + '.lock'; await writeFile(lock, 'external-writer');
  await assert.rejects(second.remove(entry().id, view.revision), /正在被其他操作写入/);
  assert.equal(await readFile(lock, 'utf8'), 'external-writer', 'never delete a lock owned by another writer');
});

test('a failed final save leaves both live settings and committed bytes unchanged, then permits retry', async t => {
  const root = await directory(t); let fail = false;
  const store = new CustomAgentStore(root, { env: {}, io: { ...fs, rename: async (from, to) => {
    if (fail && to === store.file) throw new Error('locked fixture file');
    return fs.rename(from, to);
  } } });
  let view = await store.reload(); view = await store.save(entry(), view.revision, { creating: true });
  const before = await readFile(store.file, 'utf8'); fail = true;
  await assert.rejects(store.save({ ...entry(), name: 'unsaved' }, view.revision), /locked/);
  assert.deepEqual(store.snapshot(), view); assert.equal(await readFile(store.file, 'utf8'), before);
  assert.equal((await fs.readdir(root)).some(name => name.endsWith('.tmp')), false);
  await assert.rejects(fs.stat(store.file + '.lock'), { code: 'ENOENT' });
  fail = false; view = await store.save({ ...entry(), name: 'retry' }, view.revision);
  assert.equal(view.entries[0].name, 'retry');
});

test('external edits made while staging a save are detected before replacing the file', async t => {
  const root = await directory(t); let overwrite = false;
  const external = JSON.stringify(document({ ...entry(), name: 'External writer' }));
  const store = new CustomAgentStore(root, { env: {}, io: { ...fs, open: async (...args) => {
    const handle = await fs.open(...args);
    return { writeFile: (...values) => handle.writeFile(...values), close: () => handle.close(), sync: async () => {
      await handle.sync();
      if (overwrite) { overwrite = false; await writeFile(store.file, external); }
    } };
  } } });
  let view = await store.reload(); view = await store.save(entry(), view.revision, { creating: true });
  overwrite = true;
  await assert.rejects(store.save({ ...entry(), name: 'UI writer' }, view.revision), /其他操作修改/);
  assert.equal(await readFile(store.file, 'utf8'), external);
  assert.equal(store.snapshot().entries[0].name, 'Example');
  assert.equal((await store.reload()).entries[0].name, 'External writer');
});

test('BOM configuration remains editable and a corrupt reload preserves the last valid entries', async t => {
  const root = await directory(t), file = join(root, 'external.json');
  const bytes = '\uFEFF' + JSON.stringify(document(entry())); await writeFile(file, bytes);
  const store = new CustomAgentStore(join(root, 'unused'), { env: { VIBE_AGENT_CONFIG: file } });
  let view = await store.reload(); assert.equal(view.external, true);
  view = await store.save({ ...entry(), name: 'Updated' }, view.revision);
  assert.equal(await readFile(file + '.bak', 'utf8'), bytes);
  await writeFile(file, 'broken-private-content');
  const broken = await store.reload(); assert.match(broken.error, /有效 JSON/);
  assert.equal(broken.entries[0].name, 'Updated');
  await assert.rejects(store.remove(entry().id, broken.revision), /原文件已保留/);
  assert.equal(await readFile(file, 'utf8'), 'broken-private-content');
  await writeFile(file, JSON.stringify(document()));
  await assert.rejects(store.reload({ guard: () => { throw new Error('active registration removed'); } }), /active/);
  assert.equal(store.snapshot().entries[0].name, 'Updated');
  assert.deepEqual((await store.reload()).entries, []);
});

test('the copyable setup prompt carries the selected file and complete protocol, merge and verification boundaries', () => {
  const prompt = agentSetupPrompt({ file: 'C:\\Example Data\\custom-agents.json', name: 'Example Agent' });
  for (const expected of ['Example Agent', 'C:\\\\Example Data', 'ACP v1', 'stdio', 'authMethodId', '保留其他配置', '.lock', 'wx', 'finally', 'API Key', '重新读取', '不要为验证连接发送模型任务', '无法访问本机文件']) assert.ok(prompt.includes(expected), expected);
  assert.match(agentSetupPrompt({}), /不要猜测稳定版或测试版/);
  assert.match(agentSetupPrompt({ file: 'C:\\test.json' }), /先问我它的产品或客户端名称/);
});

test('actual main-process settings boundaries keep an active connection unchanged and forbid deleting it', async t => {
  const root = await directory(t), store = new CustomAgentStore(root, { env: {} });
  let view = await store.reload(); view = await store.save(entry(), view.revision, { creating: true });
  const launch = view.entries[0], handlers = new Map(), publications = [];
  const main = await readFile(new URL('../main.cjs', import.meta.url), 'utf8');
  const context = vm.createContext({
    customAgentStore: store, customAgentLaunches: new Map([[launch.id, launch]]), backend: { launch }, provider: launch.id,
    changingAgentConfig: false, changingProvider: false, changingData: false, closing: false, quitting: false,
    agentConfigError: '', isCustomAgentId: catalog.isCustomAgentId, setCustomAgents() {}, notifyWorkspace() { publications.push('updated'); },
    handler: (channel, callback) => handlers.set(channel, callback), agentSetupPrompt, clipboard: { writeText(text) { publications.push(text); } },
  });
  vm.runInContext(main.slice(main.indexOf('function agentSettingsSnapshot()'), main.indexOf('function notifyWorkspace()')), context);
  vm.runInContext(main.slice(main.indexOf("    handler('agents:list'"), main.indexOf("    handler('remote:command'")), context);
  const changed = await handlers.get('agents:save')({}, { ...launch, args: ['new-argument'] }, view.revision, false);
  assert.equal(changed.needsReconnect, true);
  assert.deepEqual(context.backend.launch.args, launch.args, 'saving never reconfigures a live transport');
  assert.deepEqual(context.customAgentLaunches.get(launch.id).args, ['new-argument']);
  await assert.rejects(handlers.get('agents:remove')({}, launch.id, changed.revision), /先切换/);
  assert.equal((await loadCustomAgents(root, { env: {} })).length, 1);
  context.changingProvider = true;
  await assert.rejects(handlers.get('agents:save')({}, launch, changed.revision, false), /切换或保存/);
  context.changingProvider = false;
  await writeFile(store.file, JSON.stringify(document()));
  await assert.rejects(handlers.get('agents:reload')(), /先切换/);
  assert.equal(context.customAgentLaunches.has(launch.id), true);
  const copied = handlers.get('agents:copy-prompt')({}, 'Example');
  assert.equal(publications.at(-1), copied); assert.ok(copied.includes(JSON.stringify(store.file)));
});

test('main-process IPC exposes full launch settings only to the workbench window', async () => {
  const main = await readFile(new URL('../main.cjs', import.meta.url), 'utf8'), handlers = new Map(), workbenchSender = {};
  const context = vm.createContext({
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, trusted: () => true,
    workbench: { webContents: workbenchSender }, closing: false, quitting: false, changingProvider: false, changingData: false, changingAgentConfig: false,
    submissions: { active: new Set() }, provider: 'codex',
  });
  vm.runInContext(main.slice(main.indexOf('    const handler = (channel'), main.indexOf("    handler('companion:snapshot'")) + '\nhandler("agents:list", () => "private launch configuration");', context);
  assert.equal((await handlers.get('agents:list')({ sender: {} })).ok, false);
  assert.equal((await handlers.get('agents:list')({ sender: workbenchSender })).value, 'private launch configuration');
});
