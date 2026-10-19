import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { AvatarRpc } from '../backend/rpc.mjs';

function childFixture() {
  const child = new EventEmitter();
  child.pid = 123; child.exitCode = null; child.signalCode = null;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => false;
  return child;
}

test('closing after malformed output killed the actual child does not wait for a second exit', { timeout: 5000 }, async t => {
  const child = spawn(process.execPath, ['-e', "process.stdout.write('invalid JSON\\n'); setInterval(() => {}, 1000)"],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const rpc = new AvatarRpc(child);
  await once(child, 'exit');
  assert.equal(rpc.closed, true); assert.equal(child.exitCode, null); assert.equal(child.signalCode, 'SIGTERM');
  await rpc.close(); await rpc.close();
});

test('shutdown has a hard deadline even when killing the child produces no exit event', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = childFixture(), signals = [];
  child.kill = signal => { signals.push(signal); return false; };
  const rpc = new AvatarRpc(child);
  const first = rpc.close(), second = rpc.close();
  t.mock.timers.tick(2500); await Promise.all([first, second]);
  assert.deepEqual(signals, ['SIGKILL']); assert.equal(child.listenerCount('exit'), 1);
});

test('graceful shutdown does not kill an already exited child and releases its close listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = childFixture(); let killed = false;
  child.kill = () => { killed = true; };
  const rpc = new AvatarRpc(child), closing = rpc.close();
  child.exitCode = 0; child.emit('exit', 0); await closing;
  t.mock.timers.tick(3000);
  assert.equal(killed, false); assert.equal(child.listenerCount('exit'), 1);
});
