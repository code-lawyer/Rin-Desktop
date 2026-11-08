import WebSocket from 'ws';

// Restrict inspection to the explicit local app, with bounded requests.
export async function connectPage(page, port) {
  const url = new URL(page.webSocketDebuggerUrl);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || Number(url.port) !== port)
    throw new Error('Debug target is not the selected local app.');
  const socket = new WebSocket(url, { handshakeTimeout: 10000 });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.on('error', () => {});
  let id = 0;
  const pending = new Map(),
    events = new Map();
  socket.on('message', (bytes) => {
    const value = JSON.parse(bytes);
    if (value.method) for (const callback of events.get(value.method) || []) callback(value.params);
    const item = pending.get(value.id);
    if (item) {
      pending.delete(value.id);
      clearTimeout(item.timer);
      value.error ? item.reject(new Error(value.error.message)) : item.resolve(value.result);
    }
  });
  socket.on('close', () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('Application closed'));
    }
    pending.clear();
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id,
        timer = setTimeout(() => {
          pending.delete(key);
          reject(new Error('Application inspection timed out'));
        }, 15000);
      pending.set(key, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  return {
    send,
    on(method, callback) {
      if (!events.has(method)) events.set(method, new Set());
      events.get(method).add(callback);
      return () => events.get(method)?.delete(callback);
    },
    close: () => {
      events.clear();
      socket.close();
    },
    evaluate: async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    },
  };
}
