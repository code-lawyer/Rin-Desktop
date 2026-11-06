import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSleeperFixture, waitForProbeSignal } from '../tools/probes/cli-agents/fixture-control.mjs';

test('waiting for a tool observes an immediate turn rejection', async () => {
  const error = new Error('reader disconnected');
  await assert.rejects(waitForProbeSignal(() => false, 'tool', Promise.reject(error), { interval: 1 }), value => value === error);
});

test('a finished turn cannot leave permission or stream polling until timeout', async () => {
  await assert.rejects(waitForProbeSignal(() => false, 'permission', Promise.resolve(), { interval: 1 }), /Turn ended before permission/);
  await assert.rejects(waitForProbeSignal(() => false, 'stream', new Promise(() => {}), { interval: 1, timeout: 5 }), /stream not observed/);
});

test('a live turn allows its expected tool event', async () => {
  await waitForProbeSignal(() => true, 'tool', new Promise(() => {}));
});

test('fixture cleanup ignores a forged PID file and stops only its cooperating sleeper', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rin-sleeper-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = await createSleeperFixture();
  t.after(() => fixture.close());
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  const sleeper = spawn(process.execPath, ['-e', fixture.script], { cwd: directory, windowsHide: true, stdio: 'ignore' });
  const sleeperExit = once(sleeper, 'exit');
  const unrelatedExit = once(unrelated, 'exit');
  t.after(async () => { unrelated.kill(); sleeper.kill(); await Promise.all([sleeperExit, unrelatedExit]); });
  await writeFile(join(directory, 'slow-started.txt'), String(unrelated.pid));
  await waitForProbeSignal(() => fixture.started, 'fixture connection', undefined, { interval: 5, timeout: 5000 });
  assert.equal(fixture.running, true);
  await fixture.close();
  const [code] = await sleeperExit;
  assert.equal(code, 0);
  assert.equal(fixture.running, false);
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
  await assert.rejects(access(join(directory, 'slow-finished.txt')), { code: 'ENOENT' });
});

test('unrelated control connections cannot mark a fixture started', async () => {
  const fixture = await createSleeperFixture();
  try {
    const socket = connect(fixture.endpoint);
    socket.on('error', () => {});
    const closed = once(socket, 'close');
    socket.write('wrong-token\n');
    await closed;
    assert.equal(fixture.started, false);
    await fixture.close();
    await fixture.close();
  } finally { await fixture.close(); }
});
