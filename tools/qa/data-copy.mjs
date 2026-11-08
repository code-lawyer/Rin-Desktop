import assert from 'node:assert/strict';
import { cp, mkdir, readdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { packagedSession } from './packaged-session.mjs';
import { createRunDirectory, requireLiveRun, writeRunReport } from './run-output.mjs';

requireLiveRun(
  'npm run qa:data-copy -- --run --package=<test package> --source=<closed app data>',
  'read-only copy of real closed-app data, packaged validation and corrupt-copy recovery. Quit the source app first. Only QA copies are changed; accounts, remote input and model loading are disabled in the runtime copy',
);
const args = process.argv.slice(2),
  option = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (
  !option('package') ||
  !option('source') ||
  args.some((arg) => arg !== '--run' && !/^--(package|source)=./.test(arg))
)
  throw Error('Use --run, --package and --source');
const directory = resolve(option('package')),
  source = await realpath(resolve(option('source')));
const output = await createRunDirectory('data-copy'),
  copy = join(output, '完整 数据副本');
const backend = (name) => import(pathToFileURL(join(directory, 'resources/app/backend', name + '.mjs')));
const { validateDataDirectory, selectDataDirectory } = await backend('data-directory');
const { WorkspaceStore } = await backend('workspace-store');
const { recoverDataCopy } = await backend('data-recovery');
const report = { checks: [], accounts: false, hardware: false, privateSource: true, passed: false };
let session;
async function hashes(root) {
  const result = {};
  async function visit(base, prefix = '') {
    const entries = await readdir(base, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(base, entry.name),
        key = prefix + entry.name;
      assert.ok(
        !entry.isSymbolicLink(),
        'Data-copy QA refuses linked directories/files; inspect those manually',
      );
      if (entry.isDirectory()) await visit(path, key + '/');
      else if (entry.isFile())
        result[key] = createHash('sha256')
          .update(await readFile(path))
          .digest('hex');
    }
  }
  await visit(root);
  return result;
}
console.log(JSON.stringify({ output }));
try {
  const original = await hashes(source);
  await cp(source, copy, { recursive: true, force: false, errorOnExist: true, dereference: false });
  assert.deepEqual(await hashes(source), original, 'closed source stayed unchanged while copying');
  assert.deepEqual(await hashes(copy), original, 'whole copy matches every source file');
  const sourceRecord = JSON.parse(await readFile(join(copy, 'workspaces.json'), 'utf8'));
  const store = new WorkspaceStore(copy);
  await store.load();
  assert.deepEqual(store.data.projects, sourceRecord.projects);
  for (const draft of Object.values(sourceRecord.drafts || {}))
    assert.ok(
      Object.values(store.data.drafts).some((value) => value.text.includes(draft.text)),
      'every real draft survives normalization',
    );
  assert.equal(await validateDataDirectory(copy), await realpath(copy));
  const pointer = join(output, 'isolated-data-pointer.json');
  assert.equal(await selectDataDirectory(copy, pointer), await realpath(copy));
  assert.equal(JSON.parse(await readFile(pointer, 'utf8')).directory, await realpath(copy));
  report.checks.push(
    'whole closed data copy is byte-identical; packaged store reads all projects and drafts; isolated pointer validates the copy',
  );
  report.sourceFiles = Object.keys(original).length;
  report.projects = sourceRecord.projects.length;
  report.drafts = Object.keys(sourceRecord.drafts || {}).length;

  const corrupt = join(output, '损坏副本'),
    recovered = join(output, '恢复副本');
  await cp(copy, corrupt, { recursive: true, force: false, errorOnExist: true });
  await writeFile(join(corrupt, 'workspaces.json'), '{deliberately-incomplete');
  const corruptHashes = await hashes(corrupt);
  await assert.rejects(validateDataDirectory(corrupt));
  const plan = await recoverDataCopy(corrupt, recovered);
  assert.equal(plan.applied, false);
  const applied = await recoverDataCopy(corrupt, recovered, { run: true });
  assert.equal(applied.applied, true);
  assert.equal(await validateDataDirectory(recovered), await realpath(recovered));
  await assert.rejects(recoverDataCopy(corrupt, recovered, { run: true }), /存在/);
  assert.deepEqual(await hashes(corrupt), corruptHashes, 'corrupt evidence was never overwritten');
  const recoveryStore = new WorkspaceStore(recovered);
  await recoveryStore.load();
  const backup = JSON.parse(await readFile(join(copy, 'workspaces.json.bak'), 'utf8'));
  assert.deepEqual(recoveryStore.data.projects, backup.projects);
  report.checks.push(
    'corrupt-copy preview and recovery use the actual prior backup, preserve evidence and refuse overwriting an existing output',
  );

  const runtime = join(output, '运行 副本');
  await cp(copy, runtime, { recursive: true, force: false, errorOnExist: true });
  // Disable side effects only in this extra runtime copy. Full restoration was
  // already checked above without editing a single copied setting.
  const settings = {
    ...sourceRecord.settings,
    ttsResident: false,
    prepareSpeech: false,
    autoSpeak: false,
    remoteEnabled: false,
    ambienceEnabled: false,
    rc003: { ...sourceRecord.settings.rc003, autoConnect: false, device: null },
  };
  await writeFile(join(runtime, 'workspaces.json'), JSON.stringify({ ...sourceRecord, settings }, null, 2));
  const expected = new WorkspaceStore(runtime);
  await expected.load();
  const savedSession = JSON.parse(await readFile(join(runtime, 'session.json'), 'utf8'));
  session = await packagedSession({ directory, output, storage: runtime, project: savedSession.cwd });
  const restored = (await session.workspace.evaluate('companion.workspace()')).value;
  assert.equal(restored.remote.phase, 'disconnected');
  assert.equal(restored.settings.rc003.autoConnect, false);
  assert.equal(restored.settings.rc003.device, null);
  assert.deepEqual(restored.projects, expected.data.projects);
  assert.deepEqual(restored.settings, expected.data.settings);
  const after = JSON.parse(await readFile(join(runtime, 'workspaces.json'), 'utf8'));
  assert.deepEqual(after.drafts, sourceRecord.drafts);
  assert.deepEqual(session.errors, []);
  await session.close();
  session = null;
  assert.deepEqual(
    await hashes(source),
    original,
    'original daily data stays byte-identical through all acceptance checks',
  );
  assert.deepEqual(await hashes(copy), original, 'untouched reference copy stays byte-identical');
  report.checks.push(
    'actual packaged workbench restores the runtime copy with safety overrides; original and reference copy retain every hash',
  );
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (session)
    await session.close().catch((error) => {
      report.cleanupError = error.message;
      process.exitCode = 1;
    });
  await writeRunReport(output, report);
  console.log(
    JSON.stringify({ output, passed: report.passed, checks: report.checks.length, error: report.error }),
  );
}
