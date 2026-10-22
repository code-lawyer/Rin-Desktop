import { EventEmitter } from 'node:events';
import { mkdir, stat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isTaskBusy } from './task-state.mjs';
import { AgentLifecycle } from './agent-lifecycle.mjs';
import { currentReply } from './reply-state.mjs';
import { findAgent, versionOf, safeError, deadline } from './agent-process.mjs';
import catalog from './agent-catalog.cjs';
import { readJson, writeJson } from './durable-json.mjs';
import { pathKey } from './path-identity.mjs';
export { pathKey } from './path-identity.mjs';

export function historyTurns(messages) {
  const turns = [];
  for (const message of messages) {
    let turn = turns.at(-1);
    if (!turn || message.role === 'user' || message.turnId && message.turnId !== turn.id) { turn = { id: message.turnId || message.id, status: message.turnStatus ?? 'unknown', items: [] }; turns.push(turn); }
    turn.items.push(message.role === 'user' ? { id: message.id, type: 'userMessage', content: [{ type: 'text', text: message.text }] } : { id: message.id, type: 'agentMessage', text: message.text, phase: message.phase });
  }
  return turns;
}

// The UI contract is shared; native authentication, execution and transcripts
// remain owned by each CLI. This cache contains display data, never credentials.
export class NativeAgent extends EventEmitter {
  constructor({ provider, projectRoot, storageDir }) {
    super(); this.provider = provider; this.spec = catalog.AGENTS[provider];
    this.storageDir = join(resolve(storageDir), 'agents', provider); this.projectRoot = resolve(projectRoot);
    this.queue = Promise.resolve(); this.index = {}; this.known = new Map(); this.pending = new Map(); this.closed = false;
    this.lifecycle = new AgentLifecycle();
    this.state = { provider, agentName: this.spec.name, loginHelp: this.spec.help, connection: 'connecting', status: 'connecting', activity: `正在连接 ${this.spec.name}`, error: null, login: null, version: null,
      cwd: this.projectRoot, projectName: basename(this.projectRoot), threadId: null, turnId: null, threadName: '', model: null, models: [], effort: null, messages: [], approvals: [], restored: false,
      permissionHint: provider === 'opencode' ? '审批遵循 OpenCode 的项目、全局和 Agent 权限规则；配置为自动允许的操作不会弹窗。' : '工具权限请求由原生 Agent 发出，在此确认。',
      renameLocal: provider !== 'claude', canStartNew: false };
  }
  get busy() { return !!this.run || !!this.lifecycle.active || isTaskBusy(this.state); }
  snapshot() { return structuredClone(this.state); }
  changed(immediate = true) {
    if (this.closed) return;
    if (immediate) { clearTimeout(this.updateTimer); this.updateTimer = null; this.emit('state', this.snapshot()); }
    else if (!this.updateTimer) this.updateTimer = setTimeout(() => this.changed(), 65);
  }
  async load() {
    await mkdir(this.storageDir, { recursive: true });
    for (const name of ['index', 'session']) {
      let saved;
      try { saved = await readJson(join(this.storageDir, `${name}.json`)); if (saved === undefined) continue; }
      catch (error) { if (error.code === 'ENOENT') continue; throw new Error(`${this.spec.name} 会话记录无法读取，原文件已保留。`); }
      if (saved.format !== 1 || saved.provider !== this.provider) throw new Error('会话记录来源或格式不匹配，原文件已保留。');
      if (name === 'index') {
        this.index = saved.sessions ?? {};
        for (const item of Object.values(this.index)) {
          // Legacy display caches did not record turn outcomes. Retain their
          // text, but never infer successful completion from that absence.
          if (Array.isArray(item.messages)) item.messages = item.messages.map(message => ({ ...message, turnStatus: message.turnStatus ?? 'unknown' }));
          this.known.set(item.id, item);
        }
      }
      else {
        if (typeof saved.cwd !== 'string' || !saved.cwd) throw new Error('已保存的项目路径无效。');
        Object.assign(this.state, { cwd: resolve(saved.cwd), projectName: basename(saved.cwd), threadId: saved.threadId || null, model: saved.model || null, effort: saved.effort || null });
        const cached = this.index[this.state.threadId];
        this.state.threadName = cached?.name || ''; this.state.messages = cached?.messages ?? [];
        if (this.state.threadId) this.known.set(this.state.threadId, { ...cached, id: this.state.threadId, cwd: this.state.cwd });
      }
    }
  }
  async persist() {
    if (this.state.threadId) {
      const old = this.index[this.state.threadId];
      const entry = { ...old, id: this.state.threadId, cwd: this.state.cwd, name: old?.alias || this.state.threadName || '未命名对话', updatedAt: Date.now() / 1000, messages: structuredClone(this.state.messages.slice(-200)) };
      this.index[entry.id] = entry; this.known.set(entry.id, entry);
    }
    const session = { format: 1, provider: this.provider, cwd: this.state.cwd, threadId: this.state.threadId, model: this.state.model, effort: this.state.effort };
    const index = { format: 1, provider: this.provider, sessions: this.index };
    // Commit the display cache first. Session metadata must never refer to a
    // cache that failed to reach disk; the native CLI still owns the transcript.
    const writes = [['index', structuredClone(index)], ['session', session]];
    this.queue = this.queue.catch(() => {}).then(async () => {
      await mkdir(this.storageDir, { recursive: true });
      for (const [name, value] of writes) await writeJson(join(this.storageDir, `${name}.json`), value);
    });
    return this.queue;
  }
  report(error, { connection = false } = {}) {
    if (this.closed) return;
    const auth = error?.code === -32000 || /auth_required|authentication|unauthorized|oauth|not logged in|invalid.*api.?key|login required/i.test(String(error?.message));
    this.state.error = safeError(error);
    if (auth) { this.state.connection = 'authentication'; this.state.canStartNew = false; this.state.activity = '需要完成原生登录或配置 API 凭据'; }
    else if (connection) this.state.connection = 'error';
    this.state.status = 'error'; this.changed();
  }
  async connect() {
    if (this.closed) return;
    const operation = this.lifecycle.begin();
    try {
      if (this.closed) return;
      await this.load(); if (this.closed) return; this.changed();
      this.binary = findAgent(this.provider); this.state.version = await versionOf(this.binary); this.state.canStartNew = true;
      if (this.closed) return;
      if (!(await stat(this.state.cwd)).isDirectory()) throw new Error('项目目录不可访问，请恢复目录或选择其他项目。');
      if (this.closed) return;
      await this.openNative();
      if (this.closed) { await this.disposeNative(); return; }
      this.state.connection = 'ready'; this.state.status = 'idle'; this.state.error = null;
      this.state.activity = this.state.restored ? '已恢复，可以继续对话' : '准备就绪';
      await this.persist(); this.changed();
    } catch (error) { await this.disposeNative().catch(() => {}); this.report(error, { connection: true }); }
    finally { operation.release(); }
  }
  assertReady() { if (this.closed || this.state.connection !== 'ready') throw new Error(`${this.spec.name} 尚未连接，请先重新连接。`); }
  idle() { this.assertReady(); if (this.busy) throw new Error('请先完成或停止当前任务。'); }
  push(message) { this.state.messages.push(message); if (this.state.messages.length > 200) this.state.messages.splice(0, this.state.messages.length - 200); }
  appendText(text) {
    this.receivedSubmission();
    const last = this.state.messages.at(-1);
    if (last?.role === 'assistant' && !last.complete && last.turnId === this.state.turnId) last.text += String(text);
    else this.push({ id: randomUUID(), role: 'assistant', text: String(text), turnId: this.state.turnId, complete: false, turnStatus: 'inProgress' });
    if (!this.stopRequested && !this.pending.size) this.state.activity = '正在回复'; this.changed(false);
  }
  receivedSubmission() {
    const submission = this.submission;
    if (!submission || submission.received || this.closed) return;
    submission.received = true;
    this.emit('submission', { id: submission.id, status: 'confirmed', target: { cwd: this.state.cwd, threadId: this.state.threadId } });
  }
  async send(text, submission = {}) {
    this.idle();
    if (this.state.status === 'error') throw new Error('请先重连或开始新对话。');
    if (typeof text !== 'string' || !text.trim() || text.length > 64000) throw new Error('请输入 1 至 64000 个字符的任务。');
    const turnId = randomUUID(); this.stopRequested = false;
    const receipt = { ...submission, received: false, dispatched: false }; this.submission = receipt;
    Object.assign(this.state, { turnId, status: 'starting', error: null, activity: '正在发送' });
    this.push({ id: randomUUID(), role: 'user', text: text.trim(), turnId, complete: true });
    this.state.threadName ||= text.trim().slice(0, 48); this.changed();
    // Install the operation before any callbacks can arrive, and return to the
    // renderer immediately so approval and stop stay usable throughout a turn.
    const run = Promise.resolve().then(async () => {
      let status = 'completed';
      try {
        if (!this.stopRequested) {
          this.state.status = 'working'; this.state.activity = `${this.spec.name} 正在处理`; this.changed();
          if (submission.beforeDispatch) await submission.beforeDispatch({ cwd: this.state.cwd, threadId: this.state.threadId, userMessageId: this.provider === 'claude' ? this.state.messages.findLast(m => m.role === 'user')?.id : undefined });
          if (this.stopRequested || this.closed) { status = 'interrupted'; return; }
          receipt.dispatched = true;
          const result = await this.promptNative(text.trim());
          this.receivedSubmission();
          if (result?.cancelled || this.stopRequested) status = 'interrupted';
        } else status = 'interrupted';
      } catch (error) { status = this.stopRequested ? 'interrupted' : 'failed'; if (!this.stopRequested) this.report(error); }
      finally {
        if (!receipt.received) this.emit('submission', { id: receipt.id, status: receipt.dispatched ? 'unknown' : 'not-sent', target: { cwd: this.state.cwd, threadId: this.state.threadId } });
        if (this.submission === receipt) this.submission = null;
        this.cancelApprovals();
        for (const message of this.state.messages) if (message.turnId === turnId) { message.complete = true; message.turnStatus = status; }
        this.state.turnId = null;
        if (this.state.connection === 'ready') this.state.status = status === 'failed' ? 'error' : 'idle';
        this.state.activity = status === 'interrupted' ? '已停止，可以继续对话' : status === 'failed' ? '本次任务未完成' : '回复已完成';
        this.stopRequested = false;
        try { await this.persist(); } catch (error) { this.report(new Error(`会话显示记录未保存：${safeError(error)}`)); }
        if (this.run === run) this.run = null;
        this.changed();
        if (status === 'completed' && !this.closed) {
          const reply = currentReply(this.state.messages);
          if (reply.readable && reply.text && reply.turnId === turnId) this.emit('reply-completed', { threadId: this.state.threadId, turnId, text: reply.text });
        }
      }
    });
    this.run = run; return { accepted: true, pending: true };
  }
  async interrupt() {
    if (!this.run) return;
    if (this.stopping) return this.stopping;
    this.stopRequested = true; this.state.status = 'stopping'; this.state.activity = '正在停止'; this.cancelApprovals(); this.changed();
    this.stopping = (async () => {
      try { await deadline(Promise.all([this.cancelNative(), this.run]), 20000, '停止'); }
      catch (error) { await this.disposeNative().catch(() => {}); this.report(new Error(`停止未正常收尾，已关闭此 CLI 连接。请重连恢复会话。${safeError(error)}`), { connection: true }); }
      finally { this.stopping = null; }
    })();
    return this.stopping;
  }
  ask(view, convert, cancelled, signal) {
    if (this.closed || this.stopRequested || signal?.aborted) return Promise.resolve(cancelled);
    this.receivedSubmission();
    const id = randomUUID();
    return new Promise(resolveAnswer => {
      const finish = result => { signal?.removeEventListener('abort', abort); this.pending.delete(id); this.syncApprovals(); resolveAnswer(result); };
      const abort = () => finish(cancelled);
      this.pending.set(id, { view: { cwd: this.state.cwd, ...view, id }, convert, finish, cancel: abort });
      signal?.addEventListener('abort', abort, { once: true });
      this.syncApprovals(); this.emit('attention');
    });
  }
  syncApprovals() {
    this.state.approvals = [...this.pending.values()].map(p => p.view);
    if (!this.stopRequested && this.run) { this.state.status = this.pending.size ? 'waiting' : 'working'; this.state.activity = this.pending.size ? '等待你的确认或回答' : '继续处理中'; }
    this.changed();
  }
  cancelApprovals() { for (const p of [...this.pending.values()]) p.cancel(); }
  async respond(id, answer) {
    const pending = this.pending.get(String(id)); if (!pending) throw new Error('该请求已结束。');
    if (answer?.decision === 'cancel') return this.interrupt();
    pending.finish(pending.convert(answer));
  }
  async configure(action, { validate, allowDisconnected = false, disposeOnError = false } = {}) {
    if (!allowDisconnected) this.idle();
    else if (this.busy) throw new Error('请先停止当前任务。');
    const operation = this.lifecycle.begin(), previous = this.snapshot();
    let validated = !validate;
    this.state.status = 'configuring'; this.changed();
    try {
      if (validate) { await validate(); operation.check(); validated = true; }
      await action(operation); operation.check();
      this.state.error = null; await this.persist(); operation.check();
      this.state.status = 'idle';
    } catch (error) {
      if (this.closed || validated && disposeOnError) await this.disposeNative().catch(() => {});
      if (!this.closed) {
        if (!validated) this.state = previous;
        else this.report(error, { connection: true });
      }
      throw error;
    } finally { operation.release(); this.changed(); }
  }
  async newConversation(cwd = this.state.cwd) {
    return this.switchConversation(cwd);
  }
  switchConversation(cwd, item) {
    return this.configure(async operation => {
      await this.disposeNative(); operation.check();
      Object.assign(this.state, { cwd: resolve(cwd), projectName: basename(cwd), threadId: item?.id ?? null, turnId: null,
        threadName: item ? this.index[item.id]?.alias || item.name || '' : '', messages: item ? this.index[item.id]?.messages ?? [] : [],
        approvals: [], error: null, restored: false, effort: null, ...(item ? { model: null } : {}) });
      this.binary ||= findAgent(this.provider);
      await this.openNative(); operation.check();
      this.state.connection = 'ready'; this.state.activity = item ? '已恢复，可以继续对话' : '准备就绪';
    }, { allowDisconnected: !item, disposeOnError: true, validate: async () => {
      if (typeof cwd !== 'string' || !(await stat(cwd)).isDirectory()) throw new Error('请选择有效的项目目录。');
    } });
  }
  rememberList(data) {
    return data.map(item => { this.known.set(item.id, item); return { ...item, name: this.index[item.id]?.alias || item.name || '未命名对话' }; });
  }
  session(id) { if (typeof id !== 'string' || !id || id.length > 200 || !this.known.has(id)) throw new Error('请先在当前 Agent 的项目列表中选择会话。'); return this.known.get(id); }
  async resumeConversation(id, cwd) {
    this.idle(); const item = this.session(id);
    if (pathKey(item.cwd) !== pathKey(cwd)) throw new Error('会话目录与项目不一致。');
    return this.switchConversation(cwd, item);
  }
  async renameConversation(id, name) {
    this.assertReady(); const item = this.session(id);
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('请输入 1–100 字的名称。');
    await this.renameNative?.(id, name.trim(), item.cwd);
    this.index[id] = { ...item, ...this.index[id], alias: this.state.renameLocal ? name.trim() : undefined, name: name.trim() };
    if (this.state.threadId === id) this.state.threadName = name.trim();
    await this.persist(); this.changed();
  }
  async cancelLogin() {}
  close() {
    if (this.closing) return this.closing;
    this.closed = true; this.lifecycle.close(); this.stopRequested = true; clearTimeout(this.updateTimer); this.cancelApprovals();
    this.closing = (async () => {
      await deadline(Promise.resolve().then(() => this.cancelNative()), 3000, '停止').catch(() => {});
      await this.disposeNative().catch(() => {});
      if (this.run) await deadline(this.run, 3000, '结束任务').catch(() => {});
      await this.queue.catch(() => {});
    })();
    return this.closing;
  }
}
