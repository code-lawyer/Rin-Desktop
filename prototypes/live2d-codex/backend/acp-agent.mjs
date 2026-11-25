import { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { NativeAgent, historyTurns, pathKey } from './native-agent.mjs';
import { acpAgentEnvironment, spawnAgent, closeChild, deadline } from './agent-process.mjs';
import { questionsView, questionAnswers, formView, formAnswer } from './agent-questions.mjs';
import { restoreHistory } from './reply-state.mjs';
import packageInfo from '../package.json' with { type: 'json' };

const flatten = options => (options ?? []).flatMap(o => o.options ? flatten(o.options) : [o]);
const timestamp = value => typeof value === 'number' ? (value > 1e12 ? value / 1000 : value) : Date.parse(value) / 1000 || 0;
const nonEmptyText = value => typeof value === 'string' && value.trim();
function mergeToolDetails(previous, update) {
  const tool = { ...previous };
  for (const field of ['title', 'kind', 'rawInput', 'locations', 'content']) {
    if (update?.[field] != null) tool[field] = update[field];
  }
  return tool;
}
function markToolPreamble(message) {
  if (message?.role === 'assistant') Object.assign(message, { complete: true, phase: 'commentary' });
}
function replayMessage(messages, update) {
  const previous = messages.at(-1);
  if (update.sessionUpdate === 'tool_call') { markToolPreamble(previous); return; }
  if (!['user_message_chunk', 'agent_message_chunk'].includes(update.sessionUpdate) || update.content?.type !== 'text') return;
  const role = update.sessionUpdate === 'user_message_chunk' ? 'user' : 'assistant';
  if (previous?.role === role && previous.phase !== 'commentary') previous.text += update.content.text;
  else messages.push({ id: randomUUID(), role, text: update.content.text, complete: true });
}

export class AcpCompanion extends NativeAgent {
  constructor(options) {
    super(options); this.endpoints = new Set(); this.spawn = options.spawnAgent ?? spawnAgent;
    if (this.spec.adapter !== 'acp') throw new Error('此 Agent 不使用 ACP。');
  }
  nativeEnvironment() { return acpAgentEnvironment(this.provider); }
  sessionMeta() { return this.provider === 'grok' ? { yoloMode: false, autoMode: false, 'x.ai/hooks': { pre_tool_use: [{ hookCallbackIds: ['rin-permission-mode'] }] } } : {}; }
  async endpoint(cwd, { history = false, onUpdate } = {}) {
    const { ClientSideConnection, ndJsonStream } = await import('@agentclientprotocol/sdk');
    if (this.closed) throw new Error('Agent 已关闭。');
    const args = [...(this.binaryArgs ?? []), ...this.spec.acpArgs];
    const child = this.spawn(this.binary, args, cwd, this.nativeEnvironment());
    const ep = { child, history, closing: false, sessionId: null, tools: new Map() }; this.endpoints.add(ep);
    child.stderr.on('data', () => {});
    const processFailed = error => { if (!ep.closing && !history && this.active === ep) { this.cancelApprovals(); this.report(error, { connection: true }); } };
    child.on('error', () => processFailed(new Error(`无法启动 ${this.spec.name}，请检查程序路径。`)));
    child.stdin.on('error', () => processFailed(new Error(`${this.spec.name} 输入连接已断开。`)));
    child.once('exit', code => processFailed(new Error(`${this.spec.name} 已退出（${code ?? '中断'}），请重连。`)));
    const conn = new ClientSideConnection(() => ({
      sessionUpdate: ({ sessionId, update }) => {
        if (ep.closing || ep.sessionId && ep.sessionId !== sessionId) return;
        if (onUpdate) onUpdate(update);
        else if (this.active === ep) this.update(update);
      },
      requestPermission: p => ep.closing || this.closed || this.stopRequested || !this.acceptingUpdates || history || this.active !== ep || p.sessionId !== ep.sessionId ? { outcome: { outcome: 'cancelled' } } : this.permission(ep, p, conn.signal),
      createElicitation: p => ep.closing || this.closed || this.stopRequested || !this.acceptingUpdates || history || this.active !== ep || p.sessionId && p.sessionId !== ep.sessionId ? { action: 'cancel' } : this.elicitation(p, conn.signal),
      extMethod: (method, p) => this.extension(ep, method.replace(/^_/, ''), p),
      extNotification: (method, p) => {
        if (this.provider === 'grok' && !ep.closing && !this.closed && !history && this.active === ep && method.replace(/^_/, '') === 'x.ai/model_state_changed') this.models({ models: p.modelState ?? p });
      },
    }), ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
    ep.conn = conn;
    conn.closed.then(() => processFailed(new Error(`${this.spec.name} 协议连接已关闭，请重连。`)));
    try {
      ep.init = await deadline(conn.initialize({ protocolVersion: 1, clientInfo: { name: 'rin-desktop', version: packageInfo.version }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} } }, _meta: { clientIdentifier: 'rin-desktop', startupHints: { nonInteractive: false } } }), 45000, 'ACP 初始化');
      if (ep.init.protocolVersion !== 1) throw new Error('该 CLI 的 ACP 协议版本不受支持。');
      if (this.provider === 'grok') {
        if (!ep.init.authMethods?.some(m => m.id === 'cached_token')) throw new Error('Grok login required：请先在终端运行 grok 完成登录。');
        await deadline(conn.authenticate({ methodId: 'cached_token', _meta: { headless: true } }), 30000, 'Grok 登录复用');
      }
      if (this.closed || ep.closing) throw new Error('Agent 已关闭。');
      return ep;
    } catch (error) { await this.closeEndpoint(ep); throw error; }
  }
  async closeEndpoint(ep) {
    if (!ep) return;
    if (ep.disposal) return ep.disposal;
    ep.closing = true;
    ep.disposal = closeChild(ep.child).finally(() => this.endpoints.delete(ep));
    return ep.disposal;
  }
  async openNative() {
    const ep = await this.endpoint(this.state.cwd); this.active = ep; const id = this.state.threadId;
    const canLoad = !!ep.init.agentCapabilities?.loadSession;
    const canResume = !!ep.init.agentCapabilities?.sessionCapabilities?.resume;
    this.state.canResume = canLoad || canResume;
    this.state.historyLocalOnly = !canLoad;
    this.replay = id && canLoad ? [] : null; ep.sessionId = id;
    let session;
    try {
      if (id && !this.state.canResume) throw Object.assign(new Error('此 Agent 不支持恢复已有会话。可以新建对话，旧会话和本地记录会保留。'), { code: 'ACP_RESUME_UNSUPPORTED' });
      const params = { cwd: this.state.cwd, mcpServers: [], _meta: this.sessionMeta() };
      const opening = !id ? ep.conn.newSession(params)
        : canLoad ? ep.conn.loadSession({ sessionId: id, ...params })
          : ep.conn.resumeSession({ sessionId: id, ...params });
      session = await deadline(opening, 45000, id ? '恢复会话' : '创建会话');
      ep.sessionId = session.sessionId || id;
      if (!ep.sessionId) throw new Error('CLI 没有返回会话编号。');
      this.state.threadId = ep.sessionId; this.models(session);
      if (this.closed || ep.closing) throw new Error('Agent 已关闭。');
      if (id) {
        // resume restores context without replaying messages. Its empty replay
        // is not an empty transcript and must never replace the display cache.
        if (canLoad) this.state.messages = restoreHistory(this.replay, this.state.messages).slice(-200);
        this.state.restored = true;
      }
      // The Grok process is dedicated (--no-leader); override auto-approve only
      // in that process, including after loading a previously saved session.
      if (this.provider === 'grok') await ep.conn.extNotification('_x.ai/yolo_mode_changed', { yolo_mode: false, auto_mode: false, permission_mode: 'ask' });
      this.state.login = this.provider === 'deepseek' ? '由 Harness 的 acp 配置管理' : '复用原生 CLI 认证';
    } finally { this.replay = null; }
  }
  models(result) {
    if (result.configOptions) this.configOptions = result.configOptions;
    const options = this.configOptions ?? [], model = options.find(o => o.category === 'model'), effort = options.find(o => o.category === 'thought_level');
    if (model) {
      this.state.models = flatten(model.options).map(o => ({ id: o.value, model: o.value, name: o.name, efforts: o.value === model.currentValue ? flatten(effort?.options).map(e => ({ reasoningEffort: e.value })) : [] }));
      this.state.model = model.currentValue; this.state.effort = effort?.currentValue ?? null;
    } else if (result.models) {
      this.state.models = (result.models.availableModels ?? []).map(m => ({ id: m.modelId, model: m.modelId, name: m.name || m.modelId, efforts: (m._meta?.reasoningEfforts ?? []).map(e => ({ reasoningEffort: e.value ?? e.id })) }));
      this.state.model = result.models.currentModelId;
      this.state.effort = result.models.availableModels?.find(m => m.modelId === this.state.model)?._meta?.reasoningEffort ?? null;
    }
    this.changed();
  }
  update(update) {
    if (this.closed) return;
    if (this.replay) { replayMessage(this.replay, update); return; }
    const type = update.sessionUpdate;
    if (type === 'config_option_update') { this.models(update); return; }
    if (type === 'session_info_update') {
      if (update.title && !this.cachedSession(this.state.cwd, this.state.threadId)?.alias) this.state.threadName = update.title;
      this.changed(false); return;
    }
    if (!this.run || this.acceptingUpdates === false || this.stopRequested) return;
    if (type === 'agent_message_chunk' && update.content?.type === 'text') this.appendText(update.content.text);
    else if (type === 'tool_call' || type === 'tool_call_update') {
      const tools = this.active?.tools;
      const id = update.toolCallId;
      if (tools && typeof id === 'string') {
        tools.set(id, mergeToolDetails(tools.get(id), update));
      }
      this.receivedSubmission();
      const previous = this.state.messages.at(-1);
      if (type === 'tool_call' && previous?.turnId === this.state.turnId) markToolPreamble(previous);
      if (!this.stopRequested && !this.pending.size) this.state.activity = update.title || (update.status === 'completed' ? '继续处理中' : '正在调用工具');
      this.changed(false);
    }
  }
  permission(ep, p, signal) {
    // ACP permits a permission request to refer to a previous tool update by ID.
    const tool = mergeToolDetails(ep.tools.get(p.toolCall?.toolCallId), p.toolCall);
    const allow = p.options?.find(o => o.kind === 'allow_once');
    const deny = p.options?.find(o => o.kind === 'reject_once');
    const input = tool.rawInput;
    const command = [input?.command, input?.cmd, input?.Command].find(nonEmptyText) || '';
    const cwd = [input?.cwd, input?.workdir, input?.working_directory, input?.Cwd].find(nonEmptyText) || '';
    const content = Array.isArray(tool.content) ? tool.content : [];
    const locations = Array.isArray(tool.locations) ? tool.locations : [];
    const paths = [...new Set([
      ...locations.map(location => location?.path),
      ...content.filter(item => item?.type === 'diff').map(item => item.path),
      input?.path, input?.filePath, input?.file_path, input?.absolute_path, input?.Path,
    ].filter(nonEmptyText))];
    const inputProvided = typeof input === 'string' ? input.trim() : input && Object.keys(input).length;
    if (!command && !paths.length && !(nonEmptyText(tool.title) && inputProvided)) {
      this.state.activity = 'Agent 未提供操作详情，已拒绝工具请求';
      this.changed(false);
      return { outcome: deny ? { outcome: 'selected', optionId: deny.optionId } : { outcome: 'cancelled' } };
    }
    const details = [JSON.stringify(input ?? {}, null, 2), ...content.map(item =>
      item?.type === 'diff' ? `${item.path}\n---\n${item.oldText || ''}\n+++\n${item.newText || ''}` : item?.content?.text || ''
    )].join('\n').slice(0, 256000);
    const kind = ['edit', 'delete', 'move'].includes(tool.kind) ? 'files' : 'command';
    return this.ask({ kind, reason: tool.title || 'Agent 请求执行工具', command, cwd, paths, details, allowDisabled: !allow }, answer => {
      if (!['accept', 'decline'].includes(answer?.decision)) throw new Error('请选择允许或拒绝。');
      const selected = answer.decision === 'accept' ? allow : deny;
      if (answer.decision === 'accept' && !selected) throw new Error('该请求没有提供单次允许选项，请在原生 CLI 中处理。');
      return { outcome: selected ? { outcome: 'selected', optionId: selected.optionId } : { outcome: 'cancelled' } };
    }, { outcome: { outcome: 'cancelled' } }, signal);
  }
  elicitation(p, signal) {
    if (p.mode !== 'form' || !p.requestedSchema?.properties) return { action: 'cancel' };
    return this.ask({ kind: 'questions', reason: p.message || '', questions: formView(p.requestedSchema) }, answer => formAnswer(p.requestedSchema, answer), { action: 'cancel' }, signal);
  }
  extension(ep, method, p) {
    if (this.provider !== 'grok') throw new Error('此 Agent 不支持该私有扩展请求。');
    if (method === 'x.ai/hooks/run') {
      if (this.closed || !this.acceptingUpdates || this.active !== ep || ep.history || this.stopRequested || ep.closing || /always|bypass/i.test(p.permissionMode ?? '')) return { decision: 'deny', systemMessage: 'Rin requires interactive permissions. Stop this action.' };
      return {};
    }
    if (method === 'x.ai/ask_user_question') {
      if (this.closed || this.stopRequested || !this.acceptingUpdates || ep.closing || ep.history || this.active !== ep) return { outcome: 'cancelled' };
      return this.ask({ kind: 'questions', questions: questionsView(p.questions) }, answer => ({ outcome: 'accepted', answers: questionAnswers(p.questions ?? [], answer, true) }), { outcome: 'cancelled' }, ep.conn.signal);
    }
    if (method === 'x.ai/folder_trust/request') return { outcome: 'reject' };
    if (method === 'x.ai/mcp/elicit') return { outcome: 'cancel' };
    throw new Error(`Rin 不支持该扩展请求：${method}`);
  }
  async promptNative(text) {
    const ep = this.active;
    if (!ep || ep.closing) throw new Error('ACP 连接已关闭。');
    ep.tools.clear();
    this.acceptingUpdates = true;
    let result;
    try { result = await ep.conn.prompt({ sessionId: ep.sessionId, prompt: [{ type: 'text', text }] }); this.receivedSubmission(); }
    finally { this.acceptingUpdates = false; ep.tools.clear(); }
    if (result.stopReason === 'cancelled') return { cancelled: true };
    if (result.stopReason !== 'end_turn') throw new Error(`Agent 提前结束本轮：${result.stopReason || '未知原因'}`);
    return { cancelled: false };
  }
  async cancelNative() { if (this.active?.sessionId && this.run) await this.active.conn.cancel({ sessionId: this.active.sessionId }); }
  async disposeNative() {
    this.cancelApprovals(); this.active = null; this.configOptions = null;
    await Promise.all([...this.endpoints].map(ep => this.closeEndpoint(ep)));
  }
  async chooseModel(model) {
    if (!this.state.models.some(m => m.model === model)) throw new Error('请选择 CLI 提供的模型。');
    return this.configure(async () => {
      const option = this.configOptions?.find(o => o.category === 'model');
      if (option) this.models(await deadline(this.active.conn.setSessionConfigOption({ sessionId: this.state.threadId, configId: option.id, value: model }), 30000, '模型切换'));
      else { await deadline(this.active.conn.request('session/set_model', { sessionId: this.state.threadId, modelId: model }), 30000, '模型切换'); this.state.model = model; this.state.effort = null; }
    });
  }
  async chooseEffort(effort) {
    const model = this.state.models.find(m => m.model === this.state.model);
    if (effort && !model?.efforts?.some(e => e.reasoningEffort === effort)) throw new Error('当前模型不支持此推理强度。');
    if (!effort) return;
    return this.configure(async () => {
      const option = this.configOptions?.find(o => o.category === 'thought_level');
      const result = await deadline(this.active.conn.setSessionConfigOption({ sessionId: this.state.threadId, configId: option?.id || 'reasoning_effort', value: effort }), 30000, '推理强度切换');
      this.models(result); this.state.effort = effort;
    });
  }
  async listThreads(cwd, cursor = null, search = '') {
    this.assertReady();
    if (!this.active.init.agentCapabilities?.sessionCapabilities?.list) {
      return { data: this.rememberList(Object.values(this.index).filter(s => pathKey(s.cwd) === pathKey(cwd) && s.name.includes(search)).map(({ messages, ...item }) => item)), nextCursor: null };
    }
    const result = await deadline(this.active.conn.listSessions({ cwd, ...(cursor ? { cursor } : {}) }), 30000, '会话列表读取');
    const sessions = (result.sessions ?? []).filter(s => s.cwd && pathKey(s.cwd) === pathKey(cwd)).map(s => {
      const cached = this.cachedSession(s.cwd, s.sessionId);
      return { id: s.sessionId, cwd: s.cwd, name: s.title || cached?.name, updatedAt: timestamp(s.updatedAt) || cached?.updatedAt, source: this.provider };
    });
    // Some ACP servers omit new or active sessions from their native list.
    const { threadId, cwd: currentCwd, threadName } = this.state;
    if (!cursor && threadId && pathKey(currentCwd) === pathKey(cwd) && !sessions.some(s => s.id === threadId)) {
      const cached = this.cachedSession(currentCwd, threadId);
      sessions.unshift({ id: threadId, cwd: currentCwd, name: threadName || cached?.name, updatedAt: cached?.updatedAt, source: this.provider });
    }
    const data = this.rememberList(sessions);
    return { data: data.filter(s => s.name.toLowerCase().includes(String(search).toLowerCase())), nextCursor: result.nextCursor ?? null };
  }
  async history(id, cursor = null, cwd) {
    this.assertReady(); const item = this.session(id, cwd);
    const cached = this.cachedSession(item.cwd, id)?.messages;
    if (cursor) return { turns: [], nextCursor: null };
    if (id === this.state.threadId && pathKey(item.cwd) === pathKey(this.state.cwd) && this.run) return { turns: historyTurns(this.state.messages), nextCursor: null, ...(this.state.historyLocalOnly ? { localOnly: true } : {}) };
    if (!this.active.init.agentCapabilities?.loadSession) return { turns: historyTurns(cached ?? []), nextCursor: null, localOnly: true };
    // Replay in a separate CLI connection: inspecting history must not change
    // the active session or attach a second prompt to a running conversation.
    const messages = [], ep = await this.endpoint(item.cwd, { history: true, onUpdate: update => replayMessage(messages, update) });
    try {
      if (!ep.init.agentCapabilities?.loadSession) throw new Error('CLI 不支持读取原生会话。');
      ep.sessionId = id;
      await deadline(ep.conn.loadSession({ sessionId: id, cwd: item.cwd, mcpServers: [], _meta: this.sessionMeta() }), 45000, '历史读取');
      return { turns: historyTurns(restoreHistory(messages, cached)), nextCursor: null };
    } finally { await this.closeEndpoint(ep); }
  }
  async readSubmissionHistory({ cwd, threadId }) {
    this.assertReady();
    if (!threadId) return [];
    if (!this.active.init.agentCapabilities?.loadSession) {
      throw Object.assign(new Error('CLI 不支持读取原生会话。'), { code: 'NATIVE_HISTORY_UNAVAILABLE' });
    }
    const messages = [], ep = await this.endpoint(cwd, { history: true, onUpdate: update => replayMessage(messages, update) });
    try {
      if (!ep.init.agentCapabilities?.loadSession) throw new Error('CLI 不支持读取原生会话。');
      ep.sessionId = threadId;
      await deadline(ep.conn.loadSession({ sessionId: threadId, cwd, mcpServers: [], _meta: this.sessionMeta() }), 45000, '发送核查');
      // ACP replay has no stable message IDs. Do not use local random IDs as
      // evidence of remote acceptance.
      return messages.filter(message => message.role === 'user').map(({ text }) => ({ text }));
    } finally { await this.closeEndpoint(ep); }
  }
}
