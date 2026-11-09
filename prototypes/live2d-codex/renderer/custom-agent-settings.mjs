import { agentSetupPrompt } from '../backend/agent-setup-prompt.mjs';
import { isTaskBusy } from '../backend/task-state.mjs';

export function installCustomAgentSettings({ api, document }) {
  const $ = id => document.getElementById(id);
  let data, editing = null, dirty = false, busy = false, current, confirmation;
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
  async function run(action) {
    if (busy) return;
    busy = true; controls();
    try { return await action(); }
    catch (error) { status(error.message, true); }
    finally { busy = false; controls(); }
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
      const connectedBusy = isTaskBusy(current) || current?.connection === 'connecting';
      button.disabled = busy || unavailable || button.dataset.action === 'remove' && active || button.dataset.action === 'connect' && (connectedBusy || dirty && editing?.id === button.dataset.agentId);
    }
  }
  function prompt() {
    $('agent-prompt-preview').value = agentSetupPrompt({ file: data?.file, name: $('agent-prompt-target').value });
  }
  function list() {
    const host = $('agents-list'); host.replaceChildren();
    const entries = data?.entries ?? [];
    $('agents-empty').hidden = entries.length > 0;
    for (const entry of entries) {
      const row = node('div', undefined, 'custom-agent-row'); row.dataset.agentId = entry.id;
      const description = node('div', undefined, 'custom-agent-description');
      const active = entry.id === (current?.provider ?? data.activeId);
      description.append(node('strong', entry.name), node('span', active ? '当前使用' + (data.needsReconnect ? ' · 有新配置，重连后生效' : '') : '自定义 · ACP', 'hint'), node('small', entry.command));
      const actions = node('div', undefined, 'custom-agent-actions');
      for (const [action, label] of [['connect', active ? '重新连接' : '连接'], ['edit', '编辑'], ['remove', '删除']]) {
        const button = node('button', label, action === 'remove' ? 'quiet' : ''); button.type = 'button';
        button.dataset.action = action; button.dataset.agentId = entry.id;
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
            status(current.connection === 'ready' ? `已连接 ${entry.name}。尚未发送任务。` : [current.error, current.loginHelp].filter(Boolean).join(' ') || '连接未就绪，请查看连接帮助。', current.connection !== 'ready');
          });
        };
        actions.append(button);
      }
      row.append(description, actions); host.append(row);
    }
    controls();
  }
  function accept(value) {
    data = value;
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
  function closeEditor() { editing = null; dirty = false; $('agent-editor').hidden = true; controls(); }
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
    run(async () => {
      accept(await response(api.saveCustomAgent(entry, editing.revision, editing.creating)));
      closeEditor();
      status(entry.id === (current?.provider ?? data.activeId) ? '配置已保存，当前连接保持不变。点击“重新连接”使用新配置。' : '已保存，可在列表中点击“连接”。');
    });
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
  controls(); prompt();
  return {
    stateChanged(state) {
      const changed = current?.provider !== state.provider;
      current = state;
      if (data && changed) { data.activeId = state.provider; data.needsReconnect = false; list(); }
      else controls();
    },
    workspaceChanged(value) {
      if (data && !busy && value.agentConfigRevision !== undefined && value.agentConfigRevision !== data.revision) status('接入配置已更新，请点击“重新读取”。当前未保存输入已保留。');
      else if (data && !busy && typeof value.agentNeedsReconnect === 'boolean' && data.needsReconnect !== value.agentNeedsReconnect) { data.needsReconnect = value.agentNeedsReconnect; list(); }
    },
  };
}
