import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, readFile, writeFile, realpath, lstat, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packagedSession } from './packaged-session.mjs';
import { rejectDataLinks } from './data-copy-safety.mjs';
import { createRunDirectory, requireLiveRun, writeRunReport } from './run-output.mjs';

requireLiveRun(
  'npm run qa:upgrade-data -- --run --setup=<candidate Setup> --previous-setup=<old Setup> --source=<closed data copy> [--release-channel]',
  'portable installation of old/current/old builds under a fresh QA path and actual launches using further isolated copies. No registration, accounts or hardware',
);
const args = process.argv.slice(2),
  option = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const releaseChannel = args.includes('--release-channel');
if (
  !option('setup') ||
  !option('previous-setup') ||
  !option('source') ||
  args.some((arg) => !['--run', '--release-channel'].includes(arg) && !/^--(setup|previous-setup|source)=./.test(arg))
)
  throw Error('Use --run, --setup, --previous-setup and --source');
const execute = promisify(execFile),
  output = await createRunDirectory('upgrade-data');
const application = join(output, '中文 程序'),
  rollbackApplication = join(output, '回退 程序'),
  data = join(output, 'isolated-data'),
  rollback = join(output, 'rollback-copy');
await rejectDataLinks(resolve(option('source')));
const original = await readFile(join(resolve(option('source')), 'workspaces.json'));
const report = { checks: [], releaseChannel, accounts: false, hardware: false, passed: false };
let session;
async function install(setup, name, directory = application) {
  await execute(
    resolve(setup),
    [
      '/VERYSILENT',
      '/SUPPRESSMSGBOXES',
      '/NORESTART',
      '/SP-',
      '/PORTABLE=1',
      '/DIR=' + directory,
      '/LOG=' + join(output, name + '.log'),
    ],
    { windowsHide: true, timeout: 120000 },
  );
  return JSON.parse(await readFile(join(directory, 'resources/app/portable.json'), 'utf8'));
}
async function check(storage, label, directory = application) {
  const primary = join(storage, 'workspaces.json');
  const saved = JSON.parse(await readFile(primary, 'utf8'));
  const savedSession = JSON.parse(await readFile(join(storage, 'session.json'), 'utf8'));
  const target = { provider: 'codex', cwd: savedSession.cwd, threadId: savedSession.threadId ?? null };
  // In-place upgrades replace dependencies at the same paths. Each phase must
  // read the installed store in a fresh Node process with an empty module cache.
  const { stdout } = await execute(process.execPath, [
    '--input-type=module', '--eval', `
      const [entry, storage, draftTarget] = process.argv.slice(1);
      const { WorkspaceStore } = await import(entry);
      const store = new WorkspaceStore(storage);
      await store.load();
      console.log(JSON.stringify({ ...store.snapshot(), draft: store.draftSnapshot(JSON.parse(draftTarget)) }));
    `,
    pathToFileURL(join(directory, 'resources/app/backend/workspace-store.mjs')).href,
    storage,
    JSON.stringify(target),
  ], { windowsHide: true, timeout: 15000, maxBuffer: Math.max(1024 * 1024, 2 * (await stat(primary)).size) });
  const expected = JSON.parse(stdout);
  session = await packagedSession({
    directory,
    output,
    storage,
    project: savedSession.cwd,
    env: { LOCALAPPDATA: join(output, 'local-app-data') },
    allowReleasePackage: true,
  });
  const actual = (await session.workspace.evaluate('companion.workspace()')).value;
  assert.deepEqual(actual.projects, expected.projects);
  assert.deepEqual(actual.settings, expected.settings);
  assert.equal(actual.remote.phase, 'disconnected');
  const draft = await session.chat.evaluate(`companion.draft(${JSON.stringify(target)})`);
  assert.equal(draft.ok, true, draft.error);
  assert.deepEqual(draft.value, expected.draft);
  assert.deepEqual(session.errors, []);
  await session.close();
  session = null;
  const persisted = JSON.parse(await readFile(primary, 'utf8'));
  // The runtime can read legacy draft keys without rewriting them on disk.
  assert.deepEqual(persisted.drafts, saved.drafts, 'read-only startup and shutdown preserve stored drafts');
  report.checks.push(
    label +
      ': actual app restores projects, conversation references, drafts and settings, then exits with all owned processes',
  );
  return { projects: actual.projects, draft: draft.value };
}
console.log(JSON.stringify({ output }));
try {
  await cp(resolve(option('source')), data, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false,
  });
  await rejectDataLinks(data);
  const copiedPrimary = join(data, 'workspaces.json');
  assert.ok((await lstat(copiedPrimary)).isFile());
  assert.ok(
    (await realpath(copiedPrimary)).startsWith((await realpath(data)) + sep),
    'runtime primary stays inside its own QA copy',
  );
  const saved = JSON.parse(original);
  saved.settings = {
    ...saved.settings,
    ttsResident: false,
    prepareSpeech: false,
    autoSpeak: false,
    remoteEnabled: false,
    ambienceEnabled: false,
    rc003: { ...saved.settings.rc003, autoConnect: false, device: null },
  };
  await writeFile(join(data, 'workspaces.json'), JSON.stringify(saved, null, 2));
  report.previous = await install(option('previous-setup'), 'previous-install');
  if (releaseChannel) assert.equal(report.previous.testBuild, undefined, 'Use an older release-channel installer');
  const before = await check(data, 'previous');
  await cp(data, rollback, { recursive: true, force: false, errorOnExist: true });
  const beforeUpgrade = await readFile(join(data, 'workspaces.json'));
  report.candidate = await install(option('setup'), 'candidate-upgrade');
  if (releaseChannel) assert.equal(report.candidate.testBuild, undefined, 'Candidate must use the release channel');
  else assert.equal(report.candidate.testBuild?.channel, 'internal-test');
  assert.deepEqual(
    await readFile(join(data, 'workspaces.json')),
    beforeUpgrade,
    'upgrade installer never rewrites separate app data',
  );
  assert.deepEqual(await check(data, 'upgraded'), before, 'upgrade preserves projects and drafts from the old app');
  report.rollback = await install(option('previous-setup'), 'rollback-install', rollbackApplication);
  assert.deepEqual(await check(rollback, 'rollback', rollbackApplication), before, 'rollback restores the saved data with the old app');
  assert.deepEqual(
    await readFile(join(resolve(option('source')), 'workspaces.json')),
    original,
    'source reference remains untouched',
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
