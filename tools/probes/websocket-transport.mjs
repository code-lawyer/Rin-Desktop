import WebSocket from 'ws';
import { RpcClient } from './rpc-client.mjs';

export function connectWebSocket(endpoint, token, { timeoutMs = 3000 } = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1') throw new Error('Probe only accepts IPv4 loopback');
  if (!token) throw new Error('Authentication token required');
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: timeoutMs, maxPayload: 8 * 1024 * 1024 });
    const rpc = new RpcClient(message => {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
      socket.send(JSON.stringify(message));
    });
    socket.on('message', data => {
      try { rpc.receive(JSON.parse(data.toString('utf8'))); }
      catch (error) { rpc.fail(error); socket.terminate(); }
    });
    socket.on('error', error => { rpc.fail(error); reject(error); });
    socket.on('close', () => { const error = new Error('WebSocket closed'); rpc.fail(error); reject(error); });
    socket.once('open', () => resolve({
      rpc,
      async close() {
        rpc.fail(new Error('Probe finished'));
        if (socket.readyState === WebSocket.CLOSED) return;
        const done = new Promise(resolve => socket.once('close', resolve));
        const timer = setTimeout(() => socket.terminate(), 1000);
        socket.close(); await done; clearTimeout(timer);
      }
    }));
  });
}
