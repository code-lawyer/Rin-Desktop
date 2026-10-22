# CLI Agent 接入

状态更新：2026-10-22。0.5.0 保留 Codex，并以实验能力提供 Claude、Grok Build、OpenCode V2。三个新增后端在选择器和包清单中明确标为实验功能。已完成会话并发/关闭、历史恢复、最终回复与草稿保留的离线回归及前端构建；逐家真实账户、任务、权限、中断、朗读与新安装包验收仍未完成。隔离探针结果不代表主应用完整验收，0.5.0 的实际验收范围以仓库发布记录为准。

源码开发的日期化验证记录位于 `docs/development/review-fixes.md`，下一步以 `docs/development/progress.md` 为准；这两个文件是开发仓库文档，不要求安装包用户准备它们。

## 启动与选择

安装用户从开始菜单打开 Rin Desktop，或运行便携目录中的 `VibeVoice.exe`。源码开发者按仓库构建说明在仓库根目录准备依赖并运行 `npm start`。气泡设置里的 **Agent** 下拉框，以及工作台左侧的 **Agent** 下拉框均可切换；下次启动沿用上次选择。也可运行 `npm start -- --provider=claude`，有效值为 `codex`、`claude`、`grok`、`opencode`。运行中的任务需先停止。

应用使用当前 Windows 用户自行安装的原生 CLI，不使用 WSL 程序或 shell 包装命令。自动查找 PATH、用户 `.local/bin`、`.grok/bin`、`.opencode/bin`、WinGet Links；Claude 也识别 WinGet 包安装位置。找不到时，在启动前设置下表环境变量，值必须是原生 `.exe` 的绝对路径。

