// Recovery and startup failures must not acquire unrelated authentication advice.
// The same decision is used by the bubble, workbench and custom Agent settings.
export function agentConnectionHelp(state) {
  if (state?.connection === 'authentication') {
    const help = state.loginHelp || (state.provider === 'codex'
      ? '使用你自己的 ChatGPT 账户登录 Codex。凭据由官方 CLI 保存在本机。'
      : '请在自己的终端完成该 Agent 的认证，再重新连接。');
    return [state.error, help].filter(Boolean).join('\n\n');
  }
  // Codex can keep its transport ready while the saved session or project
  // still needs recovery. That state must retain its actionable error.
  if (state?.connection === 'ready' && state.status === 'error') {
    return state.error || '当前会话需要处理，请重新连接或新建对话。';
  }
  return state?.connection === 'error' ? state.error || '连接未就绪，请重新连接。' : '';
}
