const AGENTS = Object.freeze({
  codex: { name: 'Codex', binaryEnv: 'VIBE_CODEX_BINARY' },
  claude: { name: 'Claude', binaryEnv: 'VIBE_CLAUDE_BINARY', experimental: true, help: '安装原生 Claude Code CLI，并在启动应用前配置 ANTHROPIC_API_KEY 或官方支持的云平台 API 认证，再重新连接。API 单独计费；Rin 不提供 Claude 订阅登录或订阅额度，也不会替你创建或切换付费凭据。' },
  grok: { name: 'Grok Build', binaryEnv: 'VIBE_GROK_BINARY', experimental: true, help: '在自己的终端运行 grok，按原生提示完成登录，然后重新连接。应用复用 Grok 已保存的登录。' },
  opencode: { name: 'OpenCode', binaryEnv: 'VIBE_OPENCODE_BINARY', experimental: true, help: '使用 OpenCode V2；在终端运行 opencode auth login 登录所需模型提供商，然后重新连接。免费模型可按 OpenCode 自身规则使用。' },
});
module.exports = { AGENTS, agentName: id => AGENTS[id]?.name ?? (id === 'dots' ? '凛（Dots）' : 'Agent'), isCliAgent: id => Object.hasOwn(AGENTS, id) };
