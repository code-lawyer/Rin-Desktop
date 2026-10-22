// One configuration/connection operation owns an Agent at a time. Closing
// invalidates its lease before any pending filesystem or protocol await returns.
export class AgentLifecycle {
  active = null;
  closed = false;
  assertOpen() { if (this.closed) throw new Error('Agent 已关闭。'); }
  begin() {
    this.assertOpen();
    if (this.active) throw new Error('请等待当前切换完成。');
    const token = Symbol('agent-operation'); this.active = token;
    return {
      check: () => { this.assertOpen(); if (this.active !== token) throw new Error('该操作已结束。'); },
      release: () => { if (this.active === token) this.active = null; },
    };
  }
  close() { this.closed = true; this.active = null; }
}
