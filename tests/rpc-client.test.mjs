import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RpcClient, JsonLineDecoder } from '../tools/probes/rpc-client.mjs';
import { accountOnlyEnvironment, startStdio } from '../tools/probes/stdio-transport.mjs';

test('correlates out-of-order responses with the original requests', async () => {
  const sent = []; const rpc = new RpcClient(message => sent.push(message));
  const one = rpc.request('first'); const two = rpc.request('second');
  rpc.receive({ id: sent[1].id, result: 2 }); rpc.receive({ id: sent[0].id, result: 1 });
  assert.equal(await one, 1); assert.equal(await two, 2); assert.equal(rpc.pendingCount, 0);
});
test('timeout releases pending request and ignores a late response', async () => {
  const rpc = new RpcClient(() => {}, { timeoutMs: 5 });
  await assert.rejects(rpc.request('slow'), error => error.code === 'TIMEOUT');
  rpc.receive({ id: 1, result: 'late' }); assert.equal(rpc.pendingCount, 0);
});
test('process failure rejects all requests and prevents new requests', async () => {
  const rpc = new RpcClient(() => {});
  const first = rpc.request('one'); const second = rpc.request('two');
  rpc.fail(new Error('disconnected'));
  await assert.rejects(first, /disconnected/); await assert.rejects(second, /disconnected/);
  await assert.rejects(rpc.request('three'), /disconnected/);
});
test('server-side interactive request is rejected rather than approved', () => {
  const sent = []; const rpc = new RpcClient(message => sent.push(message));
  rpc.receive({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} });
  assert.equal(sent[0].error.code, -32601); assert.equal(sent[0].result, undefined);
});
test('stream decoder preserves Chinese characters split across chunks', () => {
  const messages = []; const decoder = new JsonLineDecoder(message => messages.push(message));
  const data = Buffer.from('{"text":"修复登录"}\n{"result":2}\n');
  for (const byte of data) decoder.push(Buffer.from([byte]));
  assert.deepEqual(messages, [{ text: '修复登录' }, { result: 2 }]);
});
test('unbounded lines and malformed JSON fail visibly', () => {
  const decoder = new JsonLineDecoder(() => {}, { maxLineBytes: 8 });
  assert.throws(() => decoder.push(Buffer.from('123456789')), /limit/);
  assert.throws(() => new JsonLineDecoder(() => {}).push(Buffer.from('bad\n')), SyntaxError);
});
test('RPC pending limit does not silently drop a request', async () => {
  const rpc = new RpcClient(() => {}, { maxPending: 1 });
  const first = rpc.request('one'); await assert.rejects(rpc.request('two'), /limit/);
  rpc.receive({ id: 1, result: {} }); await first;
});
test('API-key environment is removed without mutating the parent environment', () => {
  const source = { OPENAI_API_KEY: 'fake-key', CODEX_API_KEY: 'fake-key', ANTHROPIC_API_KEY: 'fake-key', PATH: 'test' };
  const env = accountOnlyEnvironment(source);
  assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.PATH, 'test');
  assert.equal(source.OPENAI_API_KEY, 'fake-key');
});
test('Windows environment key casing cannot bypass API-key removal', () => {
  const env = accountOnlyEnvironment({ openai_api_key: 'fake', Codex_Api_Key: 'fake', Path: 'keep' });
  assert.deepEqual(env, { Path: 'keep' });
});
test('missing CLI rejects the request and cleanup does not hang', async () => {
  const transport = startStdio({ executable: 'vibe-voice-nonexistent-cli-8fd0d830' });
  await assert.rejects(transport.rpc.request('initialize'), error => error.code === 'ENOENT');
  await transport.close();
});
