import { EventEmitter } from 'node:events';
import { JsonLineDecoder } from './json-line-decoder.mjs';

// The avatar owns its app-server connection, including server-initiated requests.
export class AvatarRpc extends EventEmitter {
  constructor(child) {
    super(); this.child = child; this.pending = new Map(); this.nextId = 1; this.closed = false; this.exited = false;
    const decoder = new JsonLineDecoder(message => this.receive(message));
    child.stdout.on('data', chunk => { try { decoder.push(chunk); } catch { this.fail(new Error('Codex 返回了无法读取的消息。')); child.kill(); } });
    child.stderr.on('data', () => {}); // Never record tokens, account data, or raw diagnostic output.
    child.stdin.on('error', () => this.fail(new Error('Codex 连接已断开。')));
    child.on('error', () => this.fail(new Error('无法启动 Codex CLI。请检查安装路径。')));
    child.on('exit', code => { this.exited = true; this.fail(new Error(`Codex 连接已结束（${code ?? '已退出'}）。请重启桌面伙伴。`)); });
  }
  write(message) {
    if (this.closed || !this.child.stdin.writable) throw new Error('Codex 连接已断开。');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}, timeoutMs = 30_000) {
    if (this.closed) return Promise.reject(new Error('Codex 连接已断开。'));
    if (this.pending.size > 32) return Promise.reject(new Error('等待中的请求过多。'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Codex 请求超时（${method}）。`); error.code = 'TIMEOUT'; reject(error);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method, params = {}) { this.write({ method, params }); }
  reply(id, result) { this.write({ id, result }); }
  reject(id, message = '此原型尚不支持这类交互请求。') { this.write({ id, error: { code: -32601, message } }); }
  receive(message) {
    if (this.closed) return;
    if (Object.hasOwn(message, 'id') && typeof message.method === 'string') { this.emit('request', message); return; }
    if (Object.hasOwn(message, 'id')) {
      const pending = this.pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) { const error = new Error(message.error.message); error.code = message.error.code; pending.reject(error); }
      else pending.resolve(message.result);
    } else if (message.method) this.emit('notification', message);
  }
  fail(error) {
    if (this.closed) return; this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
  async close() {
    if (this.closing) return this.closing;
    this.fail(new Error('桌面伙伴已关闭。'));
    if (this.exited || !this.child.pid || this.child.exitCode != null || this.child.signalCode != null) { this.child.stdin.end(); return; }
    this.closing = new Promise(resolve => {
      let killTimer, deadline;
      const finish = () => {
        clearTimeout(killTimer); clearTimeout(deadline); this.child.off('exit', finish); resolve();
      };
      this.child.once('exit', finish);
      killTimer = setTimeout(() => { try { this.child.kill('SIGKILL'); } catch {} }, 2000);
      // A failed kill or missing exit event must not trap the Electron quit path.
      deadline = setTimeout(finish, 2500);
      this.child.stdin.end();
    });
    return this.closing;
  }
}
