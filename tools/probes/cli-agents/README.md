# CLI 独立验收探针

探针复用主应用锁定的 SDK。新运行在 Git 忽略的 `work/qa/cli-agents` 中创建独立项目和报告。

先执行根目录与主应用的 `npm ci`，并按 [CLI Agent 指南](../../../prototypes/live2d-codex/CLI-AGENTS.md) 准备所需 CLI。ACP 探针沿用应用的程序查找和启动环境。可用 `PROBE_GROK_BINARY`、`PROBE_ANTIGRAVITY_BINARY`、`PROBE_DEEPSEEK_BINARY` 或 `PROBE_CLAUDE_BINARY` 覆盖探针使用的路径。

Claude 与主应用共用 `claude-auth.mjs`：每次启动或恢复进程后，先读取 SDK 解析的 accountInfo，确认 API key 或受支持的云 API 认证，再发送第一条测试请求。纯订阅 OAuth 或未知来源返回条件阻塞，不尝试切换认证或计费来源。CLI 的登录状态不能替代这项检查；API/云 API 的费用由执行者自行承担。

无 `--run` 时只显示帮助，不读取登录、不创建 fixture、不调用推理。普通 `npm test` 和 CI 不运行这些真实账户测试。取消用例通过每次新建的私有控制管道观察计时进程；清理时关闭管道，由计时进程自行退出，不读取可改写的 PID 文件来终止进程。等待工具或审批期间也会立即接收当前请求的失败结果。


```powershell
node tools/probes/cli-agents/claude-probe.mjs --help
node tools/probes/cli-agents/acp-probe.mjs grok --help
```

经授权运行时，探针使用 CLI 账户额度发送固定文本，检查回复和恢复上下文。Claude 和 Grok 的扩展用例还会在测试项目里检查工具审批、停止和提问。DeepSeek 支持单独检查 ACP 建立和恢复会话，`--handshake` 不发送模型提示。

```powershell
node tools/probes/cli-agents/claude-probe.mjs --run
node tools/probes/cli-agents/acp-probe.mjs grok --run --full
npm run probe:antigravity -- --run
npm run probe:deepseek -- --run --handshake
```

隔离依靠独立目录、协议配置和工具请求检查，不是操作系统沙箱。原生 CLI 仍管理其账户和会话。报告可能含测试会话、目录和固定测试正文，只保存在私人工作目录；对外仅提供脱敏摘要。返回 0/1/2 分别表示本探针的通过、失败、条件阻塞；不代表桌面主应用已通过验收。当前接口、测试限制和主应用验收清单见[验收清单](../../release/TEST-ACCEPTANCE.md)。
