# CLI 独立验收探针

由原本放在临时工作目录的 Claude/ACP 探针迁入。复用主应用锁定的 SDK，不复制 CLI、账号或额外 node_modules。历史运行记录留在本机原目录；新运行写入 Git 忽略的 `work/qa/cli-agents`，每次创建独立 fixture 和报告。

先执行根目录与主应用的 `npm ci`，并自行安装、登录需要验证的 Windows 原生 CLI。默认查找 `claude.exe`、`grok.exe`、`opencode.exe`；非 PATH 安装可设置 `PROBE_CLAUDE_BINARY`、`PROBE_GROK_BINARY`、`PROBE_OPENCODE_BINARY` 为绝对路径。

无 `--run` 时只显示帮助，不读取登录、不创建 fixture、不调用推理。普通 `npm test` 和 CI 不运行这些真实账户测试。

```powershell
node tools/probes/cli-agents/claude-probe.mjs --help
node tools/probes/cli-agents/acp-probe.mjs grok --help
```

人工验收时，下面的命令会使用 CLI 账户额度、发送固定测试文本，在新建 fixture 中测试写文件审批与拒绝、运行和取消一个计时进程、提问、退出及恢复。测试中的允许/拒绝只针对约定的 fixture 操作。执行者须先确认账户、CLI 路径与测试范围。

```powershell
node tools/probes/cli-agents/claude-probe.mjs --run
node tools/probes/cli-agents/acp-probe.mjs grok --run --full
node tools/probes/cli-agents/acp-probe.mjs opencode --run --full
```

隔离依靠独立目录、协议配置和工具请求检查，不是操作系统沙箱。原生 CLI 仍管理其账户和会话。报告可能含测试会话、目录和固定测试正文，只保存在私人工作目录；对外仅提供脱敏摘要。返回 0/1/2 分别表示本探针的通过、失败、条件阻塞；不代表桌面主应用已通过验收。当前接口、测试限制和主应用验收清单见[测试规范](../../../docs/development/testing.md)。
