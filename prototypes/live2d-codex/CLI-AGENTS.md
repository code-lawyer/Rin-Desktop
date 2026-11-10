# CLI Agent 接入

已发布0.6.2保留Codex，并继续以实验能力提供Claude、Grok Build、OpenCode V2。三个新增后端在选择器和包清单中明确标为实验功能。已有会话操作竞争/关闭、历史恢复、最终回复与草稿保留的离线回归；这不表示支持多任务并发。当前候选的 Codex/Grok 已完成本机各 20 项主应用任务、真实审批、中断、重连和草稿恢复检查；Claude/OpenCode 尚待有效认证，各家完整矩阵仍须分别验收。实际安装版本以包内 `portable.json` 为准。


## 启动与选择

安装用户从开始菜单打开 Rin Desktop，或运行便携目录中的 `VibeVoice.exe`。源码开发者按仓库构建说明在仓库根目录准备依赖并运行 `npm start`。

当前源码在 **工作台 → 壁纸与设置 → Agent** 统一列出 Codex、Claude、Grok Build、OpenCode 和已添加的自定义 Agent；侧栏 **选择与管理** 可直接打开此页。每行显示接入类型及当前连接状态，点击 **连接** 或 **重新连接** 即可使用；自定义项还可编辑、删除。添加和接入帮助也在同一页。自定义配置格式出错时，内置 Agent 仍可连接，错误提示保留以便修复。

连接已建立但旧会话或项目恢复失败时，页面显示“需要处理”和具体原因；按提示重试恢复或明确新建对话。键盘或遥控器发起连接后，焦点回到同一行的重连按钮；等待期间主动移到其他控件时，不会被移回。

气泡设置里的 **Agent** 下拉框，以及工作台左侧的 **Agent** 下拉框仍可快速切换同一组 Agent；下次启动沿用上次选择。也可运行 `npm start -- --provider=claude`，内置值为 `codex`、`claude`、`grok`、`opencode`；当前源码另支持下文注册的 `custom-` 标识。运行中的任务需先停止。

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
- CLI 发出问题请求时，问题卡支持文本、选项和多选；OpenCode 表单还支持布尔值、数值和可选字段。多选使用 Ctrl/Shift 选择多项；补充答案填在下方字段。问题工具受原生 CLI/运行模式限制；Rin 不会把普通问句自动变成问题卡，当前也不提供 Codex 计划模式切换。本机 Codex 默认模式未触发问题工具，Grok 问题卡已实际验证。
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

发布脚本包含两个协议SDK、必要依赖及其许可证，不打包三家的CLI程序或账号信息。`portable.json` 的 `experimentalBackends` 与界面标识都来自同一份Agent catalog。实验入口自0.5.0提供，0.6.2继续保持该边界；无账户契约已通过，真实账户/主应用验收仍未完成，不能标为正式支持。发送前保存原稿，不明回执先核查，不能自动重发。逐项验证见[验收表](../../tools/release/TEST-ACCEPTANCE.md)。

## 自定义 Agent 接口（实验功能）

从 0.6.3-rc.3 起，可通过设置界面接入 **ACP v1 / stdio** Agent，无需修改 Rin 或重新编译前端。加入选择器不表示该 Agent 已通过实机验收。

### 在设置界面管理

打开 **工作台 → 壁纸与设置 → Agent**（或侧栏 **选择与管理**）。自定义 Agent 与内置 Agent 使用同一列表，无需手动修改 JSON：

1. 点击 **添加 Agent**，填写显示名称，点击 **选择程序…** 选择 Windows `.exe`。
2. 如需启动参数，点击 **添加参数**，按顺序逐项填写。路径含空格时也只填一项，不额外加引号。使用脚本桥接时选择 `node.exe` 等解释器，再把脚本绝对路径填为一个参数。
3. 点击 **保存 Agent**。成功后两个 Agent 选择器立即更新；失败时错误显示在表单的保存按钮旁，保留输入供修改重试。点击列表中的 **连接** 才启动该程序。连接完成只表示协议与会话已建立，不代表已验证模型回复。
4. 点击 **编辑** 可调整名称、程序和参数。当前 Agent 的连接保持不变，点击 **重新连接** 后使用新配置。已有接入的 ID 固定，以保留会话和草稿归属；可选认证方法位于“高级选项”。
5. 删除前有一次界面确认，仅移除接入配置，不删除会话、草稿或程序。正在使用的 Agent 需先切换到其他 Agent，再删除。

