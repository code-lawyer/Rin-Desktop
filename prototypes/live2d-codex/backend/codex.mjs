import { EventEmitter } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join, resolve, delimiter, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AvatarRpc } from './rpc.mjs';
import { approvalView, approvalResult } from './approvals.mjs';
import { isTaskBusy } from './task-state.mjs';

const MAX_TEXT = 256_000;
const clip = text => String(text ?? '').slice(0, MAX_TEXT);
const inputText = input => (input ?? []).filter(x => x.type === 'text').map(x => x.text).join('\n');

export function findCodex(env = process.env) {
  if (env.VIBE_CODEX_BINARY) {
    if (!existsSync(env.VIBE_CODEX_BINARY) || !env.VIBE_CODEX_BINARY.toLowerCase().endsWith('.exe')) throw new Error('指定的 Codex 程序不存在。');
    return env.VIBE_CODEX_BINARY;
  }
  const directories = (env.PATH ?? env.Path ?? '').split(delimiter).map(dir => dir.replace(/^"|"$/g, '')).filter(Boolean);
  if (env.APPDATA) directories.push(join(env.APPDATA, 'npm'));
  const candidates = [];
  // npm installs a shell wrapper on Windows. Resolve its native binary without
  // invoking cmd.exe or accepting shell commands from PATH.
  for (const dir of directories) {
    candidates.push(join(dir, 'codex.exe'));
    for (const base of [join(dir, 'node_modules/@openai/codex'), join(dir, 'node_modules/@openai/codex-win32-x64'), join(dir, 'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64')]) {
      candidates.push(join(base, 'vendor/x86_64-pc-windows-msvc/codex/codex.exe'));
    }
  }
  if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
  const binary = candidates.find(existsSync);
  if (!binary) throw new Error('未找到 Codex CLI。请按 README 自行安装，在终端运行 codex login 后重启 Rin Desktop；自定义位置可设置 VIBE_CODEX_BINARY。');
  return binary;
}

export function cliEnvironment(env = process.env) {
  const clean = { ...env };
  const excluded = new Set(['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_ACCESS_TOKEN', 'ANTHROPIC_API_KEY', 'ELECTRON_RUN_AS_NODE']);
  for (const name of Object.keys(clean)) if (excluded.has(name.toUpperCase())) delete clean[name];
  return clean;
}

