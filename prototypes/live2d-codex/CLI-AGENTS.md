# CLI Agent 接入

Agent 设置提供 Codex、Google Antigravity CLI、Grok Build、Claude Agent 和 DeepSeek Harness。Codex 为默认 Agent，其余四项带实验标识。支持范围见 [项目状态](../../docs/project-status.md)。安装版以包内 `resources/app/portable.json` 为准。

## 安装与连接

在 Windows 当前用户下准备所选 CLI。Codex、Antigravity 和 Grok 由官方 CLI 读取已有登录态，并按账户与计划使用该 CLI 可用的额度。Rin 不需要你重复登录或另配 API Key。每家计费和额度均由原生 CLI 和服务商管理。

| Agent | 准备方式 | 程序路径变量 |
| --- | --- | --- |
| Codex | 安装 [Codex CLI](https://learn.chatgpt.com/docs/codex/cli)，运行 `codex login` 登录 ChatGPT，可用 `codex login status` 检查 | `VIBE_CODEX_BINARY` |
| Google Antigravity | 安装带 ACP 的 [Antigravity CLI](https://antigravity.google/docs/cli-getting-started)，运行 `agy` 完成 Google 登录。连接提示需要认证时，可用 `agy acp --login` 登录后重连 | `VIBE_ANTIGRAVITY_BINARY` |
| Grok Build | 安装 [Grok Build](https://docs.x.ai/build/overview)，运行 `grok` 完成浏览器登录 | `VIBE_GROK_BINARY` |
| Claude Agent | 准备 [Claude Code CLI](https://code.claude.com/docs/en/setup)、官方 Agent SDK 与 API 认证，见下节 | `VIBE_CLAUDE_BINARY` |
| DeepSeek Harness | 准备官方 `dsh` 命令，并在 Harness 中配置 ACP profile 可访问的模型和认证。详见下节 | `VIBE_DEEPSEEK_BINARY` |

打开 **工作台 → 壁纸与设置 → Agent**，或从侧栏点击 **选择与管理**。每行有接入说明和连接状态，点击 **连接** 或 **重新连接**。气泡设置和工作台侧栏也提供同一组 Agent 的快捷切换。切换前需先完成或停止当前任务。下次启动沿用上次选择。

源码可从仓库根目录运行 `npm start -- --provider=antigravity`，其他内置值为 `codex`、`grok`、`claude`、`deepseek`。旧版本保存的 OpenCode 或自定义 Agent 选择在当前源码会回退到 Codex。旧配置、会话记录和草稿仍保留在磁盘上。

CLI 已更新登录时，可以直接重连。如果改过 PATH 或认证环境变量，请完全退出 Rin，再从更新过环境的终端启动。含空格的程序路径按绝对路径设置，如 PowerShell 中的 `$env:VIBE_ANTIGRAVITY_BINARY = 'C:\Tools\agy.exe'`。认证变量只在本机环境设置，请勿写进项目代码。

## Claude Agent 仅使用 API

Rin 通过官方 Agent SDK 调用用户安装的 Claude Code，以 CLI 返回的实际认证类型确认 API 接入。Anthropic 的第三方产品指引要求通过 Claude Console API Key 或受支持的云服务认证接入 Claude。用量由你的 API 提供商单独计费。[Anthropic 认证与凭据说明](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)

使用安装版时，在装好 Claude Code CLI 后，通过 Node.js 和 npm 从上游安装 SDK。多个 Rin 版本可共用此用户目录。源码用户通过项目的 `npm ci` 准备 SDK。

```powershell
npm install --prefix "$env:LOCALAPPDATA\VibeVoice\agent-dependencies\claude" --registry=https://registry.npmjs.org --omit=optional --ignore-scripts "@anthropic-ai/claude-agent-sdk@0.3.240"
```

在启动 Rin 的环境中配置 `ANTHROPIC_API_KEY` 或受支持的云平台 API 认证，然后在 Agent 页连接。

连接时如仅检测到订阅 OAuth 或无法确认 API 认证，Rin 会提示配置 API 凭据。Rin 默认使用 Claude Code 系统提示和交互权限，写入与 shell 等工具需要明确审批。默认不加载用户或项目设置文件中的 hooks 和外部 MCP。账户状态读取成功之后，还需用真实请求验证凭据。

## DeepSeek Harness

用 Node.js 24.9 或以上版本运行 `npm install -g @deepseek-ai/dsh`，在新开的 Windows 终端中运行 `dsh --version`。Rin 可定位 npm 安装中的 CLI 入口。自定义安装位置可将 `VIBE_DEEPSEEK_BINARY` 指向该 npm 安装的 `dsh.cmd` 或原生 `dsh.exe` 的绝对路径。已经使用 Harness 桌面版的用户也需准备上述 CLI。

Rin 使用官方 `dsh --profile acp`。ACP 进程可以沿用 Harness 用户目录的共享配置和凭据，以及 ACP profile 自己的设置。桌面版独有的模型、插件与权限设置属于另一个 profile，需要在 ACP profile 或共享配置里另行准备。支持现有模型配置的前提是 ACP profile 能访问该模型及其认证。[Harness 命令与 profile](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md) · [Harness 模型配置](https://deepseek-harness.github.io/deepseek-harness/en/guide/providers)

官方 ACP 支持续接原会话，历史预览使用 Rin 最近 200 条显示缓存。协议可能只提供审批请求编号，缺少命令、文件或其他操作详情时，Rin 会拒绝该请求，避免让用户批准未知操作。当前官方 ACP 不提供问答卡或工具过程回放。[Harness ACP 源码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/src/index.ts)

## 会话、权限与数据

- 会话归所属 Agent 和项目。支持原生回放时，Rin 用原生历史预览；仅支持恢复时，可继续原上下文，历史预览用本机缓存。无缓存时，已有原生会话也可能没有历史可预览。
- 恢复失败会保留原会话和草稿，可重连重试或新建对话。发送回执无法确认时会保留原稿。CLI 未提供原生历史回放时，需在原生 CLI 中手动核对。
- 模型和推理强度来自 CLI。工具审批按 CLI 实际发出的请求显示，提供的单次允许与拒绝选项可在 Rin 中使用。已经由原生规则允许的操作可能不发出审批提示。
- 问题卡由 CLI 原生问题请求触发。可用形式取决于 CLI 和当前模式。多选可用 Ctrl 或 Shift 选择，超出选择数量限制时保留问题卡供修改。
- 停止会取消待审批请求并通知 CLI，等本轮收尾后可继续输入。超时会关闭这次连接，重连后可以尝试恢复会话。
- ACP Agent 的重命名只在 Rin 内生效。Claude 和 Codex 用各自的原生重命名接口。
- 完整历史和凭据由 CLI 管理。应用数据的 `agents/<id>` 只保存原生会话编号、名称、项目路径和最近显示消息。草稿按 Agent、项目和会话区分。数据位置与处理见 [隐私与数据](../../docs/privacy.md)。

Grok 使用独立的 ACP 进程，按需请求单次审批；目录信任、MCP 认证等请在 CLI 中处理。Antigravity 的目录信任、权限与模型能力也以本机 CLI 为准。原生 CLI 的工具规则决定权限，Rin 的审批界面不额外提供操作系统沙箱。

## 用户验收

在独立测试项目连接已认证的 CLI，创建会话并发送无害任务，验证回复、完成提示及退回错误的行为。分别检查允许和拒绝实际工具操作、问题回答、生成中停止、重连和退出重开。仅支持 resume 的 Agent 需检查上下文标记可续接以及历史缓存提示。切换 Agent 后，列表和未发送草稿应各归其项目和 Agent。

按 [Agent 实机矩阵](../../tools/release/TEST-ACCEPTANCE.md#agent-实机矩阵) 记录各家支持范围。离线回归可从仓库根目录运行 `npm run test:agents`。握手或合成测试通过仍需完成真实账户请求和应用内验收。
