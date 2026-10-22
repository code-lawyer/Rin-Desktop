# Rin Desktop 项目计划

当前开发入口为[开发手册](docs/development/README.md)，具体施工状态以[统一施工清单](docs/development/progress.md)为准。更新日期为 2026-10-22。公开仓库继续使用 [code-lawyer/Rin-Desktop](https://github.com/code-lawyer/Rin-Desktop)，整个根目录沿用同一 Git 历史。

目标：Windows 动态壁纸、Agent 工作台、本机语音与 RC003 蓝牙遥控器形成统一操作体验。0.5.0 统一壁纸、Codex、本机语音、数据保护与遥控操作；RC003和新多CLI作为实验能力分发，完整产品验收仍在后续阶段。

| 顺序 | 工作 | 完成标准 |
| --- | --- | --- |
| 1（已完成） | 统一入口、文件归档、开发交接和 GitHub 归属 | 入口一致；20 个文件迁移；完整开发手册与施工台账；数据保留及自动检查通过 |
| 2（已完成限定范围） | 修复本轮审查问题、收敛旧验收工具 | 6项新增问题和FIX-01/02/03已修复；含复核追加的两处竞态，离线回归通过 |
| 2.1（已完成离线范围） | DATA-01/02、Agent 契约与测试候选 | 原稿保护、未知发送核查、数据事务/恢复、106 项专项通过；独立候选交用户实测 |
| 3 | RC003 与 Codex 的产品闭环 | 设备按下/松开→本地识别→绑定会话的草稿→确认发送→审批/停止/回复；连续操作、重连、休眠与安装验收 |
| 4 | 新多 CLI 的完整支持 | Claude/Grok/OpenCode 分别完成真实任务、权限、恢复、草稿隔离、语音及安装包验证 |

台账持续维护当前任务和 127 项旧编号归并，数量以生成进度表为准。最新数据保护及协议结果见[本轮交付](docs/development/data-agent-validation.md)，阶段门槛见[开发计划](docs/development/roadmap.md)。RC003 主流程源码已接入；下一步按[测试包验收清单](docs/development/test-acceptance.md)完成真实账户、设备和安装验证，0.5.0 发布范围和检查结果见[发布审查](docs/release-audit.md)，不将实验入口计为完整正式支持。

源码统一入口为 `npm start` 或根目录 `启动 Rin Desktop.cmd`；只读状态用 `npm run status`，环境检查用 `npm start -- --check`。安装版仍从开始菜单启动。开发与分发见 [构建说明](docs/build.md)，当前文档导航见 [文档索引](docs/README.md)。

早期“保留原 CLI TUI＋控制面板”的 WPF 方案属于历史设计。原 v0.2 计划在本机 `docs/history/PROJECT_PLAN-v0.2.md` 保留，v0.1 原文亦保留；它们不再代表当前项目进度。
