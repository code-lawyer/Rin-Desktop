import { EventEmitter } from 'node:events';
export { JsonLineDecoder } from '../../prototypes/live2d-codex/backend/json-line-decoder.mjs';

export class RpcError extends Error {
  constructor(code, message) { super(message); this.name = 'RpcError'; this.code = code; }
}

// The client never persists raw responses, account details, or server stderr.
export class RpcClient extends EventEmitter {
  #send;
  #pending = new Map();
  #nextId = 1;
  #closed = false;
  #closeError;
  constructor(send, { timeoutMs = 15_000, maxPending = 32 } = {}) {
    super(); this.#send = send; this.timeoutMs = timeoutMs; this.maxPending = maxPending;
  }
  request(method, params = {}, { timeoutMs = this.timeoutMs } = {}) {
    if (this.#closed) return Promise.reject(this.#closeError ?? new Error('RPC closed'));
    if (this.#pending.size >= this.maxPending) return Promise.reject(new Error('RPC pending limit'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id); reject(new RpcError('TIMEOUT', `RPC timeout: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.#send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.#pending.delete(id); reject(error); }
    });
  }
  notify(method, params = {}) {
    if (this.#closed) throw this.#closeError ?? new Error('RPC closed');
    this.#send({ method, params });
  }
  receive(message) {
    if (this.#closed) return;
    if (Object.hasOwn(message, 'id') && Object.hasOwn(message, 'method')) {
      // Explicitly reject interactive requests until an approval owner is verified.
      this.#send({ id: message.id, error: { code: -32601, message: 'Probe cannot handle interactive requests' } });
      this.emit('serverRequest', message.method); return;
    }
    if (Object.hasOwn(message, 'id')) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.#pending.delete(message.id);
      if (message.error) pending.reject(new RpcError(message.error.code, message.error.message));
      else if (Object.hasOwn(message, 'result')) pending.resolve(message.result);
      else pending.reject(new RpcError('MALFORMED', 'RPC response without result or error'));
      return;
    }
    if (typeof message.method === 'string') this.emit('notification', message);
  }
  fail(error) {
    if (this.#closed) return;
    this.#closed = true; this.#closeError = error;
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear(); this.emit('closed', error);
  }
  get pendingCount() { return this.#pending.size; }
}

