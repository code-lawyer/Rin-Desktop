// Observe before sending: a completion can arrive before turn/start responds.
// Only bounded status metadata is retained, never prompt/response bodies.
export class TurnObserver {
  #records = new Map();
  #waiters = new Map();
  #activity = new Set();
  #activityWaiters = new Map();
  constructor(rpc, threadId, { maxTurns = 32 } = {}) {
    this.rpc = rpc; this.threadId = threadId; this.maxTurns = maxTurns;
    this.onNotification = ({ method, params }) => {
      if (params?.threadId !== threadId) return;
      if (method === 'item/agentMessage/delta' || method === 'item/reasoning/textDelta') {
        if (!params.turnId) return;
        if (!this.#activity.has(params.turnId) && this.#activity.size >= maxTurns) {
          this.close(new Error('Turn activity limit')); return;
        }
        this.#activity.add(params.turnId); this.#activityWaiters.get(params.turnId)?.resolve();
        return;
      }
      if (method !== 'turn/completed') return;
      const turn = params.turn;
      if (!turn?.id) return;
      if (!this.#records.has(turn.id) && this.#records.size >= maxTurns) {
        this.close(new Error('Turn observation limit')); return;
      }
      const record = { id: turn.id, status: turn.status, errorCode: turn.error?.codexErrorInfo ?? null };
      this.#records.set(turn.id, record);
      this.#waiters.get(turn.id)?.resolve(record);
      this.#activityWaiters.get(turn.id)?.reject(new Error('Turn completed before observed output'));
    };
    this.onClosed = error => this.close(error);
    rpc.on('notification', this.onNotification); rpc.on('closed', this.onClosed);
  }
  waitCompleted(turnId, { timeoutMs = 60_000 } = {}) {
    if (this.closed) return Promise.reject(this.closed);
    if (this.#records.has(turnId)) return Promise.resolve(this.#records.get(turnId));
    if (this.#waiters.has(turnId)) return Promise.reject(new Error('Duplicate turn waiter'));
    if (this.#waiters.size >= this.maxTurns) return Promise.reject(new Error('Turn waiter limit'));
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => { clearTimeout(timer); this.#waiters.delete(turnId); callback(value); };
      const timer = setTimeout(() => finish(reject, new Error('Turn completion timeout')), timeoutMs);
      this.#waiters.set(turnId, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
    });
  }
  waitActivity(turnId, { timeoutMs = 60_000 } = {}) {
    if (this.closed) return Promise.reject(this.closed);
    if (this.#activity.has(turnId)) return Promise.resolve();
    if (this.#records.has(turnId)) return Promise.reject(new Error('Turn already completed'));
    if (this.#activityWaiters.has(turnId)) return Promise.reject(new Error('Duplicate activity waiter'));
    if (this.#activityWaiters.size >= this.maxTurns) return Promise.reject(new Error('Turn activity waiter limit'));
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => { clearTimeout(timer); this.#activityWaiters.delete(turnId); callback(value); };
      const timer = setTimeout(() => finish(reject, new Error('Turn activity timeout')), timeoutMs);
      this.#activityWaiters.set(turnId, { resolve: () => finish(resolve), reject: error => finish(reject, error) });
    });
  }
  close(error = new Error('Turn observer closed')) {
    if (this.closed) return;
    this.closed = error;
    this.rpc.off('notification', this.onNotification); this.rpc.off('closed', this.onClosed);
    for (const waiter of [...this.#waiters.values()]) waiter.reject(error);
    for (const waiter of [...this.#activityWaiters.values()]) waiter.reject(error);
    this.#records.clear(); this.#activity.clear();
  }
}