| Agent | 安装与认证 | 自定义程序路径 |
| --- | --- | --- |
| Codex | 保持原有 `codex login` / ChatGPT 登录流程 | `VIBE_CODEX_BINARY` |
| Claude | 安装 [Claude Code 原生 CLI](https://code.claude.com/docs/en/setup)，自行配置 `ANTHROPIC_API_KEY` 或官方支持的云平台 API 认证；API 单独计费，不提供订阅登录/额度 | `VIBE_CLAUDE_BINARY` |
| Grok Build | [官方仓库](https://github.com/xai-org/grok-build)；在终端运行 `grok` 完成原生登录 | `VIBE_GROK_BINARY` |
| OpenCode | [V2 安装](https://opencode.ai/v2/docs/)；`opencode auth login` 登录模型提供商。免费模型按 OpenCode 自身规则使用 | `VIBE_OPENCODE_BINARY` |

例如 PowerShell：`$env:VIBE_OPENCODE_BINARY = 'D:\Tools\OpenCode\opencode.exe'`，然后从同一个终端启动 Rin。API Key 同样由本机环境提供，请勿写进项目代码。环境变量变更后需完全退出并重启；只更新 CLI 已保存的登录时，可点击 **重新连接**。应用不读取或复制凭据文件，不将账户标识或密钥传到界面。

## 使用

- 工作台按当前 Agent 显示原生会话；可以预览历史、继续会话或新建会话。
- 流式回复、成功完成提醒、现有听写和朗读功能继续可用。
- 审批显示操作详情或文件差异，支持单次允许、拒绝、停止。没有单次允许选项时，不会改用永久授权。
- 问题支持文本、选项和多选；OpenCode 表单还支持布尔值、数值和可选字段。多选使用 Ctrl/Shift 选择多项；补充答案填在下方字段。
- **停止**取消待审批请求并发送原生取消，待本轮收尾后再开放输入。超时会关闭本次 CLI 进程，重连后可恢复会话。
- 模型来自 CLI 返回的列表；支持推理强度时显示对应选项。
- Grok/OpenCode 重命名仅修改 Rin 的显示名称；Claude/Codex 使用原生重命名接口。
- 恢复失败保留原生会话编号，可重连重试或明确新建会话；新建不会删除旧会话。

## 原生配置与权限

Claude 使用官方 Agent SDK `0.3.240` 调用用户安装的原生 CLI，调研基线为 `2.1.240`。使用 CLI 返回的实际 API 认证类型；只有订阅 OAuth 或无法确认 API 认证时，连接被拒绝并保留会话与草稿。不自动创建、替换凭据或切换计费来源。默认不加载用户/项目文件设置、hooks 或外部 MCP；使用 Claude Code 系统提示和交互权限，写入、shell 等工具明确请求审批。账户状态读取成功不等于真实请求一定能通过认证。

Grok 使用 ACP v1，调研基线为 `1.0.60`。运行独立 `--no-leader` 进程，在该进程内同步 `ask` 审批模式；处理问题与 pre-tool hook 扩展。关闭自动更新和子 Agent；未实现的扩展拒绝处理。目录信任和 MCP 认证/问答需在原生 CLI 中处理。没有改写全局设置。

OpenCode 使用 V2 ACP v1，调研基线为 `2.0.32`，不兼容 V1 配置格式。保留原生项目、全局和 Agent 配置。**审批取决于原生权限规则，自动允许的操作不会弹窗。** 需要逐次审批时，由用户在自己的 `opencode.jsonc` 中配置，例如：

```json
{
  "permissions": [
    { "action": "edit", "resource": "*", "effect": "ask" },
    { "action": "shell", "resource": "*", "effect": "ask" },
    { "action": "external_directory", "resource": "*", "effect": "ask" }
  ]
}
```

规则还受 Agent 和托管配置影响，见 [OpenCode 权限说明](https://opencode.ai/v2/docs/permissions/)。不同 CLI 的权限能力不同，以上审批不构成 Windows 操作系统沙箱。

## 数据与发布

原有 Codex 会话和草稿保持兼容。新增 Agent 的显示缓存位于应用数据目录下 `agents/claude`、`agents/grok`、`agents/opencode`，包括会话元数据、最近 200 条显示消息和本地名称；完整历史仍由 CLI 保存。草稿以 Agent、项目和会话共同定位。切换 Agent 不迁移聊天上下文。

发布脚本包含两个协议 SDK、必要依赖及其许可证，不打包三家的 CLI 程序或账号信息。`portable.json` 的 `experimentalBackends` 与界面标识都来自同一份 Agent catalog。当前已完成无账户契约并随 0.5.0 分发实验入口，真实账户/主应用验收仍未完成，不能标为正式支持。发送前保存原稿，不明回执先核查，不能自动重发。详见[交付说明](../../docs/development/data-agent-validation.md)和[验收表](../../docs/development/test-acceptance.md)。

## 用户手动验收

1. 准备 CLI 登录或 API 凭据，启动 Rin，选择 Agent，在独立文件夹创建会话。
2. 确认流式文字、模型选择和问题回答；让 Agent 修改测试文件，分别允许和拒绝一次。
3. 分别在生成文字、运行工具、等待审批时停止，再发送新问题。
4. 让会话记住随机标记，退出应用，再启动或从历史列表恢复，检查上下文。
5. 切换不同 Agent，检查列表、名称和未发送草稿没有混用。

Claude 只按 API Key 或官方云平台 API 认证验收。按照[官方 SDK 说明](https://code.claude.com/docs/en/agent-sdk/overview)，未经批准的第三方产品不能提供 claude.ai 订阅登录或额度；本项目没有此类批准，不能将个人终端登录成功当作产品支持。

实现参考：[Claude SDK](https://code.claude.com/docs/en/agent-sdk/quickstart)、[Claude 审批与问题](https://code.claude.com/docs/en/agent-sdk/user-input)、[ACP 协议](https://agentclientprotocol.com/protocol/overview)、[OpenCode ACP](https://opencode.ai/v2/docs/cli/acp/)、[Grok ACP 源码](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs)。
