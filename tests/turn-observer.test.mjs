import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RpcClient } from '../tools/probes/rpc-client.mjs';
import { TurnObserver } from '../tools/probes/turn-observer.mjs';
const complete = (rpc, threadId, id, status = 'completed') => rpc.receive({ method: 'turn/completed', params: { threadId, turn: { id, status, items: [{ text: 'private' }] } } });

test('handles completion received before request response, without retaining text', async () => {
  const rpc = new RpcClient(() => {}); const observer = new TurnObserver(rpc, 'target');
  complete(rpc, 'target', 'one');
  assert.deepEqual(await observer.waitCompleted('one'), { id: 'one', status: 'completed', errorCode: null });
  observer.close(); assert.equal(rpc.listenerCount('notification'), 0);
});
test('does not confuse a different thread or turn with the target', async () => {
  const rpc = new RpcClient(() => {}); const observer = new TurnObserver(rpc, 'target');
  complete(rpc, 'other', 'one'); complete(rpc, 'target', 'other');
  await assert.rejects(observer.waitCompleted('one', { timeoutMs: 5 }), /timeout/); observer.close();
});
test('disconnect rejects a pending observation and releases listeners', async () => {
  const rpc = new RpcClient(() => {}); const observer = new TurnObserver(rpc, 'target');
  const waiting = observer.waitCompleted('one'); rpc.fail(new Error('disconnected'));
  await assert.rejects(waiting, /disconnected/); assert.equal(rpc.listenerCount('closed'), 0);
});
test('bounded history cannot grow indefinitely', async () => {
  const rpc = new RpcClient(() => {}); const observer = new TurnObserver(rpc, 'target', { maxTurns: 1 });
  complete(rpc, 'target', 'one'); complete(rpc, 'target', 'two');
  await assert.rejects(observer.waitCompleted('two'), /limit/);
});
test('activity is matched by thread and turn without retaining streamed text', async () => {
  const rpc = new RpcClient(() => {}); const observer = new TurnObserver(rpc, 'target');
  const waiting = observer.waitActivity('one');
  rpc.receive({ method: 'item/agentMessage/delta', params: { threadId: 'target', turnId: 'one', delta: 'private' } });
  await waiting; observer.close();
});
test('completed turn rejects an outstanding activity wait instead of hanging', async () => {
  const rpc = new RpcClient(() => {}); const observer = new TurnObserver(rpc, 'target');
  const waiting = observer.waitActivity('one'); complete(rpc, 'target', 'one');
  await assert.rejects(waiting, /completed/); observer.close();
});
