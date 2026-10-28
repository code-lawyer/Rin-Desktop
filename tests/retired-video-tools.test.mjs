import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { prepareVideoTrial } from '../tools/project/prepare-video-desktop.mjs';

const exec = promisify(execFile), root = resolve(import.meta.dirname, '..');
const sentinel = `import fs from 'node:fs/promises'; import cp from 'node:child_process'; import Module, {syncBuiltinESMExports} from 'node:module';
  for (const name of ['mkdir','cp','readFile','writeFile']) fs[name] = () => { throw new Error('retired entry attempted ' + name); };
  for (const name of ['spawn','execFileSync']) cp[name] = () => { throw new Error('retired entry attempted ' + name); };
  const load = Module._load; Module._load = function(name, ...args) { if (name === 'electron') throw new Error('retired entry loaded Electron'); return load.call(this, name, ...args); };
  syncBuiltinESMExports();`;
async function invoke(file, flags, expectedCode) {
  let result;
  try { result = await exec(process.execPath, ['--import=data:text/javascript,' + encodeURIComponent(sentinel), resolve(root, file), ...flags], { cwd: root, windowsHide: true, timeout: 10000 }); }
  catch (error) { result = error; }
  assert.equal(result.code ?? 0, expectedCode);
  assert.match(result.stdout + result.stderr, /is retired/);
  assert.doesNotMatch(result.stdout + result.stderr, /retired entry (attempted|loaded)/);
}

for (const file of ['tools/project/prepare-video-desktop.mjs', 'tools/qa/video-desktop.mjs']) {
  test(`${file} explains retirement without preparing data or starting a process`, async () => {
    for (const flags of [[], ['--help'], ['--run', '--help']]) await invoke(file, flags, 0);
    await invoke(file, ['--run', '--data-source=must-not-be-read'], 1);
  });
}

test('the retired packaging API rejects before inspecting the caller data', async () => {
  await assert.rejects(prepareVideoTrial({ get dataSource() { throw new Error('data was inspected'); } }), /is retired/);
});

test('direct legacy fixture flags stop before loading Electron or creating a report', async () => {
  for (const flag of ['--video', '--fixture-video']) await invoke('tools/qa/interface-fixture.cjs', [flag], 1);
});