保存会备份上一版配置，使用同路径 `.lock` 排他写锁并检查外部修改。若其他 Agent 改过文件，保存会报冲突并保留输入；点击 **重新读取** 获取最新配置，有未保存编辑时需明确确认是否放弃。外部写入者须遵守相同锁协议；对绕过写锁的任意编辑，哈希检查不能保证完全避免并发覆盖。若异常退出遗留写锁，让 Agent 确认所有写入程序已停止后清理，应用不会自行抢占。格式错误时保留原文件和上次有效配置，可把下方提示词交给 Agent 修复。退出会等待正在进行的保存，失败时取消退出并保留编辑；执行中的任务不会因编辑配置而被停止。

### 让 Agent 帮你接入

在同一页面下方展开 **让 Agent 帮你接入其他助手**，可填写目标 Agent 名称，再点 **复制接入提示词**，粘贴给能够访问本机的 Agent。留空时，提示词指向你正在使用的 Agent。复制内容自动带上当前实际配置路径，适用于源码、测试版、正式版以及自选数据目录；“查看提示词”可展开全文。它不会自动发消息或替你填写密钥。

提示词要求对方检查真实安装及 ACP 支持、合并配置、保留现有数据、验证协议连接并报告未测边界。处理完后，回到此页点 **重新读取**，再点击 **连接**。没有本机权限的 Agent 应给出能直接填入表单的字段。

下面是可单独复制的通用提示词；界面按钮提供的版本还会自动补齐具体路径：

```text
请帮我把我正在使用的这个 Agent 接入 Windows 上的 Rin Desktop。如果不能确定目标 Agent，只需先问我它的产品或客户端名称。

先检查本机安装和官方文档，确认真实的 ACP v1 stdio 启动方式。配置文件位置以 Rin“壁纸与设置 → Agent → 配置位置与使用说明”显示的实际路径为准，不要猜测测试版或正式版目录。

配置格式为 {"format":1,"agents":[{"id":"custom-my-agent","name":"显示名称","protocol":"acp","command":"Windows .exe 绝对路径","args":["逐项参数"]}]}。示例 ID 请替换为实际的唯一标识；id 使用 custom- 前缀，后接 1–48 个小写字母、数字或连字符，首字符不能是连字符。脚本可由 node.exe 等解释器启动，脚本也用绝对路径；不要拼接 shell 命令。仅在对端声明且确实需要时填写 authMethodId。

写入前用独占创建（Node fs.open 的 wx，或等价 CreateNew）取得“配置文件完整路径 + .lock”的锁；已有锁则等待或报告占用，不删除别人的锁。持锁后读取最新文件并备份，只合并这个 Agent，保留其他配置、会话、草稿和发送记录；已有接入保留原 ID。写入同目录临时文件并刷新后原子替换配置，在 finally 中关闭并删除自己取得的锁。发现外部修改时重新读取后合并；异常退出遗留锁只有确认所有写入程序已停止后才清理。认证使用原生 CLI 或本机环境，不把密钥放入配置、参数或回复。

用独立临时连接验证 initialize 返回版本 1、创建会话并关闭测试进程。Rin 不提供 ACP 文件读写、终端执行或交互登录终端服务，对端须能自行处理。不要发送模型任务、修改项目文件，或把握手成功称为模型回复已验证。不支持 ACP 或需要我登录时如实说明下一步。

完成后告诉我接入名称、已验证项目和未完成事项，让我回到 Rin 点击“重新读取”，再点击“连接”。若你无法操作本机文件，请提供可直接填入设置界面的名称、程序路径、逐项参数和可选认证方法，不要求我手动编辑 JSON。
```

### 配置文件接口（供 Agent 和开发者使用）

