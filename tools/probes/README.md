# 协议验证工具

本目录承载可维护的独立协议验证，不由普通应用启动自动执行。

- `rpc-client.mjs`、`stdio-transport.mjs`、`websocket-transport.mjs`、`turn-observer.mjs`：既有协议和观察基础；根测试覆盖其纯逻辑与测试回环连接。
- `codex-probe.mjs`：默认帮助；`--run` 检查本机 CLI 与登录，`--create-thread` 创建隔离会话，`--live-turn` 还会发送真实测试任务。
- `codex-tui-probe.mjs`：默认帮助；`--run` 创建独立会话并发送两次真实提示词，`--with-tui` 还会打开原生终端界面。使用前确认账户与任务范围。
- `windows-preflight.ps1`：默认帮助；`-Run` 才读取系统/设备信息与 CLI 版本。
- [cli-agents](cli-agents/README.md)：从临时目录迁入的 Claude/ACP 验收源码；默认只显示帮助，显式 `--run` 才使用真实 CLI 账户与 fixture。

测试分层、证据要求及副作用见[开发测试规范](../../docs/development/testing.md)。设备验证在 [remote-diagnostics](../remote-diagnostics/README.md)，已知业务缺陷的无真实账户复现在 [qa](../qa/README.md)。

上述 Codex/Windows 工具每次在 `work/qa` 创建唯一运行目录，报告名为 `result.json`。Node 工具可传 `--output=work/qa/新的目录`，PowerShell 用 `-OutputDirectory work/qa/新的目录`；拒绝已有目录和 QA 目录外路径。旧 `docs/evidence` 中的日期报告保持原样。CLI 版本可以用 `--expected-version` 锁定；历史版本的通过不代表其他版本兼容。
