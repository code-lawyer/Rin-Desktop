import catalog from '../backend/agent-catalog.cjs';
import { isTaskBusy } from '../backend/task-state.mjs';
import { agentConnectionHelp } from './agent-connection-help.mjs';

const descriptions = {
  codex: '复用 Codex CLI 的 ChatGPT 登录和本地会话。',
  antigravity: '复用 Antigravity CLI 的 Google 登录和可用额度。',
  grok: '复用 Grok Build CLI 的登录和可用额度。',
  claude: catalog.CLAUDE_API_NOTE,
  deepseek: '使用本机 Harness 的 ACP 模型与认证配置。',
};

export function installAgentSettings({ api, document }) {
  const host = document.getElementById('agents-list');
  const notice = document.getElementById('agents-status');
  let current, pendingAgent, attemptError;

  function node(tag, className, text = '') {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  async function response(promise) {
    const result = await promise;
    if (!result?.ok) throw new Error(result?.error || '操作未完成，请重试。');
    return result.value;
  }

  async function connect(id, button) {
    if (button.disabled || pendingAgent) return;
    // A disabled button loses focus. Restore it when the operation finishes
    // if the user hasn't navigated elsewhere while waiting.
    let restoreFocus = document.activeElement === button;
    const onFocus = event => { if (event.target !== document.body) restoreFocus = false; };
    document.addEventListener('focusin', onFocus);
    pendingAgent = id;
    attemptError = null;
    render();
    try {
      await response(id === current?.provider ? api.reconnect() : api.chooseProvider(id));
      current = await response(api.snapshot());
    } catch (error) {
      attemptError = { id, text: error.message };
    } finally {
      document.removeEventListener('focusin', onFocus);
      pendingAgent = null;
      render();
      if (restoreFocus && document.activeElement === document.body && !button.disabled && button.checkVisibility()) {
        button.focus({ preventScroll: true });
      }
    }
  }

  const rows = Object.entries(catalog.AGENTS).map(([id, spec]) => {
    const row = node('li', 'agent-row');
    row.dataset.agentId = id;
    const description = node('div', 'agent-description');
    const heading = node('div', 'agent-row-heading');
    heading.append(node('h4', '', spec.name));
    if (id === 'claude') heading.append(node('span', 'agent-api-label', '仅 API'));
    if (spec.experimental) heading.append(node('span', 'agent-kind', '实验'));
    const hint = node('p', 'hint', descriptions[id]);
    hint.id = `agent-description-${id}`;
    const connectionStatus = node('span', 'agent-row-status');
    const help = node('p', 'agent-row-error');
    help.id = `agent-error-${id}`;
    description.append(heading, hint, connectionStatus, help);
    const button = node('button', 'agent-connect');
    button.type = 'button';
    button.dataset.agentId = id;
    button.dataset.action = 'connect';
    button.setAttribute('aria-describedby', hint.id);
    button.onclick = () => connect(id, button);
    row.append(description, button);
    host.append(row);
    return { id, name: spec.name, row, connectionStatus, help, button };
  });

  function render() {
    const connection = current?.connection;
    const working = isTaskBusy(current);
    const disabled = !current || !!pendingAgent || working || connection === 'connecting';
    const sessionError = connection === 'ready' && current?.status === 'error';
    const label = connection === 'ready' ? sessionError ? '需要处理' : working ? '工作中' : '已连接'
      : connection === 'authentication' ? '需要认证' : connection === 'error' ? '连接待处理' : '连接中';
    let announcement = '';
    for (const { id, name, row, connectionStatus, help, button } of rows) {
      const active = id === current?.provider;
      const connecting = id === pendingAgent;
      const action = connecting ? '连接中…' : active ? '重新连接' : '连接';
      const helpText = attemptError?.id === id ? attemptError.text : active && !connecting ? agentConnectionHelp(current) : '';
      row.dataset.active = String(active);
      connectionStatus.hidden = !active || connecting;
      const text = active ? `当前使用 · ${label}` : '';
      if (connectionStatus.textContent !== text) connectionStatus.textContent = text;
      connectionStatus.dataset.state = active ? sessionError ? 'error' : connection : '';
      help.hidden = !helpText;
      if (help.textContent !== helpText) help.textContent = helpText;
      if (!pendingAgent && (attemptError ? id === attemptError.id : active && !working && connection !== 'connecting')) {
        announcement = helpText || `${name} · ${label}`;
      }
      if (button.textContent !== action) {
        button.textContent = action;
        button.setAttribute('aria-label', `${action} ${name}`);
      }
      button.disabled = disabled;
    }
    if (notice.textContent !== announcement) notice.textContent = announcement;
  }

  const guide = document.getElementById('agent-setup-guide');
  guide.onclick = async event => {
    event.preventDefault();
    try { await response(api.openLink(guide.href)); }
    catch (error) { notice.textContent = error.message; }
  };
  render();
  return state => {
    if (!pendingAgent && (current?.provider !== state.provider || state.connection === 'connecting')) attemptError = null;
    current = state;
    render();
  };
}
