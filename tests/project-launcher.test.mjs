import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { launchPlan, inspectLaunch, electronEnvironment, buildAndLaunch, projectRoot } from '../tools/project/start.mjs';

test('source selection never falls back to an old release, and retains the existing data location', async t => {
  const base = resolve(tmpdir());
  const root = await mkdtemp(join(base, 'rin-launch-'));
  t.after(async () => { if (!resolve(root).startsWith(base + sep)) throw Error('Invalid fixture path'); await rm(root, { recursive: true, force: true }); });
  const old = join(root, 'release/VibeVoice-0.2.0-win-x64');
  await mkdir(old, { recursive: true }); await writeFile(join(old, 'VibeVoice.exe'), 'fixture');
  const plan = launchPlan([], root);
  assert.equal(plan.appRoot, join(root, 'prototypes/live2d-codex'));
  assert.deepEqual(plan.args, [plan.appRoot, '--mode=wallpaper']);
  assert.equal(plan.storage, join(root, 'work/runtime/avatar'));
  const checked = inspectLaunch(plan, { platform: 'win32', nodeVersion: '24.0.0' });
  assert.equal(checked.ready, false);
  assert.equal(checked.electron, null);
  assert.ok(checked.problems.some(problem => problem.includes('manifests')));
});

test('space-containing project and data paths remain separate arguments rooted at the repository', () => {
  const root = resolve('example checkout');
  const plan = launchPlan(['--provider=claude', '--storage=data folder', '--project=../work project', '--check'], root);
  assert.equal(plan.storage, join(root, 'data folder'));
  assert.ok(plan.args.includes(`--project=${resolve(root, '../work project')}`));
  assert.ok(plan.args.includes(`--storage=${join(root, 'data folder')}`));
  assert.ok(plan.args.includes('--provider=claude'));
  assert.equal(plan.args.includes('--check'), false);
  assert.equal(plan.check, true);
});

test('an omitted provider preserves the saved selection; explicit modes are retained', () => {
  const plan = launchPlan(['--mode=avatar', '--shortcut=off']);
  assert.equal(plan.mode, 'avatar');
  assert.equal(plan.args.some(arg => arg.startsWith('--provider=')), false);
  assert.ok(plan.args.includes('--shortcut=off'));
});

test('ambiguous or invalid launch options fail before starting an application', () => {
  for (const args of [['--mode=bad'], ['--provider=unknown'], ['--storage='], ['--provider=codex', '--provider=dots'], ['--project', 'folder'], ['--STORAGE=separate-data'], ['--storag=separate-data']]) {
    assert.throws(() => launchPlan(args));
  }
});

async function processFixture(t) {
  const base = resolve(tmpdir()), root = await mkdtemp(join(base, 'rin-handoff-'));
  t.after(async () => { if (!resolve(root).startsWith(base + sep)) throw Error('Invalid fixture path'); await rm(root, { recursive: true, force: true }); });
  const buildScript = join(root, 'build.mjs');
  await writeFile(buildScript, '// Successful fixture build.\n');
  return { root, appRoot: root, buildScript, electron: process.execPath, args: [] };
}

