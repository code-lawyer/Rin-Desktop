const CLAUDE_SDK_VERSION = '0.3.240';
const CLAUDE_API_NOTE = 'Anthropic 要求第三方接入使用 API 认证，API 单独计费。';

const AGENTS = Object.freeze({
  codex: Object.freeze({
    name: 'Codex', adapter: 'codex', binaryName: 'codex', binaryEnv: 'VIBE_CODEX_BINARY',
  }),
  antigravity: Object.freeze({
    name: 'Antigravity CLI', adapter: 'acp', binaryName: 'agy', binaryEnv: 'VIBE_ANTIGRAVITY_BINARY', experimental: true,
    acpArgs: Object.freeze(['acp']),
    help: '在 Windows 终端运行 agy 完成 Google 登录，也可用 agy acp --login，再重新连接。Rin 通过官方 ACP 接口沿用 CLI 登录，模型与额度由 Google 账号决定。',
    permissionHint: '工具审批遵循 Antigravity 的原生权限规则。已设为自动允许或拒绝的操作不会弹窗。',
  }),
  grok: Object.freeze({
    name: 'Grok Build', adapter: 'acp', binaryName: 'grok', binaryEnv: 'VIBE_GROK_BINARY', experimental: true,
    acpArgs: Object.freeze(['--no-auto-update', '--permission-mode', 'default', '--no-subagents', 'agent', '--no-leader', 'stdio']),
    help: '在自己的终端运行 grok，按原生提示完成登录，然后重新连接。应用复用 Grok 已保存的登录，模型与额度由 xAI 账号决定。',
  }),
  claude: Object.freeze({
    name: 'Claude Agent', adapter: 'claude', binaryName: 'claude', binaryEnv: 'VIBE_CLAUDE_BINARY', experimental: true,
    help: '请在启动 Rin 前配置 ANTHROPIC_API_KEY 或受支持的云平台 API 认证。',
  }),
  deepseek: Object.freeze({
    name: 'DeepSeek Harness', adapter: 'acp', binaryName: 'dsh', binaryEnv: 'VIBE_DEEPSEEK_BINARY', experimental: true,
    acpArgs: Object.freeze(['--profile', 'acp']),
    help: '请安装支持 ACP 的 dsh，在 DeepSeek Harness 中为 acp 配置模型和认证，再重新连接。登录与计费由该配置使用的模型服务管理。',
    permissionHint: 'Harness 已允许的操作遵循其本地规则。缺少操作详情的审批请求将被拒绝。',
  }),
});

const isCliAgent = id => typeof id === 'string' && Object.hasOwn(AGENTS, id);

// Read legacy draft keys without registering or starting their old providers.
const isStoredCliAgent = id => isCliAgent(id) || id === 'opencode' ||
  typeof id === 'string' && /^custom-[a-z0-9][a-z0-9-]{0,47}$/.test(id);

module.exports = {
  AGENTS, CLAUDE_SDK_VERSION, CLAUDE_API_NOTE, isCliAgent, isStoredCliAgent,
  agentName: id => isCliAgent(id) ? AGENTS[id].name : id === 'dots' ? '凛（Dots）' : 'Agent',
};
