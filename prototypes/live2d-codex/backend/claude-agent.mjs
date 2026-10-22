import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { NativeAgent, historyTurns, pathKey } from './native-agent.mjs';
import { agentEnvironment, closeChild, deadline } from './agent-process.mjs';
import { questionsView, questionAnswers } from './agent-questions.mjs';
import { restoreHistory } from './reply-state.mjs';

function inputChannel() {
  const queue = [], readers = []; let closed = false;
  return {
    push(value) { if (closed) throw new Error('Claude 输入已关闭，请重新连接。'); const next = readers.shift(); next ? next({ value, done: false }) : queue.push(value); },
    close() { closed = true; for (const next of readers.splice(0)) next({ done: true }); },
    [Symbol.asyncIterator]() { return this; },
    next() { return queue.length ? Promise.resolve({ value: queue.shift(), done: false }) : closed ? Promise.resolve({ done: true }) : new Promise(next => readers.push(next)); },
  };
}
const textOf = message => typeof message?.content === 'string' ? message.content : (message?.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n');
const messagesOf = rows => rows.filter(row => ['user', 'assistant'].includes(row.type) && !row.parent_tool_use_id).map(row => ({ id: row.uuid, role: row.type, text: textOf(row.message), complete: true })).filter(row => row.text);

export function claudeAuthentication(account) {
  // Use the CLI's resolved backend, not merely the presence of environment
  // variables: an SDK integration must not silently consume subscription OAuth.
  const provider = account?.apiProvider;
  if (['bedrock', 'vertex', 'foundry', 'anthropicAws', 'anthropicGoogleCloud', 'mantle', 'gateway'].includes(provider)) return '云平台 API 认证（按提供商计费）';
  if ((!provider || provider === 'firstParty') && ['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key'].includes(account?.apiKeySource)) return 'API 凭据（按量计费）';
  const error = new Error('Claude 需要 API 凭据或官方支持的云平台 API 认证。Rin 不提供订阅登录或订阅额度；请自行配置认证后重新连接，现有会话和草稿已保留。');
  error.code = -32000;
  throw error;
}

export class ClaudeCompanion extends NativeAgent {
  constructor(options) { super({ ...options, provider: 'claude' }); }
  async openNative() {
    this.sdk ??= await import('@anthropic-ai/claude-agent-sdk');
    if (this.closed) throw new Error('Agent 已关闭。');
    const input = inputChannel(), transport = { input, closing: false, children: [] }; this.transport = transport;
    const resume = this.state.threadId;
    const q = this.sdk.query({ prompt: input, options: {
      cwd: this.state.cwd, pathToClaudeCodeExecutable: this.binary,
      ...(resume ? { resume } : {}), ...(this.state.model ? { model: this.state.model } : {}), ...(this.state.effort ? { effort: this.state.effort } : {}),
      // Keep API authentication but do not inherit bypass modes or project
      // hooks that can execute before the UI has a chance to show an approval.
      settingSources: [], strictMcpConfig: true, mcpServers: {}, permissionMode: 'default',
      systemPrompt: { type: 'preset', preset: 'claude_code' }, includePartialMessages: true,
      settings: { permissions: { ask: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch'] } },
      env: { ...agentEnvironment(), DISABLE_AUTOUPDATER: '1' },
      canUseTool: (tool, data, context) => transport.closing || this.transport !== transport || this.closed || !this.result ? { behavior: 'deny', message: 'No active turn owns this request.', interrupt: true } : this.permission(tool, data, context),
      spawnClaudeCodeProcess: options => {
        const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, signal: options.signal, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
        transport.children.push(child); child.stderr.on('data', () => {}); return child;
      },
    } });
    transport.q = q;
    transport.reader = (async () => {
      try { for await (const message of q) { if (!transport.closing && this.transport === transport) this.receive(message); } }
      catch (error) { if (!transport.closing && this.transport === transport) { this.result?.reject(error); this.result = null; this.report(error, { connection: true }); } }
      finally {
        if (this.transport === transport) {
          this.result?.reject(new Error('Claude 连接已结束，请重连恢复会话。')); this.result = null;
          if (!transport.closing && !this.closed) this.report(new Error('Claude 连接已结束，请重连。'), { connection: true });
        }
      }
    })();
    const account = await deadline(q.accountInfo(), 30000, 'Claude 认证状态读取');
    if (this.closed || this.transport !== transport) throw new Error('Agent 已关闭。');
    // Only authentication kind crosses the renderer boundary.
    this.state.login = claudeAuthentication(account);
    const models = await deadline(q.supportedModels(), 30000, 'Claude 模型列表读取');
    if (this.closed || this.transport !== transport) throw new Error('Agent 已关闭。');
    this.state.models = [{ id: '', model: '', name: 'CLI 默认模型', efforts: [] }, ...models.map(m => ({ id: m.value, model: m.value, name: m.displayName, efforts: (m.supportedEffortLevels ?? []).map(reasoningEffort => ({ reasoningEffort })) }))];
    if (resume) {
      const history = await this.sdk.getSessionMessages(resume, { dir: this.state.cwd });
      if (this.closed || this.transport !== transport) throw new Error('Agent 已关闭。');
      this.state.messages = restoreHistory(messagesOf(history), this.state.messages).slice(-200); this.state.restored = true;
    }
  }
  permission(tool, input, context) {
    const cancelled = { behavior: 'deny', message: 'User stopped this turn.', interrupt: true };
    if (tool === 'AskUserQuestion') return this.ask({ kind: 'questions', questions: questionsView(input.questions) }, answer => ({ behavior: 'allow', updatedInput: { ...input, answers: questionAnswers(input.questions ?? [], answer) } }), cancelled, context.signal);
    const kind = /Write|Edit|Notebook/.test(tool) ? 'files' : 'command';
    return this.ask({ kind, reason: `Claude 请求使用 ${tool}`, command: tool === 'Bash' ? input.command || '' : '', details: JSON.stringify(input, null, 2).slice(0, 256000) }, answer => {
      if (!['accept', 'decline'].includes(answer?.decision)) throw new Error('请选择允许或拒绝。');
      return answer.decision === 'accept' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'User denied this operation. Do not retry or work around the denial.' };
    }, cancelled, context.signal);
  }
  receive(message) {
    if (this.closed) return;
    if (message.session_id && this.state.threadId && message.session_id !== this.state.threadId) return;
    if (message.parent_tool_use_id) return;
    if (message.type === 'system' && message.subtype === 'init') {
      this.state.threadId = message.session_id; this.state.model ||= message.model;
      if (this.submission) this.emit('submission', { id: this.submission.id, target: { cwd: this.state.cwd, threadId: this.state.threadId } });
      if (this.state.model && !this.state.models.some(m => m.model === this.state.model)) this.state.models.push({ id: this.state.model, model: this.state.model, name: this.state.model, efforts: [] });
      this.persist().catch(error => this.report(error)); this.changed(); return;
    }
    if (message.type === 'stream_event' && this.result) {
      const event = message.event;
      if (event.type === 'message_start') this.streamMessage = { id: event.message?.id, text: '', view: null };
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        this.streamMessage ??= { text: '' }; this.streamMessage.text += event.delta.text; this.appendText(event.delta.text); this.streamMessage.view = this.state.messages.at(-1);
      }
    } else if (message.type === 'assistant' && this.result) {
      const text = textOf(message.message);
      if (text) {
        if (this.streamMessage?.view && (!this.streamMessage.id || this.streamMessage.id === message.message.id)) this.streamMessage.view.text = text;
        else this.appendText(text);
      }
      this.streamMessage = null;
      // Separate model messages across tool calls so the full message never
      // replaces a previous iteration's text after streaming.
      const last = this.state.messages.at(-1);
      if (last?.role === 'assistant') { last.complete = true; if (message.uuid) last.id = message.uuid; }
      if (message.message.content?.some(p => p.type === 'tool_use')) this.state.activity = '正在调用工具';
      this.changed(false);
    } else if (message.type === 'result') {
      const pending = this.result; this.result = null;
      if (!pending) return;
      if (message.session_id) this.state.threadId = message.session_id;
      this.receivedSubmission();
      if (message.is_error || message.subtype !== 'success') pending.reject(new Error(message.result || message.errors?.join('\n') || `Claude 请求失败：${message.subtype}`));
      else { if (message.result && !this.state.messages.some(m => m.turnId === this.state.turnId && m.role === 'assistant')) this.appendText(message.result); pending.resolve({ cancelled: this.stopRequested || message.stop_reason === 'interrupted' }); }
    }
  }
  promptNative(text) {
    if (!this.transport?.q) throw new Error('Claude 未连接。');
    return new Promise((resolve, reject) => {
      this.result = { resolve, reject }; this.streamMessage = null;
      try { this.transport.input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, uuid: this.state.messages.findLast(m => m.role === 'user')?.id ?? randomUUID() }); }
      catch (error) { this.result = null; reject(error); }
    });
  }
  async cancelNative() { if (this.result && this.transport?.q) await this.transport.q.interrupt(); }
  async disposeNative() {
    const transport = this.transport; if (!transport) return;
    if (transport.disposal) return transport.disposal;
    transport.closing = true;
    transport.disposal = (async () => {
      this.cancelApprovals(); transport.input.close();
      this.result?.reject(new Error('Claude 连接已关闭。')); this.result = null;
      await Promise.all(transport.children.map(child => closeChild(child)));
      transport.q?.close();
      await deadline(transport.reader, 3000, 'Claude 退出').catch(() => {});
    })().finally(() => { if (this.transport === transport) this.transport = null; });
    return transport.disposal;
  }
  async chooseModel(model) {
    if (!this.state.models.some(m => m.model === model)) throw new Error('请选择模型列表中的模型。');
    return this.configure(async () => { await deadline(this.transport.q.setModel(model || undefined), 30000, '切换模型'); this.state.model = model || null; this.state.effort = null; });
  }
  async chooseEffort(effort) {
    if (effort && !this.state.models.find(m => m.model === this.state.model)?.efforts?.some(v => v.reasoningEffort === effort)) throw new Error('当前模型不支持此推理强度。');
    return this.configure(async () => { await this.disposeNative(); this.state.effort = effort || null; await this.openNative(); });
  }
  async listThreads(cwd, cursor = null, search = '') {
    this.assertReady(); const all = await this.sdk.listSessions({ dir: cwd, includeWorktrees: false });
    const data = this.rememberList(all.filter(s => !s.cwd || pathKey(s.cwd) === pathKey(cwd)).map(s => ({ id: s.sessionId, cwd: s.cwd || cwd, name: s.customTitle || s.summary || s.firstPrompt || '未命名对话', updatedAt: s.lastModified / 1000, source: 'claude' }))).filter(s => s.name.toLowerCase().includes(String(search).toLowerCase()));
    const offset = Number(cursor || 0); if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页参数无效。');
    return { data: data.slice(offset, offset + 50), nextCursor: offset + 50 < data.length ? String(offset + 50) : null };
  }
  async history(id, cursor = null) {
    this.assertReady(); const item = this.session(id);
    const turns = historyTurns(restoreHistory(messagesOf(await this.sdk.getSessionMessages(id, { dir: item.cwd })), this.index[id]?.messages));
    const end = cursor === null ? turns.length : Number(cursor); if (!Number.isSafeInteger(end) || end < 0 || end > turns.length) throw new Error('分页参数无效。');
    const start = Math.max(0, end - 20); return { turns: turns.slice(start, end), nextCursor: start ? String(start) : null };
  }
  async readSubmissionHistory({ cwd, threadId }) {
    this.assertReady();
    if (!threadId) return [];
    return messagesOf(await this.sdk.getSessionMessages(threadId, { dir: cwd })).filter(message => message.role === 'user');
  }
  async renameNative(id, name, cwd) { await this.sdk.renameSession(id, name, { dir: cwd }); }
}
