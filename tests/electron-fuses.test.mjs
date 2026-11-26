import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FUSE_SENTINEL, PACKAGED_FUSES, readElectronFuses, flipElectronFuses } from '../tools/release/electron-fuses.mjs';
import { auditPublic } from '../tools/release/audit-public.mjs';

function syntheticBinary(states = [1, 1, 1, 1, 0, 0, 1, 0, 0]) {
  const prefix = Buffer.from('MZ-fixture-header-');
  const sentinel = Buffer.from(FUSE_SENTINEL, 'ascii');
  const wire = Buffer.from([1, states.length, ...states.map(value => (value ? 0x31 : 0x30))]);
  const suffix = Buffer.from('-fixture-tail');
  return Buffer.concat([prefix, sentinel, wire, suffix]);
}

test('Electron fuse reader and flipper harden packaged binaries and reject malformed inputs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rin-fuses-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const exe = join(dir, 'VibeVoice.exe');
  await writeFile(exe, syntheticBinary());

  const before = await readElectronFuses(exe);
  assert.equal(before.values.runAsNode, true);
  assert.equal(before.values.enableNodeOptionsEnvironmentVariable, true);
  assert.equal(before.values.enableNodeCliInspectArguments, true);

  const after = await flipElectronFuses(exe);
  for (const [name, expected] of Object.entries(PACKAGED_FUSES)) {
    assert.equal(after.values[name], expected, name);
  }
  const reread = await readElectronFuses(exe);
  assert.deepEqual(reread, after);

  const missing = join(dir, 'missing.exe');
  await writeFile(missing, Buffer.from('no sentinel here'));
  await assert.rejects(readElectronFuses(missing), /sentinel not found/);

  const duplicate = join(dir, 'duplicate.exe');
  await writeFile(duplicate, Buffer.concat([syntheticBinary(), syntheticBinary()]));
  await assert.rejects(flipElectronFuses(duplicate), /Multiple Electron fuse sentinels/);
});

test('public audit detects expanded provider token and encrypted key patterns', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rin-audit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
  const samples = [
    ['pat.txt', 'token=' + 'github_' + 'pat_' + 'A'.repeat(26)],
    ['xai.txt', 'key=' + 'xai' + '-' + 'B'.repeat(24)],
    ['google.txt', 'key=' + 'AI' + 'za' + 'C'.repeat(35)],
    ['enc.pem', '-----BEGIN ' + 'ENCRYPTED PRIVATE KEY-----'],
  ];
  for (const [name, content] of samples) {
    await writeFile(join(dir, name), content);
  }
  const report = await auditPublic(dir);
  for (const [name] of samples) {
    assert.ok(
      report.problems.some(entry => entry.file === name && entry.reason === 'secret pattern'),
      `expected secret pattern detection for ${name}`,
    );
  }
});
