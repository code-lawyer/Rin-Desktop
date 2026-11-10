import { agentSetupPrompt } from '../backend/agent-setup-prompt.mjs';
import { isTaskBusy } from '../backend/task-state.mjs';
import { agentConnectionHelp } from './agent-connection-help.mjs';
import catalog from '../backend/agent-catalog.cjs';

const builtinDescriptions = {
  codex: '沿用 Codex CLI 的登录和本地会话。',
  claude: '连接 Claude Code，使用 API 或云平台认证。',
  grok: '沿用 Grok Build CLI 已保存的登录。',
  opencode: '连接 OpenCode V2 和已配置的模型。',
};

export function installAgentSettings({ api, document }) {
  const $ = id => document.getElementById(id);
  let data, editing = null, dirty = false, busy = false, current, confirmation, listKey;
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const response = async promise => {
    const result = await promise;
    if (!result?.ok) throw new Error(result?.error || '操作未完成，请重试。');
    return result.value;
  };
  function status(message, error = false) {
    $('agents-status').textContent = message;
    $('agents-status').dataset.error = String(error);
  }
  function editorError(message = '') {
    const error = $('agent-editor-error');
    error.textContent = message; error.hidden = !message;
    if (message) {
      $('agent-save').scrollIntoView({ block: 'nearest' });
      error.scrollIntoView({ block: 'nearest' });
    }
  }
  async function run(action, onError = message => status(message, true)) {
    if (busy) return;
    // Disabling a button blurs it before the list's next render. Keep its
    // identity until the operation finishes, unless the user moves elsewhere.
    const focused = document.activeElement;
    const listFocus = $('agents-list').contains(focused) ? { agentId: focused.dataset.agentId, action: focused.dataset.action } : null;
    let focusMoved = false;
    const onFocus = event => { if (event.target !== document.body) focusMoved = true; };
    document.addEventListener('focusin', onFocus);
    busy = true; controls();
    try { return await action(); }
    catch (error) { onError(error.message); }
    finally {
      document.removeEventListener('focusin', onFocus);
      busy = false; controls();
      if (!focusMoved && document.activeElement === document.body) {
        const target = listFocus ? [...$('agents-list').querySelectorAll('button')].find(button => button.dataset.agentId === listFocus.agentId && button.dataset.action === listFocus.action) : focused;
        if (target?.isConnected && !target.matches(':disabled') && !target.closest('[hidden],[inert]') && target.checkVisibility({ visibilityProperty: true })) target.focus({ preventScroll: true });
      }
    }
  }
  function controls() {
    const unavailable = !data || !!data.error;
    $('agents-add').disabled = busy || unavailable;
    $('agents-reload').disabled = busy;
    $('agent-editor-fields').disabled = busy || unavailable;
    $('agent-confirm-accept').disabled = busy;
    $('agent-confirm-cancel').disabled = busy;
    $('agent-copy-prompt').disabled = busy || !data;
    for (const button of $('agents-list').querySelectorAll('button')) {
      const active = button.dataset.agentId === (current?.provider ?? data?.activeId);
      const connectedBusy = !current || isTaskBusy(current) || current.connection === 'connecting';
      // A broken custom config must never prevent returning to a builtin Agent.
      button.disabled = busy || button.dataset.custom === 'true' && unavailable || button.dataset.action === 'remove' && active || button.dataset.action === 'connect' && (connectedBusy || dirty && editing?.id === button.dataset.agentId);
    }
  }
  function prompt() {
    $('agent-prompt-preview').value = agentSetupPrompt({ file: data?.file, name: $('agent-prompt-target').value });
  }
  function list() {
    const entries = [
      ...Object.entries(catalog.AGENTS).filter(([, spec]) => !spec.custom).map(([id, spec]) => ({ id, ...spec })),
      ...(data?.entries ?? []).map(entry => ({ ...entry, custom: true, experimental: true })),
    ];
    const activeId = current?.provider ?? data?.activeId;
    const key = JSON.stringify([entries, activeId, current?.connection, current?.status, current?.error, current?.loginHelp, data?.needsReconnect]);
    if (key === listKey) { controls(); return; }
    listKey = key;
    const host = $('agents-list'), focused = host.contains(document.activeElement) ? document.activeElement.dataset : null;
    host.replaceChildren();
    $('agents-empty').hidden = !!data?.entries?.length;
    for (const entry of entries) {
      const active = entry.id === activeId;
      const row = node('article', undefined, 'agent-row' + (entry.custom ? ' custom-agent-row' : '')); row.dataset.agentId = entry.id; row.dataset.active = String(active);
      row.setAttribute('aria-label', entry.name);
      const description = node('div', undefined, 'agent-description'), heading = node('div', undefined, 'agent-row-heading');
      heading.append(node('strong', entry.name), node('span', [entry.custom ? '自定义' : '内置', entry.experimental ? '实验' : ''].filter(Boolean).join(' · '), 'agent-kind'));
      description.append(heading, node('span', entry.custom ? '使用你配置的本机 Agent。' : builtinDescriptions[entry.id], 'hint'));
      if (active) {
        const connection = current?.connection;
        const sessionError = connection === 'ready' && current?.status === 'error';
        const label = connection === 'ready' ? sessionError ? '当前使用 · 需要处理' : isTaskBusy(current) ? '当前使用 · 工作中' : '当前使用 · 已连接'
          : connection === 'authentication' ? '当前使用 · 需要认证' : connection === 'error' ? '当前使用 · 连接待处理' : '当前使用 · 连接中';
        const state = node('span', label, 'agent-row-status'); state.dataset.state = sessionError ? 'error' : connection || 'connecting'; description.append(state);
        if (entry.custom && data?.needsReconnect) description.append(node('span', '有新配置，重连后生效', 'agent-reconnect-note'));
        const help = agentConnectionHelp(current);
        if (help) description.append(node('p', help, 'agent-row-error'));
      }
      const actions = node('div', undefined, 'custom-agent-actions');
      const choices = [['connect', active ? '重新连接' : '连接'], ...(entry.custom ? [['edit', '编辑'], ['remove', '删除']] : [])];
      for (const [action, label] of choices) {
        const button = node('button', label, action === 'connect' ? 'agent-connect' : 'quiet'); button.type = 'button';
        button.dataset.action = action; button.dataset.agentId = entry.id; button.dataset.custom = String(!!entry.custom);
        button.setAttribute('aria-label', `${label} ${entry.name}`);
        if (action === 'remove' && active) button.title = '先切换到其他 Agent，再删除此配置。';
        button.onclick = () => {
          if (action === 'edit') return discardThen(() => openEditor(entry));
          if (action === 'remove') return confirm(`删除“${entry.name}”的接入配置？会话、草稿和已安装程序都会保留。`, '删除配置', () => remove(entry));
          return run(async () => {
            status(`正在连接 ${entry.name}…`);
            await response(entry.id === current?.provider ? api.reconnect() : api.chooseProvider(entry.id));
            current = await response(api.snapshot());
            accept(await response(api.customAgents()));
            const connected = current.connection === 'ready' && current.status !== 'error';
            status(connected ? `已连接 ${entry.name}。尚未发送任务。` : agentConnectionHelp(current) || '连接未就绪，请查看连接帮助。', !connected);
          });
        };
        actions.append(button);
      }
      row.append(description, actions); host.append(row);
    }
    controls();
    if (focused?.action) for (const button of host.querySelectorAll('button')) {
      if (button.dataset.agentId === focused.agentId && button.dataset.action === focused.action && !button.disabled) button.focus({ preventScroll: true });
    }
  }
  function accept(value) {
    data = value;
    $('agents-config-error').textContent = value.error || '';
    $('agents-config-error').hidden = !value.error;
    $('agent-config-location').textContent = value.file || '配置位置无效，请检查 VIBE_AGENT_CONFIG。';
    $('agent-config-source').textContent = value.external ? '正在使用环境变量指定的配置文件。' : '配置保存在当前 Rin 数据目录。';
    list(); prompt();
  }
  function addArgument(value = '') {
    const row = node('div', undefined, 'custom-agent-argument');
    const input = node('input'); input.type = 'text'; input.value = value; input.maxLength = 8192; input.setAttribute('aria-label', '启动参数');
    input.placeholder = '一个参数或绝对文件路径';
    const remove = node('button', '移除'); remove.type = 'button'; remove.setAttribute('aria-label', '移除此启动参数');
    remove.onclick = () => { row.remove(); dirty = true; controls(); };
    row.append(input, remove); $('agent-args').append(row);
    return input;
  }
  function openEditor(entry) {
    editorError();
    editing = { id: entry?.id || 'custom-' + crypto.randomUUID().slice(0, 8), revision: data.revision, creating: !entry };
    $('agent-editor-title').textContent = entry ? `编辑 ${entry.name}` : '添加自定义 Agent';
    $('agent-name').value = entry?.name || '';
    $('agent-command').value = entry?.command || '';
    $('agent-id').value = editing.id; $('agent-id').readOnly = !!entry;
    $('agent-auth-method').value = entry?.authMethodId || '';
    $('agent-args').replaceChildren(); for (const argument of entry?.args ?? []) addArgument(argument);
    $('agent-editor').hidden = false; dirty = false; controls();
    $('agent-name').focus(); $('agent-editor').scrollIntoView({ block: 'nearest' });
  }
  function closeEditor() { editing = null; dirty = false; $('agent-editor').hidden = true; editorError(); controls(); }
  function confirm(message, label, action) {
    confirmation = action; $('agent-confirm-message').textContent = message;
    $('agent-confirm-accept').textContent = label; $('agent-confirm').hidden = false;
    $('agent-confirm-accept').focus(); $('agent-confirm').scrollIntoView({ block: 'nearest' });
  }
  function discardThen(action) { if (dirty) confirm('放弃当前尚未保存的 Agent 编辑？', '放弃编辑并继续', action); else action(); }
  async function remove(entry) {
    await run(async () => {
      const previousRevision = data.revision;
      accept(await response(api.removeCustomAgent(entry.id, data.revision)));
      if (editing?.id === entry.id) closeEditor();
      else if (editing?.revision === previousRevision) editing.revision = data.revision;
      status(`已删除 ${entry.name} 的接入配置。会话和草稿已保留。`);
    });
  }
  $('agent-confirm-accept').onclick = () => { const action = confirmation; confirmation = null; $('agent-confirm').hidden = true; action?.(); };
  $('agent-confirm-cancel').onclick = () => { confirmation = null; $('agent-confirm').hidden = true; };
  $('agents-add').onclick = () => discardThen(() => openEditor());
  $('agent-cancel-edit').onclick = closeEditor;
  $('agent-add-argument').onclick = () => { dirty = true; addArgument().focus(); controls(); };
  $('agent-editor').oninput = () => { dirty = true; controls(); };
  $('agent-pick-program').onclick = () => run(async () => {
    const file = await response(api.pickAgentProgram());
    if (file) { $('agent-command').value = file; dirty = true; }
  });
  $('agent-editor').onsubmit = event => {
    event.preventDefault();
    if (!editing || !$('agent-editor').reportValidity()) return;
    const entry = { id: $('agent-id').value.trim(), name: $('agent-name').value.trim(), protocol: 'acp', command: $('agent-command').value.trim(), args: [...$('agent-args').querySelectorAll('input')].map(input => input.value) };
    const auth = $('agent-auth-method').value.trim(); if (auth) entry.authMethodId = auth;
    editorError();
    run(async () => {
      accept(await response(api.saveCustomAgent(entry, editing.revision, editing.creating)));
      closeEditor();
      status(entry.id === (current?.provider ?? data.activeId) ? '配置已保存，当前连接保持不变。点击“重新连接”使用新配置。' : '已保存，可在列表中点击“连接”。');
    }, message => editorError('保存失败：' + message));
  };
  $('agents-reload').onclick = () => discardThen(() => run(async () => {
    const value = await response(api.reloadCustomAgents()); accept(value);
    if (value.error) { status(value.error + ' 原配置已保留，可复制接入提示词交给 Agent 修复。', true); return; }
    closeEditor(); status('已重新读取配置，Agent 选择器已更新。');
  }));
  $('agent-prompt-target').oninput = prompt;
  $('agent-copy-prompt').onclick = () => run(async () => {
    const text = await response(api.copyAgentPrompt($('agent-prompt-target').value));
    $('agent-prompt-preview').value = text; status('提示词已复制。粘贴给能访问本机的 Agent 即可开始接入。');
  });
  document.querySelector('[data-setting-target="agent-settings"]').addEventListener('click', () => {
    if (data) return;
    run(async () => { accept(await response(api.customAgents())); status(data.error || '', !!data.error); });
  });
  list(); prompt();
  return {
    stateChanged(state) {
      const changed = current?.provider !== state.provider;
      current = state;
      if (data && changed) { data.activeId = state.provider; data.needsReconnect = false; }
      list();
    },
    workspaceChanged(value) {
      if (data && !busy && value.agentConfigRevision !== undefined && value.agentConfigRevision !== data.revision) status('接入配置已更新，请点击“重新读取”。当前未保存输入已保留。');
      else if (data && !busy && typeof value.agentNeedsReconnect === 'boolean' && data.needsReconnect !== value.agentNeedsReconnect) { data.needsReconnect = value.agentNeedsReconnect; list(); }
    },
  };
}
