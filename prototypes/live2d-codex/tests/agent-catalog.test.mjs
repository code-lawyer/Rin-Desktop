import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import catalog from '../backend/agent-catalog.cjs';
import { acpAgentEnvironment, agentCommand, findAgent, versionOf } from '../backend/agent-process.mjs';
import { AcpCompanion } from '../backend/acp-agent.mjs';
import { WorkspaceStore, draftKey } from '../backend/workspace-store.mjs';
import { validateDataDirectory } from '../backend/data-directory.mjs';

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'rin-agents-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('only the fixed agents resolve to a CLI adapter', async t => {
  const path = await directory(t);
  assert.deepEqual(Object.entries(catalog.AGENTS).map(([id, spec]) => [id, spec.adapter]), [
    ['codex', 'codex'], ['antigravity', 'acp'], ['grok', 'acp'], ['claude', 'claude'], ['deepseek', 'acp'],
  ]);
  assert.ok(Object.isFrozen(catalog.AGENTS.antigravity.acpArgs));
  for (const id of ['opencode', 'custom-example', '__proto__', 'dots', ['grok'], { toString: () => 'grok' }]) {
    assert.equal(catalog.isCliAgent(id), false);
    assert.throws(() => findAgent(id), /未知 Agent/);
    assert.throws(() => new AcpCompanion({ provider: id, projectRoot: path, storageDir: path }), /未知 Agent/);
  }
  assert.throws(() => new AcpCompanion({ provider: 'codex', projectRoot: path, storageDir: path }), /不使用 ACP/);
});

test('removed providers remain parseable in saved drafts and receipts', async t => {
  const path = await directory(t), store = new WorkspaceStore(path);
  const targets = ['codex', 'custom-one', 'opencode'].map(provider => ({ provider, cwd: path, threadId: 'same-session' }));
  await store.load(); await store.add(path);
  for (const target of targets) await store.saveDraft(target, target.provider + ' draft');
  await store.transaction(data => {
    data.submissions = { 'custom-one': { id: 'receipt', status: 'pending', text: 'pending text', target: targets[1], originalTarget: targets[1] } };
  });
  const cache = join(path, 'agents', 'custom-one');
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, 'session.json'), 'legacy cache bytes');
  const legacyConfig = join(path, 'custom-agents.json');
  await writeFile(legacyConfig, 'legacy config bytes');

  const reloaded = new WorkspaceStore(path);
  await reloaded.load();
  assert.equal(catalog.isCliAgent('custom-one'), false);
  assert.equal(catalog.isStoredCliAgent('custom-one'), true);
  for (const target of targets) assert.equal(reloaded.draft(target), target.provider + ' draft');
  assert.equal(reloaded.data.submissions['custom-one'].status, 'unknown');
  assert.equal(new Set(targets.map(draftKey)).size, 3);
  await reloaded.saveDraft(targets[0], 'new codex draft');
  assert.equal(reloaded.draft(targets[1]), 'custom-one draft');
  await validateDataDirectory(path);
  assert.equal(await readFile(legacyConfig, 'utf8'), 'legacy config bytes');
  assert.equal(await readFile(join(cache, 'session.json'), 'utf8'), 'legacy cache bytes');
});

test('Windows finds the installed Antigravity binary without a shell shim', { skip: process.platform !== 'win32' }, async t => {
  const local = await directory(t), bin = join(local, 'agy', 'bin');
  const binary = join(bin, 'agy.exe');
  await mkdir(bin, { recursive: true });
  await writeFile(binary, 'fixture');
  assert.equal(findAgent('antigravity', { LOCALAPPDATA: local }), binary);
  await writeFile(join(bin, 'agy.cmd'), 'fixture');
  assert.throws(() => findAgent('antigravity', { VIBE_ANTIGRAVITY_BINARY: join(bin, 'agy.cmd') }), /原生可执行文件/);
});

test('Antigravity drops inherited private host state and preserves a regular user configuration', () => {
  const native = { Path: 'path', USERPROFILE: 'user', Gemini_Home: 'alternate home', GOOGLE_CLOUD_PROJECT: 'project' };
  const nested = {
    ...native, Antigravity_App_Data_Dir: 'host data', ANTIGRAVITY_LS_ADDRESS: 'host',
    ANTIGRAVITY_CSRF_TOKEN: 'host token fixture', AGY_ACP_FORCE_FILE_STORAGE: '1', Electron_Run_As_Node: '1',
  };
  const { Gemini_Home, ...expected } = native;
  assert.deepEqual(acpAgentEnvironment('antigravity', nested), expected);
  assert.deepEqual(acpAgentEnvironment('antigravity', native), native);
  assert.equal(nested.Gemini_Home, Gemini_Home);
  assert.deepEqual(acpAgentEnvironment('grok', { Path: 'path', grok_login_env: '1' }), { Path: 'path', GROK_LOGIN_ENV: '0' });
});

test('Windows runs the known DeepSeek npm entry without interpreting dsh.cmd', { skip: process.platform !== 'win32' }, async t => {
  const appData = await directory(t), npm = join(appData, 'npm');
  const marker = join(npm, 'dsh.cmd'), packageDir = join(npm, 'node_modules', '@deepseek-ai', 'dsh');
  const packageFile = join(packageDir, 'package.json'), entry = join(packageDir, 'lib', 'bin.js');
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(marker, '@exit /b 99\r\n');
  await writeFile(entry, 'console.log(process.argv.slice(2).join(" "))');
  await writeFile(packageFile, JSON.stringify({ name: '@deepseek-ai/dsh', bin: { dsh: 'lib/bin.js' } }));
  const env = { APPDATA: appData, PATH: dirname(process.execPath) };
  assert.equal(findAgent('deepseek', env), marker);
  const command = agentCommand('deepseek', env);
  assert.deepEqual(command, { binary: process.execPath, args: [entry] });
  assert.equal(await versionOf(command.binary, command.args), '--version');
  const localMarker = join(npm, 'node_modules', '.bin', 'dsh.cmd');
  await mkdir(dirname(localMarker), { recursive: true });
  await writeFile(localMarker, '@exit /b 98\r\n');
  assert.deepEqual(agentCommand('deepseek', { ...env, VIBE_DEEPSEEK_BINARY: localMarker }), command);
  await writeFile(packageFile, JSON.stringify({ name: '@deepseek-ai/dsh', bin: { dsh: '../../foreign.js' } }));
  assert.throws(() => agentCommand('deepseek', { ...env, VIBE_DEEPSEEK_BINARY: marker }), /dsh.cmd/);
});
