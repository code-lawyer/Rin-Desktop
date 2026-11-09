const BUILTIN_AGENTS = Object.freeze({
  codex: { name: 'Codex', binaryEnv: 'VIBE_CODEX_BINARY' },
  claude: { name: 'Claude', binaryEnv: 'VIBE_CLAUDE_BINARY', experimental: true, help: '安装原生 Claude Code CLI，并在启动应用前配置 ANTHROPIC_API_KEY 或官方支持的云平台 API 认证，再重新连接。API 单独计费；Rin 不提供 Claude 订阅登录或订阅额度，也不会替你创建或切换付费凭据。' },
  grok: { name: 'Grok Build', binaryEnv: 'VIBE_GROK_BINARY', experimental: true, help: '在自己的终端运行 grok，按原生提示完成登录，然后重新连接。应用复用 Grok 已保存的登录。' },
  opencode: { name: 'OpenCode', binaryEnv: 'VIBE_OPENCODE_BINARY', experimental: true, help: '使用 OpenCode V2；在终端运行 opencode auth login 登录所需模型提供商，然后重新连接。免费模型可按 OpenCode 自身规则使用。' },
});
let agents = BUILTIN_AGENTS;
const isCustomAgentId = id => typeof id === 'string' && /^custom-[a-z0-9][a-z0-9-]{0,47}$/.test(id);
const isStoredCliAgent = id => Object.hasOwn(BUILTIN_AGENTS, id) || isCustomAgentId(id);
// Only display metadata crosses into the renderer. Executables, arguments and
// authentication configuration remain in the main process.
function setCustomAgents(entries = []) {
  const custom = {};
  for (const entry of entries) {
    if (!isCustomAgentId(entry?.id) || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 80 || Object.hasOwn(custom, entry.id)) throw new Error('自定义 Agent 名称或标识无效。');
    custom[entry.id] = Object.freeze({ name: entry.name.trim(), custom: true, experimental: true, help: '请先在自己的终端完成该 Agent 的认证，再重新连接。可在“壁纸与设置 → Agent”中修改配置；外部修改后点击“重新读取”。' });
  }
  agents = Object.freeze({ ...BUILTIN_AGENTS, ...custom });
}
module.exports = {
  get AGENTS() { return agents; },
  agentName: id => agents[id]?.name ?? (id === 'dots' ? '凛（Dots）' : 'Agent'),
  isCliAgent: id => Object.hasOwn(agents, id), isCustomAgentId, isStoredCliAgent, setCustomAgents,
  customAgentChoices: () => Object.entries(agents).filter(([, spec]) => spec.custom).map(([id, spec]) => ({ id, name: spec.name })),
};
