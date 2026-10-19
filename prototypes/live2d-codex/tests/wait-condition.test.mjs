import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCondition } from '../scripts/wait-for-condition.mjs';

test('an async false predicate must time out instead of resolving from the Promise truthiness', async () => {
  let reads = 0;
  await assert.rejects(waitForCondition(async () => { reads++; return false; }, { timeout: 40, interval: 5 }), /timed out/);
  assert.ok(reads > 1);
});

test('async readiness is polled until it succeeds and errors stay visible', async () => {
  let reads = 0;
  assert.equal(await waitForCondition(async () => ++reads === 3 ? 'ready' : false, { timeout: 500, interval: 1 }), 'ready');
  assert.equal(reads, 3);
  await assert.rejects(waitForCondition(async () => { throw new Error('connection failed'); }), /connection failed/);
});
