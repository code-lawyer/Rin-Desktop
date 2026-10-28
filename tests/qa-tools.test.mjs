import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRunDirectory, writeRunReport } from '../tools/qa/run-output.mjs';

const exec = promisify(execFile), root = resolve(import.meta.dirname, '..');
for (const name of ['still-desktop', 'interface-check', 'remote-focus', 'visual-check', 'still-scene', 'motion-desktop', 'motion-live', 'project-inventory', 'shutdown-desktop']) {
  test(`${name} help performs no directory or process operations`, async () => {
    // Update the built-in ESM bindings so a regression fails before opening a
    // real window or writing any reports, even when Electron is installed.
    const sentinel = `import fs from 'node:fs/promises'; import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
      fs.mkdir = () => { throw new Error('help attempted mkdir'); }; cp.spawn = () => { throw new Error('help attempted spawn'); }; syncBuiltinESMExports();`;
    for (const flags of [...(['visual-check','still-scene','motion-desktop','motion-live','project-inventory','shutdown-desktop'].includes(name) ? [[]] : []), ['--help'], ['-h'], ['--baseline', '--help']]) {
      const { stdout } = await exec(process.execPath, ['--import=data:text/javascript,' + encodeURIComponent(sentinel), join(root, 'tools/qa', name + '.mjs'), ...flags], { cwd: root, windowsHide: true, timeout: 15000 });
      assert.match(stdout, /Usage: npm run qa:/); assert.match(stdout, /help only/);
    }
  });
}
test('QA output isolates each run and rejects existing/outside evidence paths', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'rin-qa-tools-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const base = join(fixture, 'qa');
  const [first, second] = await Promise.all([createRunDirectory('probe', null, base), createRunDirectory('probe', null, base)]);
  assert.notEqual(first, second);
  await writeRunReport(first, { status: 'original' });
  await assert.rejects(writeRunReport(first, { status: 'changed' }), { code: 'EEXIST' });
  await assert.rejects(createRunDirectory('probe', first, base), { code: 'EEXIST' });
  assert.deepEqual(JSON.parse(await readFile(join(first, 'result.json'), 'utf8')), { status: 'original' });
  for (const target of [base, fixture, join(fixture, 'qa-other', 'run')]) {
    await assert.rejects(createRunDirectory('probe', target, base), /inside work\/qa/);
  }
  await assert.rejects(access(join(fixture, 'qa-other')));
  const explicit = join(base, 'selected', 'new-run');
  assert.equal(await createRunDirectory('probe', explicit, base), explicit);
  await assert.rejects(createRunDirectory('../probe', null, base), /category/);
});

for (const script of ['codex-probe.mjs', 'codex-tui-probe.mjs']) {
  test(`${script} default and help do not execute the configured CLI or create outputs`, async t => {
    const fixture = await mkdtemp(join(tmpdir(), 'rin-probe-help-'));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    const output = join(fixture, 'must-not-exist');
    for (const flags of [[], ['--run', '--help']]) {
      const { stdout } = await exec(process.execPath, [join(root, 'tools/probes', script), '--codex=missing-cli-for-help-test', `--output=${output}`, ...flags], { cwd: root, windowsHide: true, timeout: 15000 });
      assert.match(stdout, /Default: help only/);
      await assert.rejects(access(output));
    }
  });
}

for (const name of ['avatar-controls', 'avatar-drag', 'placement', 'bubble-drag', 'character-switch']) {
  test(`GUI ${name} help does not require Playwright or start Electron`, async () => {
    for (const flags of [[], ['--run', '--help']]) {
      const { stdout } = await exec(process.execPath, [join(root, 'tools/qa/gui/cases', `${name}.mjs`), ...flags], {
        cwd: root, env: { ...process.env, VIBE_PLAYWRIGHT: 'missing-playwright-for-help-test' }, windowsHide: true, timeout: 15000
      });
      assert.match(stdout, /Default: help only/);
    }
  });
}

test('Windows preflight requires explicit Run before examining the host', { skip: process.platform !== 'win32' }, async () => {
  const { stdout } = await exec('pwsh.exe', ['-NoProfile', '-File', join(root, 'tools/probes/windows-preflight.ps1'), '-CodexPath', 'missing-cli-for-help-test'], { cwd: root, windowsHide: true, timeout: 15000 });
  assert.match(stdout, /Default: help only/);
});
