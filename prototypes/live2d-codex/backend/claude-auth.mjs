// Use the CLI's resolved backend, not environment-variable presence or a
// separate login-status command, so every entry enforces the same billing rule.
export function claudeAuthentication(account) {
  const provider = account?.apiProvider;
  if (['bedrock', 'vertex', 'foundry', 'anthropicAws', 'anthropicGoogleCloud', 'mantle', 'gateway'].includes(provider)) return '云平台 API 认证（按提供商计费）';
  if ((!provider || provider === 'firstParty') && ['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key'].includes(account?.apiKeySource)) return 'API 凭据（按量计费）';
  const error = new Error('Claude 需要 API 凭据或官方支持的云平台 API 认证。Rin 不提供订阅登录或订阅额度；请自行配置认证后重新连接，现有会话和草稿已保留。');
  error.code = -32000;
  throw error;
}
