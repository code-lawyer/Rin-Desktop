// Use the CLI's resolved backend, not environment-variable presence or a
// separate login-status command, so every entry enforces the same billing rule.
export function claudeAuthentication(account) {
  const provider = account?.apiProvider;
  const source = account?.apiKeySource;
  const token = account?.tokenSource;
  // A resolved bearer credential can take precedence over a configured API key.
  const apiKeySelected = !token || token === 'none' || token === 'apiKeyHelper' && source === 'apiKeyHelper';
  if (!account?.subscriptionType) {
    if (['bedrock', 'vertex', 'foundry', 'anthropicAws', 'anthropicGoogleCloud', 'mantle'].includes(provider)) return '云平台 API 认证（按提供商计费）';
    if ((!provider || provider === 'firstParty') && apiKeySelected && ['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key'].includes(source)) return 'API 凭据（按量计费）';
  }
  const error = new Error('Anthropic 不允许第三方应用代用户使用 Claude 订阅凭据。请配置 API 凭据或受支持的云平台 API 认证后重新连接。API 单独计费。');
  error.code = -32000;
  throw error;
}
