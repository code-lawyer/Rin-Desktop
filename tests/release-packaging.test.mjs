import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { inspectPackage, writeManifest } from '../tools/release/manifest.mjs';
import { releaseGit, trackedPackageInputs } from '../tools/release/package-inputs.mjs';
import { captureSourceState, verifySourceState } from '../tools/release/source-state.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rin-package-test-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const put = async (name, contents = 'test\n') => {
    const file = join(directory, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  };
  return { directory, put };
}

test('portable packaging selects tracked runtime sources and excludes ignored and generated content', async t => {
  const { directory, put } = await fixture(t);
  releaseGit(directory, ['init', '-q']);
  const prefix = 'prototypes/live2d-codex/';
  const files = ['renderer/index.html', 'renderer/avatar.js', 'backend/agent.mjs', 'backend/ignored.mjs', 'dist/stale.js'];
  await put('.gitignore', 'ignored.mjs\n');
  for (const name of [...files, 'backend/untracked.mjs', 'renderer/.env']) await put(prefix + name);
  releaseGit(directory, ['add', '-f', '--', ...files.map(name => prefix + name)]);
  assert.deepEqual(trackedPackageInputs(directory), ['backend/agent.mjs', 'renderer/index.html']);
});

test('the package audit catches private files even when listed in a generated manifest', async t => {
  const { directory, put } = await fixture(t);
  for (const name of ['resources/app/backend/.env', 'resources/app/renderer/debug.log', 'resources/app/dist/old.js', 'LOCALAPPDATA/session.json']) {
    await put(name);
    await put('manifest.json', JSON.stringify({ files: [{ file: name }] }));
    await assert.rejects(inspectPackage(directory), /Non-public or unexpected package path/);
    await rm(join(directory, name));
  }
  await put('resources/app/backend/helper.mjs', 'const sample = "' + ['ghp_', 'z'.repeat(36)].join('') + '";');
  await assert.rejects(writeManifest(directory, '0.0.0'), /Package file .*: secret pattern/);
});

test('the package audit inspects UTF-16 text written by Windows tools', async t => {
  const { directory, put } = await fixture(t);
  const contents = Buffer.from('\uFEFFfixture ' + ['ghp_', 'z'.repeat(36)].join(''), 'utf16le');
  for (const text of [contents, Buffer.from(contents).swap16()]) {
    await put('resources/app/backend/local-notes.txt', text);
    await assert.rejects(writeManifest(directory, '0.0.0'), /Package file .*: secret pattern/);
  }
});

test('the package audit rejects directory links without following them', async t => {
  const { directory, put } = await fixture(t);
  await put('target/app.js');
  await mkdir(join(directory, 'stage'));
  await symlink(join(directory, 'target'), join(directory, 'stage', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectPackage(join(directory, 'stage')), /must be an ordinary file: linked/);
});

test('the installer manifest requires links in all packaged guides to resolve', async t => {
  const { directory, put } = await fixture(t);
  await put('TEST-ACCEPTANCE.md', '[QA](../qa/README.md)');
  await assert.rejects(writeManifest(directory, '0.0.0'), /Missing or external link in TEST-ACCEPTANCE.md/);
  await put('TEST-ACCEPTANCE.md', '[Guide](USER-GUIDE.md) · [QA](https://example.test/qa)');
  await put('USER-GUIDE.md', '# Guide\n');
  assert.equal((await writeManifest(directory, '0.0.0')).files, 2);
  assert.equal(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')).files.length, 2);
});

test('publishable packaging pins a clean commit and detects changes to the source', async t => {
  const { directory, put } = await fixture(t);
  releaseGit(directory, ['init', '-q']);
  await put('LICENSE');
  await put('.gitignore', '*.log\n');
  releaseGit(directory, ['add', '--', 'LICENSE', '.gitignore']);
  releaseGit(directory, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
  await put('ignored.log');
  const options = { build: 'fixture', version: '0.0.0', channel: 'preflight', publishable: true };
  const source = await captureSourceState(directory, options);
  assert.equal(source.head, releaseGit(directory, ['rev-parse', 'HEAD']));
  assert.equal(source.dirty, false);
  assert.deepEqual(source.files.map(({ file }) => file), ['.gitignore', 'LICENSE']);
  await verifySourceState(directory, source);
  await put('LICENSE', 'modified\n');
  await assert.rejects(verifySourceState(directory, source), /require a clean Git checkout/);
  await assert.rejects(captureSourceState(directory, options), /require a clean Git checkout/);
  const exploratory = await captureSourceState(directory, { ...options, publishable: false });
  assert.equal(exploratory.dirty, true);
  assert.equal(exploratory.publishable, false);
  await put('LICENSE', 'modified again\n');
  await assert.rejects(verifySourceState(directory, exploratory), /changed during packaging/);
  for (const flag of ['assume-unchanged', 'skip-worktree']) {
    releaseGit(directory, ['update-index', `--${flag}`, '--', 'LICENSE']);
    assert.equal(releaseGit(directory, ['status', '--porcelain=v1']), '');
    await assert.rejects(captureSourceState(directory, options), /index without assume-unchanged or skip-worktree/);
    await assert.rejects(verifySourceState(directory, source), /index without assume-unchanged or skip-worktree/);
    releaseGit(directory, ['update-index', `--no-${flag}`, '--', 'LICENSE']);
  }
});
