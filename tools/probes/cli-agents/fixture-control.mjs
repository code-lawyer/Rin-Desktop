import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';

// Observe the result immediately, including rejection before any tool event.
// Waiting for a marker must not leave a turn promise temporarily unhandled.
export async function waitForProbeSignal(test, label, result, { timeout = 45000, interval = 100 } = {}) {
  let ended = false, failure;
  result?.then(() => { ended = true; }, error => { ended = true; failure = error; });
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (ended) throw failure ?? new Error(`Turn ended before ${label}`);
    if (await test()) return;
    await pause(interval);
  }
  throw new Error(`${label} not observed`);
}

// The fixture exits itself when its private control connection closes. Never
// taskkill a PID read from a model-writable file (or a potentially reused PID).
export async function createSleeperFixture() {
  const token = randomUUID();
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\rin-probe-${token}` : join(tmpdir(), `rin-probe-${token}.sock`);
  const sockets = new Set();
  let active, started = false, closing;
  const server = createServer(socket => {
    sockets.add(socket);
    let input = '';
    const timer = setTimeout(() => socket.destroy(), 2000);
    timer.unref();
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(timer); sockets.delete(socket); if (active === socket) active = undefined; });
    socket.on('data', bytes => {
      input += bytes.toString();
      if (input.length > 128) { socket.destroy(); return; }
      if (!input.includes('\n')) return;
      if (started || input !== `${token}\n`) { socket.destroy(); return; }
      clearTimeout(timer);
      started = true;
      active = socket;
    });
  });
  await new Promise((resolve, reject) => {
    const failed = error => { server.close(); reject(error); };
    server.once('error', failed);
    server.listen(endpoint, () => { server.removeListener('error', failed); resolve(); });
  });
  const script = `const net=require('node:net'),fs=require('node:fs');const socket=net.connect(${JSON.stringify(endpoint)},()=>socket.write(${JSON.stringify(token + '\n')}));socket.on('error',()=>process.exit(1));socket.on('close',()=>process.exit(0));setTimeout(()=>{fs.writeFileSync('slow-finished.txt','finished');process.exit(0)},60000);`;
  const command = `node -e "eval(Buffer.from('${Buffer.from(script).toString('base64')}','base64').toString())"`;
  return {
    command, script, endpoint,
    get started() { return started; },
    get running() { return !!active && !active.destroyed; },
    close() {
      if (!closing) closing = new Promise(resolve => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      });
      return closing;
    },
  };
}