设置界面自动保存 `custom-agents.json`。源码默认数据位于仓库的 `work/runtime/avatar`；安装版数据位置见[隐私与数据](../../docs/privacy.md)。启动前设置 `VIBE_AGENT_CONFIG` 可指定另一份配置文件的绝对路径，界面也会读写这份文件。应用只使用这个指定配置，不扫描当前工作项目内的配置。

下面的程序和参数仅为格式示例，请替换为目标 Agent 实际的 ACP 启动方式：

```json
{
  "format": 1,
  "agents": [
    {
      "id": "custom-my-agent",
      "name": "My Agent",
      "protocol": "acp",
      "command": "C:\\Tools\\MyAgent\\agent.exe",
      "args": ["acp"]
    }
  ]
}
```

外部修改文件后，在 Agent 设置点击 **重新读取**，无需重启。两个选择器会出现「My Agent（自定义 · 实验）」。源码也可用 `npm start -- --provider=custom-my-agent` 选择。已有连接在重新连接后使用新配置；若外部文件移除了当前 Agent，先切换到其他 Agent 再重新读取。在独立测试项目检查下方验收项。

| 字段 | 约定 |
| --- | --- |
| `format` | 固定为 `1`；一份配置最多 32 个 Agent、64 KiB |
| `id` | `custom-` 前缀，后接 1–48 个小写字母、数字或连字符，首字符不能是连字符；必须唯一，不能覆盖内置 Agent |
| `name` | 选择器显示名，1–80 个字符 |
| `protocol` | 固定为 `acp`；当前协商协议版本为 1 |
| `command` | 可执行文件绝对路径，Windows 下必须为 `.exe`；可以是原生 Agent，也可以是运行桥接脚本的 `node.exe` 等解释器 |
| `args` | 必填字符串数组，无参数时为 `[]`。每个参数单独一项，不额外套 shell 引号；脚本、配置等文件参数建议使用绝对路径，因为进程工作目录是当前项目 |
| `authMethodId` | 可选；填写该 Agent 在 ACP 初始化中实际声明的认证方法 ID，创建会话前调用。省略时不自动选择认证方式 |

例如 Node 桥接程序可使用 `"command": "C:\\Program Files\\nodejs\\node.exe"`，配合 `"args": ["C:\\Tools\\MyAgent\\bridge.mjs", "--stdio"]`。这里不执行 `npx`、`.cmd` 或拼接的 shell 命令，也不自动安装依赖。

配置只接受表内字段。启动时遇到语法错误、重复 ID 或无效字段，会停用自定义配置并显示原因；运行中重新读取失败则保留上次有效配置。内置 Agent 始终可选择。程序文件缺失时在连接时报错。选择器只收到 ID 和名称，程序路径、参数及认证方法仅通过工作台专用接口提供给设置编辑界面。

认证复用原生 CLI 状态或启动环境；不要把 API Key 放进 JSON 或启动参数。自定义程序继承 Rin 的进程环境，以当前 Windows 用户权限运行，请仅配置自己信任的程序。Rin 不改变它的原生权限规则；只有 Agent 发出审批请求时才会弹卡片，自动允许的工具不会额外弹窗。客户端不提供 ACP 文件读写、终端执行或交互登录终端能力，依赖这些能力的 Agent 需要自行实现相应操作或另作适配。

通用能力包括文字流、工具进度、单次审批、停止、表单问题、原生模型与推理强度选项，具体可用项取决于对端。无 `session/list` 能力时列出 Rin 已知的会话。当前源码按初始化声明选择恢复方式：

| Agent 声明的能力 | 继续已有会话 | 历史显示 |
| --- | --- | --- |
| `loadSession` | 优先调用 `session/load`，即使同时支持 resume | 合并原生回放与已缓存的完成/中断状态 |
| 仅 `sessionCapabilities.resume` | 调用 `session/resume`，保留原会话 ID | 保留本机最近 200 条显示缓存；没有缓存时旧消息不可见，但可以继续上下文 |
| 两者均无 | 明确提示不支持恢复，由用户选择新建对话 | 保留旧会话和本机记录，不静默替换上下文 |