export class CodexCompanion extends EventEmitter {
  constructor({ projectRoot, storageDir, binary, spawnServer } = {}) {
    super(); this.projectRoot = resolve(projectRoot); this.storageDir = resolve(storageDir);
    this.metadataPath = join(this.storageDir, 'session.json'); this.binary = binary;
    this.spawnServer = spawnServer; this.rpc = null; this.requests = new Map(); this.completedTurns = new Set(); this.toolItems = new Map();
    this.persistQueue = Promise.resolve(); this.closed = false; this.pendingUser = null; this.loginRevision = 0;
    this.pendingSend = null; this.stopRequested = false; this.interrupting = null;
    this.state = { connection: 'connecting', status: 'connecting', activity: '正在读取 Codex 登录', error: null,
      login: null, version: null, cwd: this.projectRoot, projectName: basename(this.projectRoot), threadId: null, turnId: null,
      model: null, models: [], messages: [], approvals: [], restored: false, threadName: '', effort: null };
  }
  get busy() { return !!this.pendingSend || isTaskBusy(this.state); }
  snapshot() { return structuredClone(this.state); }
  changed(immediate = true) {
    if (immediate) { clearTimeout(this.updateTimer); this.updateTimer = null; this.emit('state', this.snapshot()); }
    else if (!this.updateTimer) this.updateTimer = setTimeout(() => this.changed(), 65);
  }
  async persist() {
    const metadata = { format: 1, cwd: this.state.cwd, threadId: this.state.threadId, model: this.state.model, ...(this.state.effort ? { effort: this.state.effort } : {}) };
    this.persistQueue = this.persistQueue.catch(() => {}).then(async () => {
      await mkdir(this.storageDir, { recursive: true });
      await writeFile(this.metadataPath + '.tmp', JSON.stringify(metadata, null, 2) + '\n');
      await rename(this.metadataPath + '.tmp', this.metadataPath);
    });
    return this.persistQueue;
  }
  async connect() {
    try {
      await mkdir(this.storageDir, { recursive: true });
      let saved, projectError;
      try {
        saved = JSON.parse(await readFile(this.metadataPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('无法读取上次会话信息，原文件已保留。请检查文件后重启。', { cause: error });
      }
      if (saved !== undefined) {
        if (saved?.format !== 1 || typeof saved.cwd !== 'string' || !saved.cwd.trim()) throw new Error('上次会话信息格式无效，原文件已保留。');
        this.state.cwd = resolve(saved.cwd); this.state.projectName = basename(saved.cwd);
        this.state.threadId = typeof saved.threadId === 'string' ? saved.threadId : null;
        this.state.model = typeof saved.model === 'string' ? saved.model : null;
        this.state.effort = typeof saved.effort === 'string' ? saved.effort : null;
        try {
          if (!(await stat(this.state.cwd)).isDirectory()) throw new Error('Not a directory');
        } catch {
          projectError = '上次项目目录无法访问，原会话已保留。请恢复目录后重启，或通过「项目」明确选择其他目录开始新对话。';
        }
      }
      this.binary ??= findCodex();
      this.state.version = execFileSync(this.binary, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const child = this.spawnServer ? this.spawnServer() : spawn(this.binary, ['app-server', '--listen', 'stdio://', '-c', 'forced_login_method="chatgpt"'],
        { cwd: projectError ? this.projectRoot : this.state.cwd, env: cliEnvironment(), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      this.rpc = new AvatarRpc(child);
      this.rpc.on('notification', message => this.onNotification(message));
      this.rpc.on('request', request => this.onRequest(request));
      this.rpc.on('closed', error => { if (!this.closed) { this.state.connection = 'error'; this.state.status = 'error'; this.state.error = error.message; this.requests.clear(); this.state.approvals = []; this.changed(); } });
      await this.rpc.request('initialize', { clientInfo: { name: 'vibe_voice_avatar', title: 'Rin Desktop', version: '0.3.0' }, capabilities: { experimentalApi: true } });
      this.rpc.notify('initialized');
      this.projectError = projectError;
      const account = await this.rpc.request('account/read', { refreshToken: false });
      if (account.account?.type !== 'chatgpt') {
        this.state.connection = 'authentication'; this.state.status = 'idle';
        this.state.activity = '请登录你的 ChatGPT 账户'; this.changed(); this.emit('attention'); return;
      }
      await this.finishConnection();
    } catch (error) { this.state.connection = 'error'; this.state.status = 'error'; this.state.error = error.message; this.changed(); }
  }
  async finishConnection() {
      const projectError = this.projectError;
      this.state.login = 'chatgpt'; // Account identifiers and credentials never cross into the renderer.
      this.state.loginPending = false; this.state.error = null;
      const result = await this.rpc.request('model/list', { includeHidden: false });
      this.state.models = (result.data ?? []).map(m => ({ id: m.id, model: m.model, name: m.displayName ?? m.model, isDefault: !!m.isDefault, efforts: m.supportedReasoningEfforts ?? [], defaultEffort: m.defaultReasoningEffort }));
      if (!this.state.models.some(m => m.model === this.state.model)) this.state.model = (this.state.models.find(m => m.isDefault) ?? this.state.models[0])?.model ?? null;
      if (projectError) {
        // Keep the original metadata intact while allowing an explicit project selection.
        this.state.connection = 'ready'; this.state.status = 'error'; this.state.error = projectError;
        this.state.activity = '需要恢复项目目录'; this.changed(); return;
      }
      if (this.state.threadId) {
        this.state.activity = '正在恢复上次对话'; this.changed();
        try {
          const restored = await this.rpc.request('thread/resume', { threadId: this.state.threadId, ...this.threadOptions() });
          this.loadThread(restored.thread); this.state.restored = true;
        } catch (error) {
          // Keep the saved ID available for manual recovery; do not silently create another thread.
          this.state.connection = 'ready'; this.state.status = 'error';
          this.state.error = `上次对话未能恢复：${error.message}。可重启重试，或点击「新对话」。`; this.changed(); return;
        }
      }
      this.state.connection = 'ready';
      if (!this.state.restored) this.state.status = 'idle';
      this.state.activity = this.state.turnId ? '原对话仍在执行' : this.state.restored ? '已恢复上次对话' : '准备就绪';
      await this.persist(); this.changed();
  }
  async startLogin() {
    if (this.state.connection !== 'authentication' || this.state.loginPending || !this.rpc || this.closed) throw new Error('当前不能发起登录。');
    const revision = ++this.loginRevision;
    this.state.loginPending = true; this.state.error = null; this.changed();
    try {
      const result = await this.rpc.request('account/login/start', { type: 'chatgpt' });
      if (this.closed || revision !== this.loginRevision) {
        if (result.loginId) await this.rpc.request('account/login/cancel', { loginId:result.loginId }).catch(() => {});
        throw new Error('这次登录已取消。');
      }
      this.loginId = result.loginId;
      const url = new URL(result.authUrl);
      if (result.type !== 'chatgpt' || !this.loginId || url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.username || url.password) throw new Error('Codex 返回了无效的官方登录地址。');
      return url.href;
    } catch (error) { if (revision === this.loginRevision) await this.cancelLogin().catch(() => {}); throw error; }
  }
  async cancelLogin() {
    this.loginRevision++;
    const loginId = this.loginId; this.loginId = null;
    this.state.loginPending = false; this.changed();
    if (loginId) await this.rpc.request('account/login/cancel', { loginId });
  }
  async completeLogin(result) {
    if (!this.loginId || result.loginId !== this.loginId || this.closed) return;
    const revision = this.loginRevision;
    this.loginId = null; this.state.loginPending = false;
    try {
      if (!result.success) throw new Error(result.error || '登录未完成，请重试。');
      const account = await this.rpc.request('account/read', { refreshToken: false });
      if (this.closed || revision !== this.loginRevision) return;
      if (account.account?.type !== 'chatgpt') throw new Error('尚未检测到 ChatGPT 登录。');
      this.state.connection = 'connecting'; this.changed(); await this.finishConnection();
    } catch (error) {
      if (this.closed || revision !== this.loginRevision) return;
      this.state.connection = 'authentication'; this.state.error = error.message; this.changed();
    }
  }
  threadOptions() {
    return { cwd: this.state.cwd, model: this.state.model, sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' };
  }
  loadThread(thread) {
    if (!thread?.id) throw new Error('Codex 没有返回会话编号。');
    this.state.threadId = thread.id; this.state.threadName = thread.name || thread.preview?.slice(0, 50) || '未命名对话'; this.state.messages = [];
    for (const turn of thread.turns ?? []) {
      for (const item of turn.items ?? []) this.receiveItem(item, turn.id, true);
      for (const message of this.state.messages) if (message.turnId === turn.id) message.turnStatus = turn.status ?? 'unknown';
    }
    this.state.turnId = thread.turns?.findLast(t => t.status === 'inProgress' && !this.completedTurns.has(t.id))?.id ?? null;
    this.state.status = this.state.turnId ? 'working' : 'idle';
  }
  receiveItem(item, turnId, completed = false) {
    if (!item) return;
    if (item.type === 'userMessage') {
      const text = inputText(item.content);
      const draft = this.state.messages.find(m => m.id === this.pendingUser);
      if (draft && draft.text === text) { draft.id = item.id; draft.turnId = turnId; this.pendingUser = null; }
      else if (!this.state.messages.some(m => m.id === item.id)) this.upsertMessage({ id: item.id, role: 'user', text: clip(text), turnId, complete: true });
    } else if (item.type === 'agentMessage') {
      const existing = this.state.messages.find(m => m.id === item.id);
      this.upsertMessage({ id: item.id, role: 'assistant', text: String(item.text ?? existing?.text ?? ''), turnId, complete: completed, phase: item.phase ?? null, turnStatus: existing?.turnStatus ?? 'inProgress' });
    } else if (item.type === 'commandExecution') this.state.activity = completed ? '继续处理中' : '正在运行项目命令';
    else if (item.type === 'fileChange') {
      this.toolItems.set(item.id, item); if (this.toolItems.size > 40) this.toolItems.delete(this.toolItems.keys().next().value);
      this.state.activity = completed ? '文件修改已完成' : '正在修改项目文件';
    }
    else if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') this.state.activity = completed ? '继续处理中' : '正在调用工具';
  }
  upsertMessage(message) {
    const existing = this.state.messages.find(m => m.id === message.id);
    if (existing) Object.assign(existing, message); else this.state.messages.push(message);
    // Keep the local view bounded. The canonical full conversation remains in Codex.
    if (this.state.messages.length > 200) this.state.messages.splice(0, this.state.messages.length - 200);
  }
  onNotification({ method, params: p = {} }) {
    if (method === 'account/login/completed') { this.completeLogin(p); return; }
    if (p.threadId && p.threadId !== this.state.threadId) return;
    if (p.turnId && this.state.turnId && p.turnId !== this.state.turnId) return;
    if (method === 'turn/started') {
      if (this.completedTurns.has(p.turn.id)) return;
      this.state.turnId = p.turn.id; this.state.status = 'working'; this.state.activity = 'Codex 正在思考';
      if (this.stopRequested) this.interruptTurn().catch(() => {});
    } else if (method === 'turn/completed') {
      if (this.completedTurns.has(p.turn.id) || (this.state.turnId && p.turn.id !== this.state.turnId)) return;
      this.completedTurns.add(p.turn.id); if (this.completedTurns.size > 100) this.completedTurns.delete(this.completedTurns.values().next().value);
      for (const message of this.state.messages) if (message.turnId === p.turn.id) { message.complete = true; message.turnStatus = p.turn.status ?? 'unknown'; }
      this.state.turnId = null; this.state.status = 'idle'; this.pendingUser = null;
      this.stopRequested = false;
      this.requests.clear(); this.state.approvals = [];
      this.state.activity = p.turn.status === 'interrupted' ? '已停止，可以继续对话' : p.turn.status === 'failed' ? '本次任务未完成' : '回复已完成';
      if (p.turn.error) this.state.error = clip(p.turn.error.message);
      if (p.turn.status === 'completed') {
        const replies = this.state.messages.filter(m => m.turnId === p.turn.id && m.role === 'assistant');
        const final = replies.findLast(m => m.phase === 'final_answer') ?? replies.findLast(m => !m.phase);
        if (final?.text) this.emit('reply-completed', { threadId: this.state.threadId, turnId: p.turn.id, text: final.text });
      }
    } else if (method === 'item/started' || method === 'item/completed') this.receiveItem(p.item, p.turnId, method === 'item/completed');
    else if (method === 'item/agentMessage/delta') {
      let message = this.state.messages.find(m => m.id === p.itemId);
      if (!message) { this.upsertMessage({ id: p.itemId, role: 'assistant', text: '', turnId: p.turnId, complete: false, turnStatus: 'inProgress' }); message = this.state.messages.at(-1); }
      message.text += String(p.delta ?? ''); this.state.activity = '正在回复'; this.changed(false); return;
    } else if (method === 'error') {
      if (!p.willRetry) this.state.error = clip(p.error?.message ?? 'Codex 返回了错误。');
      this.state.activity = p.willRetry ? '连接短暂中断，Codex 正在重试' : this.state.activity;
    } else if (method === 'serverRequest/resolved') {
      this.requests.delete(String(p.requestId)); this.state.approvals = [...this.requests.values()].map(request => this.requestView(request)).filter(Boolean);
      if (!this.state.approvals.length && this.busy && !this.stopRequested) this.state.status = 'working';
    } else return;
    this.changed();
  }
  onRequest(request) {
    if (request.params?.threadId && request.params.threadId !== this.state.threadId) { this.rpc.reject(request.id, 'Request does not belong to the avatar thread.'); return; }
    if (request.params?.turnId && (this.completedTurns.has(request.params.turnId) || (this.state.turnId && request.params.turnId !== this.state.turnId))) {
      this.rpc.reject(request.id, 'Request does not belong to the active turn.'); return;
    }
    if (this.stopRequested) { this.cancelRequest(request); return; }
    const view = this.requestView(request);
    if (!view) {
      this.rpc.reject(request.id);
      this.state.error = `Codex 请求了原型暂不支持的交互（${request.method}），已拒绝该请求。`; this.changed(); return;
    }
    this.requests.set(view.id, request); this.state.approvals = [...this.requests.values()].map(request => this.requestView(request));
    this.state.status = 'waiting'; this.state.activity = view.kind === 'questions' ? '等待你的回答' : '等待你的确认'; this.changed();
    this.emit('attention');
  }
  requestView(request) {
    const view = approvalView(request); if (!view) return null;
    if (view.kind === 'files') {
      const item = this.toolItems.get(request.params?.itemId);
      const changes = (item?.changes ?? []).map(change => `${change.path}\n${typeof change.kind === 'string' ? change.kind : change.kind?.type ?? ''}\n${change.diff ?? ''}`).join('\n\n');
      const scope = request.params?.grantRoot ? `Codex 申请在本会话内写入此目录：${request.params.grantRoot}` : '确认这次文件修改';
      view.details = clip(scope + (changes ? '\n\n' + changes : ''));
    }
    return view;
  }
  assertReady() { if (this.state.connection !== 'ready' || !this.rpc || this.rpc.closed) throw new Error('Codex 尚未连接。'); }
  async send(text) {
    this.assertReady(); if (this.busy) throw new Error('请等待当前回复，或先停止当前任务。');
    if (this.state.status === 'error') throw new Error('请先恢复连接或开始新对话。');
    if (typeof text !== 'string' || !text.trim() || text.length > 64_000) throw new Error('请输入 1 至 64000 个字符的任务。');
    const operation = { cancelled: false }; this.pendingSend = operation; this.stopRequested = false; this.interrupting = null;
    this.state.status = 'starting'; this.state.activity = '正在发送'; this.state.error = null; this.changed();
    try {
      if (!this.state.threadId) {
        const result = await this.rpc.request('thread/start', { ...this.threadOptions(), ephemeral: false });
        this.state.threadId = result.thread.id; await this.persist();
      }
      if (operation.cancelled || this.closed) {
        this.state.status = 'idle'; this.state.activity = '已取消发送，可以继续对话'; this.stopRequested = false;
        this.changed(); return { accepted: false, cancelled: true };
      }
      const id = `local-${randomUUID()}`; this.pendingUser = id;
      this.upsertMessage({ id, role: 'user', text: text.trim(), complete: true, turnId: null }); this.changed();
      if (!this.state.threadName) this.state.threadName = text.trim().slice(0, 48);
      const result = await this.rpc.request('turn/start', { threadId: this.state.threadId, model: this.state.model, ...(this.state.effort ? { effort: this.state.effort } : {}), input: [{ type: 'text', text: text.trim() }] }, 60_000);
      const draft = this.state.messages.find(m => m.id === id); if (draft) draft.turnId = result.turn.id;
      // Completion notifications may arrive before the start acknowledgment.
      if (!this.completedTurns.has(result.turn.id)) {
        this.state.turnId = result.turn.id;
        if (this.state.status === 'starting') this.state.status = 'working';
        if (operation.cancelled || this.stopRequested) await this.interruptTurn();
      }
      this.changed(); return { accepted: true };
    } catch (error) {
      this.state.error = error.code === 'TIMEOUT' ? `${error.message} 发送结果尚未确定；请先停止或重启恢复会话，不要重复发送。` : error.message;
      if (error.code !== 'TIMEOUT' && !this.state.turnId) this.state.status = 'idle';
      this.changed(); throw error;
    } finally { if (this.pendingSend === operation) this.pendingSend = null; }
  }
  cancelRequest(request) {
    const view = approvalView(request);
    if (view?.kind === 'command' || view?.kind === 'files') this.rpc.reply(request.id, { decision: 'cancel' });
    else if (view?.kind === 'permissions') this.rpc.reply(request.id, { permissions: {}, scope: 'turn' });
    else this.rpc.reject(request.id, 'User interrupted the turn.');
  }
  interruptTurn() {
    const turnId = this.state.turnId;
    if (!turnId || this.completedTurns.has(turnId)) return Promise.resolve();
    if (this.interrupting?.turnId === turnId) return this.interrupting.promise;
    this.state.status = 'stopping'; this.state.activity = '正在停止'; this.changed();
    const interruption = { turnId }; this.interrupting = interruption;
    interruption.promise = this.rpc.request('turn/interrupt', { threadId: this.state.threadId, turnId }).catch(error => {
      if (this.interrupting === interruption) this.interrupting = null;
      if (!this.closed && this.state.turnId === turnId) {
        this.state.status = 'working'; this.state.error = `停止未能确认：${error.message}。请重试停止。`; this.changed();
      }
      throw error;
    });
    return interruption.promise;
  }
  async interrupt() {
    this.assertReady();
    this.stopRequested = true;
    if (this.pendingSend) this.pendingSend.cancelled = true;
    for (const request of this.requests.values()) this.cancelRequest(request);
    this.requests.clear(); this.state.approvals = [];
    if (!this.state.turnId) {
      // Wait for the outstanding start to settle; it either skips submission or
      // interrupts the returned turn. Never read a null or not-yet-started thread.
      if (this.pendingSend) { this.state.status = 'stopping'; this.state.activity = '正在取消发送'; this.changed(); return; }
      if (this.busy && this.state.threadId) { const read = await this.rpc.request('thread/read', { threadId: this.state.threadId, includeTurns: true }); this.state.turnId = read.thread.turns?.findLast(t => t.status === 'inProgress')?.id ?? null; }
      if (!this.state.turnId) { this.state.status = 'idle'; this.state.activity = '可以继续对话'; this.changed(); return; }
    }
    await this.interruptTurn();
  }
  async respond(id, answer) {
    const request = this.requests.get(String(id)); if (!request) throw new Error('该请求已结束。');
    this.rpc.reply(request.id, approvalResult(request, answer)); this.requests.delete(String(id));
    this.state.approvals = [...this.requests.values()].map(request => this.requestView(request)); this.state.status = this.requests.size ? 'waiting' : 'working';
    this.state.activity = this.requests.size ? '等待你的确认' : '继续处理中'; this.changed();
  }
  async newConversation(cwd = this.state.cwd) {
    this.assertReady(); if (this.busy) throw new Error('请先停止当前任务。');
    const previousState = this.snapshot();
    this.state.status = 'configuring'; this.state.activity = '正在切换对话'; this.changed();
    try {
    if (!(await stat(cwd)).isDirectory()) throw new Error('请选择有效的项目目录。');
    const previous = this.state.threadId;
    this.state.cwd = resolve(cwd); this.state.projectName = basename(cwd); this.state.threadId = null; this.state.turnId = null;
    this.state.threadName = '';
    this.state.messages = []; this.state.error = null; this.state.restored = false;
    this.pendingUser = null; this.stopRequested = false; this.interrupting = null;
    this.requests.clear(); this.toolItems.clear(); this.state.approvals = []; await this.persist();
    this.state.status = 'idle'; this.state.activity = '准备就绪'; this.changed();
    if (previous) this.rpc.request('thread/unsubscribe', { threadId: previous }).catch(() => {});
    } catch (error) { this.state = previousState; this.state.error = error.message; this.changed(); throw error; }
  }
  async chooseModel(model) {
    this.assertReady(); if (this.busy) throw new Error('请等待当前任务结束。');
    if (this.state.status === 'error') throw new Error('请先恢复项目或开始新对话。');
    if (!this.state.models.some(m => m.model === model)) throw new Error('请选择可用的 Codex 模型。');
    const previous = this.state.model, previousEffort = this.state.effort;
    this.state.status = 'configuring'; this.state.activity = '正在切换模型'; this.changed();
    try {
      if (this.state.threadId) await this.rpc.request('thread/resume', { threadId: this.state.threadId, ...this.threadOptions(), model });
      this.state.model = model;
      if (this.state.effort && !this.state.models.find(m => m.model === model)?.efforts?.some(e => e.reasoningEffort === this.state.effort)) this.state.effort = null;
      await this.persist();
    } catch (error) { this.state.model = previous; this.state.effort = previousEffort; this.state.error = error.message; throw error; }
    finally { this.state.status = 'idle'; this.state.activity = '准备就绪'; this.changed(); }
  }
  async chooseEffort(effort) {
    this.assertReady(); if (this.busy) throw new Error('请等待当前任务结束。');
    const model = this.state.models.find(m => m.model === this.state.model);
    if (effort && !model?.efforts?.some(v => v.reasoningEffort === effort)) throw new Error('当前模型不支持这个推理强度。');
    this.state.effort = effort || null; await this.persist(); this.changed();
  }
  async listThreads(cwd, cursor = null, search = '') {
    this.assertReady();
    if (typeof cwd !== 'string' || (cursor !== null && typeof cursor !== 'string')) throw new Error('对话列表参数无效。');
    const result = await this.rpc.request('thread/list', { cwd: resolve(cwd), limit: 50, cursor, sortKey: 'updated_at', sourceKinds: ['cli', 'vscode', 'appServer', 'exec', 'unknown'], ...(search ? { searchTerm: String(search).slice(0, 100) } : {}) });
    return { data: (result.data ?? []).map(t => ({ id: t.id, name: t.name || t.preview?.slice(0, 80) || '未命名对话', cwd: t.cwd, updatedAt: t.updatedAt, status: t.status?.type, source: t.source })), nextCursor: result.nextCursor ?? null };
  }
  async history(threadId, cursor = null) {
    this.assertReady(); if (typeof threadId !== 'string' || threadId.length > 200) throw new Error('对话编号无效。');
    try {
      const result = await this.rpc.request('thread/turns/list', { threadId, cursor, limit: 20, sortDirection: 'desc', itemsView: 'full' });
      return { turns: (result.data ?? []).slice().reverse(), nextCursor: result.nextCursor ?? null };
    } catch (error) {
      if (cursor || !/unsupported|not supported|unknown method|paginated|pagination|legacy/i.test(error.message)) throw error;
      const result = await this.rpc.request('thread/read', { threadId, includeTurns: true });
      return { turns: result.thread?.turns ?? [], nextCursor: null };
    }
  }
  async resumeConversation(threadId, expectedCwd) {
    this.assertReady(); if (this.busy) throw new Error('当前任务仍在执行，可以先查看历史；结束或停止后再继续另一对话。');
    if (typeof threadId !== 'string' || !threadId || threadId.length > 200) throw new Error('对话编号无效。');
    const previous = this.snapshot(); this.state.status = 'configuring'; this.state.activity = '正在恢复对话'; this.changed();
    try {
      const metadata = await this.rpc.request('thread/read', { threadId, includeTurns: false });
      if (metadata.thread.status?.type === 'active' && threadId !== previous.threadId) throw new Error('该对话正在另一个客户端执行，请等待结束后再继续。');
      const cwd = resolve(metadata.thread.cwd);
      if (cwd.toLowerCase() !== resolve(expectedCwd).toLowerCase()) throw new Error('对话目录与选中的项目不一致，未切换。');
      if (!(await stat(cwd)).isDirectory()) throw new Error('该项目目录不可访问。');
      const restored = await this.rpc.request('thread/resume', { threadId, cwd, sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' });
      if (!restored.thread.turns?.length) {
        try { restored.thread.turns = (await this.history(threadId)).turns; } catch { /* A new or temporarily unreadable history may still resume. */ }
      }
      this.loadThread(restored.thread);
      this.state.cwd = cwd; this.state.projectName = basename(cwd); this.state.model = restored.model ?? restored.thread.model ?? previous.model;
      this.state.effort = restored.reasoningEffort ?? restored.thread.reasoningEffort ?? null;
      this.state.activity = this.state.turnId ? '原对话仍在执行' : '已恢复，可以继续对话';
      this.state.error = null; this.state.restored = true; this.pendingUser = null; this.stopRequested = false; this.interrupting = null;
      this.requests.clear(); this.toolItems.clear(); this.state.approvals = [];
      await this.persist(); this.changed();
      if (previous.threadId && previous.threadId !== threadId) this.rpc.request('thread/unsubscribe', { threadId: previous.threadId }).catch(() => {});
    } catch (error) { this.state = previous; this.changed(); throw error; }
  }
  async renameConversation(threadId, name) {
    this.assertReady(); if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('请输入 1–100 字的对话名称。');
    await this.rpc.request('thread/name/set', { threadId, name: name.trim() });
    if (threadId === this.state.threadId) { this.state.threadName = name.trim(); this.changed(); }
  }
  async close() {
    this.closed = true; clearTimeout(this.updateTimer);
    this.stopRequested = true; if (this.pendingSend) this.pendingSend.cancelled = true;
    try { if (this.state.turnId && !this.rpc?.closed) await this.rpc.request('turn/interrupt', { threadId: this.state.threadId, turnId: this.state.turnId }, 3000); } catch {}
    await this.rpc?.close(); await this.persistQueue.catch(() => {});
  }
}