test('read-only launch inspection never loads Electron installation hooks', async t => {
  const fixture = await processFixture(t), plan = launchPlan([], fixture.root);
  const electronRoot = join(plan.appRoot, 'node_modules/electron'), marker = join(fixture.root, 'installer-ran');
  await mkdir(electronRoot, { recursive: true });
  await writeFile(join(electronRoot, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
  await writeFile(join(electronRoot, 'index.js'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected install'); throw new Error('Installer must never execute');`);
  const options = { platform: 'win32', nodeVersion: '24.0.0', env: {} };
  assert.equal(inspectLaunch(plan, options).electron, null);
  await writeFile(join(electronRoot, 'path.txt'), 'electron.exe');
  assert.equal(inspectLaunch(plan, options).electron, null);
  await mkdir(join(electronRoot, 'dist'));
  const binary = join(electronRoot, 'dist/electron.exe'); await writeFile(binary, 'fixture');
  assert.equal(inspectLaunch(plan, options).electron, binary);
  const override = join(fixture.root, 'override'); await mkdir(override);
  await writeFile(join(override, 'electron.exe'), 'fixture override');
  assert.equal(inspectLaunch(plan, { ...options, env: { ELECTRON_OVERRIDE_DIST_PATH: override } }).electron, join(override, 'electron.exe'));
  assert.equal(existsSync(marker), false, 'metadata checks must not invoke the package entry point');
});

test('a failed source build rejects before an application can run', async t => {
  const plan = await processFixture(t), marker = join(plan.root, 'app-started');
  await writeFile(plan.buildScript, 'process.exit(9);\n');
  plan.args = ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`];
  plan.background = true;
  await assert.rejects(buildAndLaunch(plan), error => error.status === 9);
  assert.equal(existsSync(marker), false);
});

test('the terminal launcher reports the application exit code', async t => {
  const plan = await processFixture(t);
  plan.args = ['-e', 'process.exit(7)'];
  assert.equal(await buildAndLaunch(plan), 7);
});

test('a background process spawn failure is reported instead of a successful handoff', async t => {
  const plan = await processFixture(t);
  plan.background = true;
  plan.electron = join(plan.root, 'missing-electron.exe');
  await assert.rejects(buildAndLaunch(plan), { code: 'ENOENT' });
});

test('the hidden launcher hands off only after spawn and retains independent app logs', async t => {
  const plan = await processFixture(t), release = join(plan.root, 'release-child'), done = join(plan.root, 'done');
  plan.background = true;
  plan.args = ['-e', `const fs = require('node:fs');
    console.log('fixture stdout'); console.error('fixture stderr');
    const deadline = Date.now() + 4000;
    const timer = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(release)}) || Date.now() > deadline) {
        clearInterval(timer); fs.writeFileSync(${JSON.stringify(done)}, 'done');
      }
    }, 20);`];
  const result = await buildAndLaunch(plan);
  const returnedBeforeExit = !existsSync(done);
  await writeFile(release, 'exit now');
  for (let attempt = 0; attempt < 200 && !existsSync(done); attempt++) await delay(20);
  assert.equal(existsSync(done), true);
  await delay(50);
  assert.equal(result, 0);
  assert.equal(returnedBeforeExit, true);
  const logDirectory = join(plan.root, 'work/runtime/launcher'), logs = await readdir(logDirectory);
  assert.match(await readFile(join(logDirectory, logs.find(name => !name.endsWith('.error.log'))), 'utf8'), /fixture stdout/);
  assert.match(await readFile(join(logDirectory, logs.find(name => name.endsWith('.error.log'))), 'utf8'), /fixture stderr/);
});

async function powershellFixture(t, source) {
  const plan = await processFixture(t), directory = join(plan.root, 'tools/project');
  await mkdir(directory, { recursive: true });
  const wrapper = join(directory, 'launch.ps1');
  await writeFile(wrapper, await readFile(join(projectRoot, 'tools/project/launch.ps1')));
  await writeFile(join(directory, 'start.mjs'), `if (process.argv.includes('--check')) console.log(JSON.stringify({ ready: true, args: process.argv.slice(2) }));\nelse if (process.argv.includes('--background')) { ${source} }\nelse throw Error('Unrecognized fixture arguments');`);
  return { ...plan, wrapper };
}

test('PowerShell reports a post-preflight failure to its CMD caller', { skip: process.platform !== 'win32' }, async t => {
  const plan = await powershellFixture(t, "console.error('fixture build failure'); process.exit(9);");
  assert.throws(() => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', plan.wrapper, '-NoDialog'], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }), error => {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /exit 9/);
    assert.match(error.stderr, /fixture build failure/);
    return true;
  });
});

test('PowerShell handoff preserves spaces, Unicode and a trailing path separator', { skip: process.platform !== 'win32' }, async t => {
  const plan = await powershellFixture(t, "const fs = await import('node:fs'); fs.writeFileSync('received.json', JSON.stringify(process.argv.slice(2)));");
  const storage = 'data folder\\', project = 'workspace 项目';
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', plan.wrapper, '-NoDialog', '-Storage', storage, '-Project', project];
  const expected = ['--mode=wallpaper', `--storage=${storage}`, `--project=${project}`];
  const psQuote = value => `'${value.replaceAll("'", "''")}'`;
  for (const codePage of [65001, 437]) {
    // Inspect the PowerShell string before console encoding. Return ASCII so
    // the caller's console cannot obscure a preflight decoding failure.
    const script = `$previousEncoding = [Console]::OutputEncoding
      try {
        [Console]::OutputEncoding = [Text.Encoding]::GetEncoding(${codePage})
        $result = & ${psQuote(plan.wrapper)} -NoDialog -Check -Storage ${psQuote(storage)} -Project ${psQuote(project)}
        [Console]::WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($result)))
      } finally { [Console]::OutputEncoding = $previousEncoding }`;
    const encoded = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
    assert.deepEqual(JSON.parse(Buffer.from(encoded.trim(), 'base64').toString('utf8')).args, [...expected, '--check']);
  }
  assert.equal(existsSync(join(plan.root, 'work/runtime/launcher')), false);
  execFileSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true });
  assert.deepEqual(JSON.parse(await readFile(join(plan.root, 'received.json'), 'utf8')), [...expected, '--background']);
});

test('Electron run-as-Node is removed case-insensitively without losing provider or proxy environment', () => {
  const before = { electron_run_as_node: '1', HTTPS_PROXY: 'http://localhost:1234', CUSTOM_SETTING: 'retained' };
  assert.deepEqual(electronEnvironment(before), { HTTPS_PROXY: before.HTTPS_PROXY, CUSTOM_SETTING: 'retained' });
  assert.equal(before.electron_run_as_node, '1');
});

test('root and legacy npm entry points both provide help without starting Electron', () => {
  for (const entry of ['tools/project/start.mjs', 'prototypes/live2d-codex/scripts/start.mjs']) {
    const output = execFileSync(process.execPath, [join(projectRoot, entry), '--help'], { encoding: 'utf8', windowsHide: true });
    assert.match(output, /Rin Desktop source launcher/);
    assert.match(output, /work\/runtime\/avatar/);
  }
});

test('project status distinguishes RC003 source integration from hardware acceptance', async () => {
  const ledger = JSON.parse(await readFile(join(projectRoot, 'docs/development/backlog.json'), 'utf8'));
  const run = args => execFileSync(process.execPath, [join(projectRoot, 'tools/project/status.mjs'), ...args], { encoding: 'utf8', windowsHide: true });
  const status = JSON.parse(run(['--json']));
  assert.equal(status.components.remote.sourcePresent, true);
  for (const id of ['REM-02', 'REM-03', 'REM-04', 'REM-06']) assert.equal(status.components.remote.integration[id], ledger.tasks.find(task => task.id === id).status);
  assert.equal(status.components.remote.hardwareAcceptance, ledger.tasks.find(task => task.id === 'REM-05').status);
  assert.match(run([]), /main-application source integrated/);
});
