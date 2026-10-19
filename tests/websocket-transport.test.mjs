import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { connectWebSocket } from '../tools/probes/websocket-transport.mjs';

test('authenticated local transport correlates RPC and cleans up on close', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: ({ req }, done) => done(req.headers.authorization === 'Bearer fake-test-token', 401) });
  await once(server, 'listening');
  server.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    socket.send(JSON.stringify({ id: message.id, result: { text: '中文测试' } }));
  }));
  const endpoint = `ws://127.0.0.1:${server.address().port}`;
  let connection;
  try {
    await assert.rejects(connectWebSocket(endpoint, 'bad-token'), /401/);
    connection = await connectWebSocket(endpoint, 'fake-test-token');
    assert.deepEqual(await connection.rpc.request('test'), { text: '中文测试' });
    await connection.close(); await assert.rejects(connection.rpc.request('after-close'), /finished/);
  } finally { await connection?.close(); await new Promise(resolve => server.close(resolve)); }
});
test('probe refuses public endpoints or missing authentication before connecting', () => {
  assert.throws(() => connectWebSocket('ws://example.com:80', 'fake'), /loopback/);
  assert.throws(() => connectWebSocket('ws://127.0.0.1:80', ''), /token/);
});