`resume` 不回放历史，不能用空回放替换本机记录。恢复失败保留原会话与缓存，不因 load 失败自动改用 resume。历史列表会说明本机缓存的限制；发送核查不把显示缓存当作原生送达证据，没有远端历史时继续保留不确定状态和原稿，不自动重发。连接帮助只在认证错误时显示认证指引，能力不足、会话缺失或连接中断按对应错误处理。源码与已发布安装包的差异见[当前状态](../../docs/project-status.md)。

每个自定义 Agent 的显示缓存位于 `agents/<id>`，草稿和发送记录也按 ID 隔离。删除配置不会删除数据；恢复相同 ID 可重新访问原有记录。不要把旧 ID 改用于另一个 Agent，否则它会尝试使用旧会话编号。

### 给非 ACP Agent 编写桥接程序

普通终端输出或 OpenAI 兼容 HTTP 接口不能直接填入此入口。可以用任意语言编写独立进程，将目标 Agent 的 SDK、HTTP 或私有协议转换成 ACP，再将它注册为 `command` / `args`。

| ACP 接口 | 桥接职责 |
| --- | --- |
| `initialize` | 返回版本 `1`、实际能力、Agent 信息和可用认证方法 |
| `session/new` | 按传入的项目目录创建会话，返回稳定会话 ID |
| `session/prompt` / `session/update` | 接收文字任务，以 `agent_message_chunk` 和工具事件流式更新，完成后返回 `end_turn` |
| `session/cancel` | 停止当前任务和待审批工具，原 prompt 返回 `cancelled` |
| `session/request_permission` | 将需要批准的工具交给 Rin，提供 `allow_once` / `reject_once`，严格等待决定后执行 |
| `session/load` | 可选；声明 `loadSession` 后恢复上下文，并在返回前回放历史 |
| `session/resume` | 可选；声明 `sessionCapabilities.resume` 后恢复原会话上下文，不回放历史 |
| `session/list` | 可选；声明 `sessionCapabilities.list` 后提供会话列表 |
| `authenticate` / `elicitation/create` | 按需实现认证与表单问题；自定义接入不支持 Agent 私有扩展 |

传输使用按行分隔的 JSON-RPC：stdin 接收、stdout 只输出协议消息，诊断日志写 stderr。协议说明见 [ACP v1 初始化](https://agentclientprotocol.com/protocol/v1/initialization)与[会话建立和恢复](https://agentclientprotocol.com/protocol/v1/session-setup)。离线回归运行根目录 `npm run test:agents`，不会调用真实账户；新增真实 Agent 仍需单独完成下列验收。

## 用户手动验收

1. 准备 CLI 登录或 API 凭据，启动 Rin，选择 Agent，在独立文件夹创建会话。
2. 确认流式文字、模型选择和问题回答；让 Agent 修改测试文件，分别允许和拒绝一次。
3. 分别在生成文字、运行工具、等待审批时停止，再发送新问题。
4. 让会话记住随机标记，退出应用，再启动或从历史列表恢复，检查上下文、原会话 ID 与消息顺序。仅支持 resume 的 Agent 还需检查本机缓存及“没有缓存”的提示；窗口重连、完全退出后重开与系统重启分别验收。
5. 切换不同 Agent，检查列表、名称和未发送草稿没有混用。

Claude 只按 API Key 或官方云平台 API 认证验收。按照[官方 SDK 说明](https://code.claude.com/docs/en/agent-sdk/overview)，未经批准的第三方产品不能提供 claude.ai 订阅登录或额度；本项目没有此类批准，不能将个人终端登录成功当作产品支持。

实现参考：[Claude SDK](https://code.claude.com/docs/en/agent-sdk/quickstart)、[Claude 审批与问题](https://code.claude.com/docs/en/agent-sdk/user-input)、[ACP 协议](https://agentclientprotocol.com/protocol/overview)、[OpenCode ACP](https://opencode.ai/v2/docs/cli/acp/)、[Grok ACP 源码](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs)。
