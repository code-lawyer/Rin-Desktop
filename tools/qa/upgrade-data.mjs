import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packagedSession } from './packaged-session.mjs';
import { rejectDataLinks } from './data-copy-safety.mjs';
import { createRunDirectory, requireLiveRun, writeRunReport } from './run-output.mjs';

requireLiveRun(
  'npm run qa:upgrade-data -- --run --setup=<candidate Setup> --previous-setup=<published Setup> --source=<closed real data copy>',
  'portable installation of old/current/old builds under a fresh QA path and actual launches using further isolated copies. No registration, accounts or hardware',
);
const args = process.argv.slice(2),
  option = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (
  !option('setup') ||
  !option('previous-setup') ||
  !option('source') ||
  args.some((arg) => arg !== '--run' && !/^--(setup|previous-setup|source)=./.test(arg))
)
  throw Error('Use --run, --setup, --previous-setup and --source');
const execute = promisify(execFile),
  output = await createRunDirectory('upgrade-data');
const application = join(output, '中文 程序'),
  data = join(output, 'isolated-data'),
  rollback = join(output, 'rollback-copy');
await rejectDataLinks(resolve(option('source')));
const original = await readFile(join(resolve(option('source')), 'workspaces.json'));
const report = { checks: [], accounts: false, hardware: false, passed: false };
let session;
async function install(setup, name) {
  await execute(
    resolve(setup),
    [
      '/VERYSILENT',
      '/SUPPRESSMSGBOXES',
      '/NORESTART',
      '/SP-',
      '/PORTABLE=1',
      '/DIR=' + application,
      '/LOG=' + join(output, name + '.log'),
    ],
    { windowsHide: true, timeout: 120000 },
  );
  return JSON.parse(await readFile(join(application, 'resources/app/portable.json'), 'utf8'));
}
async function check(storage, label) {
  const { WorkspaceStore } = await import(
    pathToFileURL(join(application, 'resources/app/backend/workspace-store.mjs')) + '?phase=' + label
  );
  const expected = new WorkspaceStore(storage);
  await expected.load();
  const savedSession = JSON.parse(await readFile(join(storage, 'session.json'), 'utf8'));
  session = await packagedSession({
    directory: application,
    output,
    storage,
    project: savedSession.cwd,
    allowReleasePackage: true,
  });
  const actual = (await session.workspace.evaluate('companion.workspace()')).value;
  assert.deepEqual(actual.projects, expected.data.projects);
  assert.deepEqual(actual.settings, expected.data.settings);
  assert.equal(actual.remote.phase, 'disconnected');
  assert.deepEqual(
    JSON.parse(await readFile(join(storage, 'workspaces.json'), 'utf8')).drafts,
    expected.data.drafts,
  );
  assert.deepEqual(session.errors, []);
  await session.close();
  session = null;
  report.checks.push(
    label +
      ': actual app restores projects, conversation references, drafts and settings, then exits with all owned processes',
  );
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
  await check(data, 'previous');
  const beforeUpgrade = await readFile(join(data, 'workspaces.json'));
  report.candidate = await install(option('setup'), 'candidate-upgrade');
  assert.equal(report.candidate.testBuild?.channel, 'internal-test');
  assert.deepEqual(
    await readFile(join(data, 'workspaces.json')),
    beforeUpgrade,
    'upgrade installer never rewrites separate app data',
  );
  await check(data, 'upgraded');
  await cp(data, rollback, { recursive: true, force: false, errorOnExist: true });
  await install(option('previous-setup'), 'rollback-install');
  await check(rollback, 'rollback');
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
