# 开发进度与统一施工清单

由 backlog.json 与 legacy-mapping.json 生成，更新日期 2026-10-22。修改 JSON 后运行 `npm run project:docs`；不要直接编辑本页。

已验证限定范围 34 项；已实现待验收 11 项；施工中 4 项；待施工 5 项；后置 4 项。这些数量不是产品完成百分比；已验证项仅对任务写明的范围有效。

施工中：REM-05、REL-02、REL-03、ART-02。

可开始的待施工项（前置已验收，按优先级排列）：UI-02、DEC-02。阶段顺序和源码同步安排见[开发计划](roadmap.md)。

| ID | 工作 | 状态 | 优先级 | 前置任务 | 责任角色 |
| --- | --- | --- | --- | --- | --- |
| ORG-01 | 全目录盘点与保护基线 | 已验证限定范围 | P1 | 无 | 项目维护 |
| ORG-02 | 统一源码启动与状态命令 | 已验证限定范围 | P1 | 无 | 开发工具 |
| ORG-03 | 旧方案归档与验证脚本迁移 | 已验证限定范围 | P1 | ORG-01 | 项目维护 |
| ORG-04 | 独立开发文档与统一施工台账 | 已验证限定范围 | P1 | ORG-01 | 项目维护 |
| BASE-01 | 动态壁纸、气泡、工作台和人物设置 | 已验证限定范围 | P1 | 无 | 桌面界面 |
| BASE-02 | Codex 会话、流式回复、审批与模型设置 | 已验证限定范围 | P1 | 无 | Agent 适配 |
| BASE-03 | 电脑麦克风听写与会话草稿 | 已验证限定范围 | P1 | 无 | 本地语音 |
| BASE-04 | 本地模型下载、按需载入与回复朗读 | 已验证限定范围 | P1 | 无 | 本地语音 |
| BASE-05 | 既有安装器、发布资源与源码 CI | 已验证限定范围 | P1 | 无 | 构建发布 |
| BASE-06 | 通用快捷键与遥控按键映射 | 已验证限定范围 | P2 | 无 | 输入交互 |
| FIX-01 | 修复 Kokoro 加载失败后的清理和状态 | 已验证限定范围 | P1 | ORG-04 | 本地语音 |
| FIX-02 | 修复 Codex 连接中关闭的竞态 | 已验证限定范围 | P1 | ORG-04 | Agent 适配 |
| FIX-03 | 统一新 Agent 完成回复与自动朗读的文本 | 已验证限定范围 | P1 | ORG-04 | Agent/语音 |
| DATA-01 | 提交回执不明时保留草稿与核查 | 已验证限定范围 | P1 | FIX-02 | 会话数据 |
| DATA-02 | 存储迁移、路径别名和崩溃恢复验收 | 已验证限定范围 | P1 | ORG-04 | 会话数据 |
| UI-01 | 遥控器全菜单导航与独立审批操作 | 已实现待验收 | P1 | BASE-01 | 桌面交互 |
| UI-02 | 缩放、桌面重建和显示环境验收 | 待施工 | P2 | BASE-01 | 桌面界面 |
| REM-01 | RC003 Raw Input 与 ATVV 可行性诊断 | 已验证限定范围 | P1 | 无 | 设备输入 |
| REM-02 | 主应用 RC003 设备连接与按键生命周期 | 已实现待验收 | P1 | REM-01、FIX-02 | 设备输入 |
| REM-03 | RC003 音频接入捕获目标和草稿 | 已实现待验收 | P1 | REM-02、BASE-03、FIX-01 | 设备/语音 |
| REM-04 | 遥控确认发送、中断、朗读及审批 | 已实现待验收 | P1 | REM-02、UI-01、DATA-01 | 输入交互 |
| REM-05 | RC003 连续操作与休眠重连验收 | 施工中 | P1 | REM-03、REM-04 | 硬件验收 |
| REM-06 | 遥控组件安装与退出验收 | 已实现待验收 | P1 | REM-05、REL-01 | 构建发布 |
| AGT-01 | Claude/Grok/OpenCode 源码适配器 | 已验证限定范围 | P1 | 无 | Agent 适配 |
| AGT-02 | 新 Agent 的统一契约和失败路径测试 | 已验证限定范围 | P1 | AGT-01、FIX-03 | Agent 适配 |
| AGT-03 | Claude 主应用真实验收 | 待施工 | P1 | AGT-02、DEC-01、FIX-01、FIX-02 | Agent 验收 |
| AGT-04 | Grok 主应用真实验收 | 待施工 | P1 | AGT-02、DEC-01、FIX-03 | Agent 验收 |
| AGT-05 | OpenCode 主应用真实验收 | 待施工 | P1 | AGT-02、DEC-01、FIX-03 | Agent 验收 |
| AGT-06 | 跨 provider 会话与草稿隔离 | 已实现待验收 | P1 | AGT-01、DATA-02 | 会话数据 |
| REL-01 | 当前源码安装候选与数据恢复验收 | 已实现待验收 | P1 | FIX-01、FIX-02、FIX-03、DATA-02、AGT-02 | 构建发布 |
| REL-02 | 本批源码提交同步与 upstream | 施工中 | P2 | ORG-03、ORG-04 | 仓库维护 |
| REL-03 | 下一应用版本发布验收 | 施工中 | P1 | REL-01、SEC-01、UI-02 | 构建发布 |
| DEC-01 | 确认新增后端的账户和计费边界 | 已实现待验收 | P1 | AGT-01 | 产品/Agent |
| DEC-02 | 明确原 TUI 共存与并发任务的后续定位 | 待施工 | P2 | 无 | 产品/架构 |
| SEC-01 | 新增后端的日志、凭据和依赖审计 | 已实现待验收 | P1 | AGT-02、DEC-01 | 隐私/发布 |
| PRIVATE-01 | 私人 Dots 通道保留与隔离 | 已验证限定范围 | P2 | 无 | 私人扩展 |
| FUT-01 | 有限语音操作意图 | 后置 | P3 | REM-05 | 交互设计 |
| ART-01 | 精细 Live2D 可行性调研与现有绑定核查 | 已验证限定范围 | P2 | BASE-01 | 美术/渲染 |
| ART-02 | 女生 Live2D 半身样例与独立预览 | 施工中 | P2 | BASE-01、ART-01 | 美术/渲染 |
| ART-03 | 已下载动态壁纸的源码检查与接入调研 | 已验证限定范围 | P2 | BASE-01、ART-01 | 美术/渲染 |
| FUT-02 | 更精细人物绑定与扩展素材 | 后置 | P3 | BASE-01、ART-01、ART-02 | 美术/渲染 |
| FUT-03 | 多屏、多硬件和跨平台 | 后置 | P3 | REM-05 | 平台架构 |
| FUT-04 | 多个后台任务与同目录并发控制 | 后置 | P3 | DEC-02、DATA-01 | 会话架构 |
| FIX-04 | 统一会话切换锁与旧连接释放所有权 | 已验证限定范围 | P1 | ORG-04 | Agent 适配 |
| FIX-05 | 恢复原生历史时保留轮次结果和朗读资格 | 已验证限定范围 | P1 | ORG-04 | Agent/语音 |
| DATA-03 | 保留超过100条的未发送草稿 | 已验证限定范围 | P1 | ORG-04 | 会话数据 |
| TOOL-01 | 探针报告使用新运行目录并保护历史证据 | 已验证限定范围 | P2 | ORG-04 | 开发工具 |
| TOOL-02 | 显式运行门槛与旧GUI验收工具收敛 | 已验证限定范围 | P2 | ORG-04 | 开发工具 |
| DOC-01 | 更新当前指南与实验Agent支持口径 | 已验证限定范围 | P3 | ORG-04 | 项目维护 |
| FIX-06 | 退出时等待后端替换并释放未发布实例 | 已验证限定范围 | P1 | FIX-02 | 主进程 |
| FIX-07 | 隔离电脑听写取消、重录与晚到识别 | 已验证限定范围 | P2 | BASE-03 | 语音/交互 |
| FIX-08 | 旧原生Agent缓存缺失轮次结果时禁止朗读 | 已验证限定范围 | P2 | FIX-05 | Agent适配 |
| TOOL-03 | 清理失效提示入口并统一RC003状态说明 | 已验证限定范围 | P2 | TOOL-02、ORG-03 | 开发工具/项目维护 |
| UI-03 | 遥控草稿闭环与对话设置界面整理 | 已实现待验收 | P1 | UI-01、REM-03、REM-04 | 桌面交互 |
| REM-07 | 遥控媒体音量键与应用播报音量 | 已实现待验收 | P1 | REM-02、BASE-03 | 设备/语音 |
| FIX-09 | 旧听写结束仅清理自身超时保护 | 已验证限定范围 | P2 | FIX-07 | 桌面/数据 |
| FIX-10 | 未决发送记录保护项目入口 | 已验证限定范围 | P2 | DATA-01 | 桌面/数据 |
| REL-04 | 发布版本一致与产物覆盖保护 | 已验证限定范围 | P2 | 无 | 构建发布 |

## ORG-01 全目录盘点与保护基线

状态：已验证限定范围；阶段：organization；责任角色：项目维护。

实现位置：[docs/development/repository-map.md](repository-map.md)。

依赖：无。原编号：B-01、D-14。

验收条件：

- 全目录文件登记；活动数据、模型、第三方依赖与源码可区分；迁移前源文件有备份。

下一动作：新增顶层目录时同步目录规则。

证据：[docs/development/repository-map.md](repository-map.md) — 本轮枚举 66,846 个文件；368 个项目文本文件备份，私人完整清单留在本机。（local-audit-summary）

## ORG-02 统一源码启动与状态命令

状态：已验证限定范围；阶段：organization；责任角色：开发工具。

实现位置：[tools/project/start.mjs](../../tools/project/start.mjs)、[tools/project/launch.ps1](../../tools/project/launch.ps1)、[tests/project-launcher.test.mjs](../../tests/project-launcher.test.mjs)。

依赖：无。原编号：R-02、B-07、B-23、T-20、K-10。

验收条件：

- 所有兼容入口选择当前源码；保留原数据；错误可见；Windows 路径与编码回归通过。

下一动作：修改启动参数时维护启动回归。

证据：[tests/project-launcher.test.mjs](../../tests/project-launcher.test.mjs) — 12 项启动回归覆盖旧包回退、失败交接、参数与编码。（source-or-test）

## ORG-03 旧方案归档与验证脚本迁移

状态：已验证限定范围；阶段：organization；责任角色：项目维护。

实现位置：[tools/qa/reproduce-known-issues.mjs](../../tools/qa/reproduce-known-issues.mjs)、[tools/probes/cli-agents/README.md](../../tools/probes/cli-agents/README.md)、[docs/development/repository-map.md](repository-map.md)。

依赖：ORG-01。原编号：D-15。

验收条件：

- 20 个文件迁移有去向与校验记录；旧工具保留兼容入口；旧证据与用户数据保持；新工具脱离个人路径。

下一动作：新增验证工具放入 tools，运行输出放入 work/qa；继续保留旧证据和兼容入口。

证据：[docs/development/verification.md](verification.md) — 20 个文件完成迁移；旧入口、锁定 SDK、全文件保护与公开检查通过，原 Git 配置保持。（organization-verification）

## ORG-04 独立开发文档与统一施工台账

状态：已验证限定范围；阶段：organization；责任角色：项目维护。

实现位置：[docs/development/README.md](README.md)、[docs/development/backlog.json](backlog.json)、[tools/project/check-project.mjs](../../tools/project/check-project.mjs)。

依赖：ORG-01。原编号：B-06、B-25、B-28、D-09。

验收条件：

- 项目目标、真实技术路线、数据/接口、计划、进度与验收齐备；旧编号全部归并；生成页与台账一致；公共文档无私人依赖。

下一动作：继续以JSON台账维护进度；后续重点为硬件稳定性、真实新增Agent与完整安装/显示矩阵。

证据：[docs/development/verification.md](verification.md) — 完整开发手册、40 项任务与 127 条旧事项归并通过自动检查；独立公开源码副本和两轴复核通过。（handoff-verification）

## BASE-01 动态壁纸、气泡、工作台和人物设置

状态：已验证限定范围；阶段：baseline；责任角色：桌面界面。

实现位置：[prototypes/live2d-codex/main.cjs](../../prototypes/live2d-codex/main.cjs)、[prototypes/live2d-codex/renderer/app.js](../../prototypes/live2d-codex/renderer/app.js)、[prototypes/live2d-codex/renderer/workbench.js](../../prototypes/live2d-codex/renderer/workbench.js)。

依赖：无。原编号：R-21、B-11、D-03。

验收条件：

- 已发布 0.4.0 的单屏壁纸、对话气泡、工作台与两人物选择保留。

下一动作：涉及 UI 变更时运行人物恢复与布局验收。

证据：[docs/release-audit.md](../release-audit.md) — 0.4.0 源码及安装包人物失败恢复、切换、重启验收；不代表全部机器兼容。（release）

## BASE-02 Codex 会话、流式回复、审批与模型设置

状态：已验证限定范围；阶段：baseline；责任角色：Agent 适配。

实现位置：[prototypes/live2d-codex/backend/codex.mjs](../../prototypes/live2d-codex/backend/codex.mjs)、[prototypes/live2d-codex/backend/rpc.mjs](../../prototypes/live2d-codex/backend/rpc.mjs)、[prototypes/live2d-codex/tests/companion.test.mjs](../../prototypes/live2d-codex/tests/companion.test.mjs)。

依赖：无。原编号：R-12、R-13、R-14、R-16、R-19、R-20、R-22、R-29、R-35、B-02、B-10、B-13、T-09、T-11、T-13、T-15、T-16、S-01、D-04、D-07、D-10、D-14。

验收条件：

- 保留已发布 Codex 工作流；已知关闭竞态独立归入 FIX-02。

下一动作：协议升级时重跑契约与真实任务验收。

证据：[docs/release-audit.md](../release-audit.md) — 原生 CLI 登录、任务、追问、重启恢复已有发布证据，生命周期缺陷不被此结论掩盖。（release）

## BASE-03 电脑麦克风听写与会话草稿

状态：已验证限定范围；阶段：baseline；责任角色：本地语音。

实现位置：[prototypes/live2d-codex/renderer/app.js](../../prototypes/live2d-codex/renderer/app.js)、[prototypes/live2d-codex/renderer/draft-session.mjs](../../prototypes/live2d-codex/renderer/draft-session.mjs)、[prototypes/live2d-codex/tests/draft-session.test.mjs](../../prototypes/live2d-codex/tests/draft-session.test.mjs)。

依赖：无。原编号：G-02、G-04、R-05、R-07、R-08、R-09、R-10、R-25、B-04、B-08、B-16、B-17、T-02、T-05、T-06、T-07、T-18、S-04、D-02、D-06、K-04。

验收条件：

- 本地听写先回填当前捕获目标的草稿，由用户确认发送。

下一动作：RC003 接入复用此边界，重新验证目标切换。

证据：[docs/project-status.md](../project-status.md) — 现有电脑麦克风流程与草稿回归；不包含 RC003 专用音频。（recorded-baseline）

## BASE-04 本地模型下载、按需载入与回复朗读

状态：已验证限定范围；阶段：baseline；责任角色：本地语音。

实现位置：[prototypes/live2d-codex/backend/voice-resources.mjs](../../prototypes/live2d-codex/backend/voice-resources.mjs)、[prototypes/live2d-codex/backend/voice-runtime.mjs](../../prototypes/live2d-codex/backend/voice-runtime.mjs)、[prototypes/live2d-codex/backend/resident-speech.mjs](../../prototypes/live2d-codex/backend/resident-speech.mjs)、[prototypes/live2d-codex/voice-resources.json](../../prototypes/live2d-codex/voice-resources.json)。

依赖：无。原编号：G-04、R-02、R-07、B-04、B-16、B-23、D-02、K-10。

验收条件：

- 保留固定清单、哈希校验、独立 worker、手动/自动朗读；异常问题另跟踪 FIX-01/03。

下一动作：改动清单或运行时后做全新目录下载与退出验收。

证据：[docs/release-audit.md](../release-audit.md) — SenseVoice/Kokoro/Qwen 下载、真实载入、合成和生命周期的已发布范围。（release）

## BASE-05 既有安装器、发布资源与源码 CI

状态：已验证限定范围；阶段：baseline；责任角色：构建发布。

实现位置：[tools/release/build.mjs](../../tools/release/build.mjs)、[tools/release/installer.iss](../../tools/release/installer.iss)、[.github/workflows/check.yml](../../.github/workflows/check.yml)。

依赖：无。原编号：G-05、R-01、R-31、B-07、B-25、B-26、T-21、S-05。

验收条件：

- 0.4.0 发布链与资源来源保持，不把当前工作区称为新发布包。

下一动作：当前未发布功能进入 REL-01/03 的新验收。

证据：[docs/release-audit.md](../release-audit.md) — 0.4.0 安装包文件哈希及既有卸载保留数据记录。（release）

## BASE-06 通用快捷键与遥控按键映射

状态：已验证限定范围；阶段：baseline；责任角色：输入交互。

实现位置：[prototypes/live2d-codex/backend/input-actions.cjs](../../prototypes/live2d-codex/backend/input-actions.cjs)、[prototypes/live2d-codex/tests/input-actions.test.mjs](../../prototypes/live2d-codex/tests/input-actions.test.mjs)。

依赖：无。原编号：R-03、R-27、R-33、T-03、D-05。

验收条件：

- 现有全局快捷键映射与冲突提示保持；不宣称能辨认 RC003 来源或接收蓝牙音频。

下一动作：原生设备接入时防止和全局快捷键重复触发。

证据：[prototypes/live2d-codex/tests/input-actions.test.mjs](../../prototypes/live2d-codex/tests/input-actions.test.mjs) — 通用输入注册/去重/挂起边界的自动测试。（source-or-test）

## FIX-01 修复 Kokoro 加载失败后的清理和状态

状态：已验证限定范围；阶段：stability；责任角色：本地语音。

实现位置：[prototypes/live2d-codex/backend/resident-speech.mjs](../../prototypes/live2d-codex/backend/resident-speech.mjs)、[prototypes/live2d-codex/tests/resident-speech.test.mjs](../../prototypes/live2d-codex/tests/resident-speech.test.mjs)、[tools/qa/reproduce-known-issues.mjs](../../tools/qa/reproduce-known-issues.mjs)、[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs)。

依赖：ORG-04。原编号：B-16、T-06。

验收条件：

- 同步或异步 close 都能清理；模型加载错误仍可见；不残留 loading 或未处理 rejection；复现通过。

下一动作：维护失败路径回归；真实账户、声音和安装验收仍按 AGT/REL 任务执行。

证据：[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs) — 同步/异步及抛错 close、重试、旧清理晚到和资源退出均有回归；最小复现通过。（offline-regression）

## FIX-02 修复 Codex 连接中关闭的竞态

状态：已验证限定范围；阶段：stability；责任角色：Agent 适配。

实现位置：[prototypes/live2d-codex/backend/codex.mjs](../../prototypes/live2d-codex/backend/codex.mjs)、[prototypes/live2d-codex/tests/companion.test.mjs](../../prototypes/live2d-codex/tests/companion.test.mjs)、[tools/qa/reproduce-known-issues.mjs](../../tools/qa/reproduce-known-issues.mjs)、[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs)。

依赖：ORG-04。原编号：R-16、R-24、R-29、B-02、B-10、B-12、B-24、T-13、T-17、S-01。

验收条件：

- close 后不再启动后端；连接返回晚到时不恢复状态；所拥有进程与 RPC 完成释放。

下一动作：维护失败路径回归；真实账户、声音和安装验收仍按 AGT/REL 任务执行。

证据：[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs) — 文件探测及协议初始化中关闭后不再启动/复活；共享操作生命周期；最小复现通过。（offline-regression）

## FIX-03 统一新 Agent 完成回复与自动朗读的文本

状态：已验证限定范围；阶段：stability；责任角色：Agent/语音。

实现位置：[prototypes/live2d-codex/backend/native-agent.mjs](../../prototypes/live2d-codex/backend/native-agent.mjs)、[prototypes/live2d-codex/renderer/current-reply.mjs](../../prototypes/live2d-codex/renderer/current-reply.mjs)、[prototypes/live2d-codex/renderer/reply-audio.mjs](../../prototypes/live2d-codex/renderer/reply-audio.mjs)、[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs)。

依赖：ORG-04。原编号：新增工作。

验收条件：

- 多段回复后完成事件、可见最终回复和朗读触发条件一致；工具消息不误播；中断不自动朗读。

下一动作：维护失败路径回归；真实账户、声音和安装验收仍按 AGT/REL 任务执行。

证据：[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs) — 后端事件和renderer共用最终回复选择；多段回复/工具与中断资格回归，最小复现通过。（offline-regression）

## DATA-01 提交回执不明时保留草稿与核查

状态：已验证限定范围；阶段：stability；责任角色：会话数据。

实现位置：[prototypes/live2d-codex/backend/submission-guard.mjs](../../prototypes/live2d-codex/backend/submission-guard.mjs)、[prototypes/live2d-codex/renderer/draft-session.mjs](../../prototypes/live2d-codex/renderer/draft-session.mjs)、[prototypes/live2d-codex/tests/submission-safety.test.mjs](../../prototypes/live2d-codex/tests/submission-safety.test.mjs)。

依赖：FIX-02。原编号：G-02、R-10、R-11、R-21、B-08、B-18、T-08、K-01、K-02。

验收条件：

- 离线模拟服务端接收但回执丢失、重启、确认写盘失败及首次建会话；发送前持久化原稿，显示未知状态，只读原生历史核查，不自动重发；真实主应用验收留在 REL-01 和各后端任务。

下一动作：按测试包 D1–D5 场景进行用户实测；保持离线回归。

证据：[prototypes/live2d-codex/tests/submission-safety.test.mjs](../../prototypes/live2d-codex/tests/submission-safety.test.mjs) — 11 项发送保护回归通过，包含三个新增 provider 的本地排队与原生确认区别。（offline-regression）；[docs/development/data-agent-validation.md](data-agent-validation.md) — 状态机、核查条件、失败保留、隐私与剩余实机边界。（offline-regression）

## DATA-02 存储迁移、路径别名和崩溃恢复验收

状态：已验证限定范围；阶段：stability；责任角色：会话数据。

实现位置：[prototypes/live2d-codex/backend/workspace-store.mjs](../../prototypes/live2d-codex/backend/workspace-store.mjs)、[prototypes/live2d-codex/backend/durable-json.mjs](../../prototypes/live2d-codex/backend/durable-json.mjs)、[prototypes/live2d-codex/backend/data-directory.mjs](../../prototypes/live2d-codex/backend/data-directory.mjs)、[prototypes/live2d-codex/backend/data-recovery.mjs](../../prototypes/live2d-codex/backend/data-recovery.mjs)、[prototypes/live2d-codex/tests/data-safety.test.mjs](../../prototypes/live2d-codex/tests/data-safety.test.mjs)。

依赖：ORG-04。原编号：R-08、R-12、R-25、B-09、B-24、T-07、T-10、D-11。

验收条件：

- 旧格式/数据目录采用、丢失项目、大小写/目录联接、并发草稿、打开/同步/替换故障、损坏记录、只写新目录恢复有离线证据；不覆盖原数据；真实安装/升级/回滚归 REL-01。

下一动作：用用户的数据副本执行 D6–D10 与 REL-01；备份不替代独立数据备份和实际断电验证。

证据：[prototypes/live2d-codex/tests/data-safety.test.mjs](../../prototypes/live2d-codex/tests/data-safety.test.mjs) — 13 项数据回归通过，含真实临时 Windows junction、恢复副本、测试数据隔离及目录指针失效。（offline-regression）；[docs/development/data-agent-validation.md](data-agent-validation.md) — 迁移兼容、写入失败和恢复工具的可复现说明。（offline-regression）

## UI-01 遥控器全菜单导航与独立审批操作

状态：已实现待验收；阶段：remote；责任角色：桌面交互。

实现位置：[prototypes/live2d-codex/renderer/remote-ui.mjs](../../prototypes/live2d-codex/renderer/remote-ui.mjs)、[prototypes/live2d-codex/renderer/workbench.html](../../prototypes/live2d-codex/renderer/workbench.html)、[prototypes/live2d-codex/renderer/app.js](../../prototypes/live2d-codex/renderer/app.js)。

依赖：BASE-01。原编号：G-01、R-18、R-22、B-11、B-14、T-01、T-16、T-22、D-10。

验收条件：

- 项目、会话、模型和取消可用方向键/确认/返回完成；普通确认不代替权限审批；焦点可见。

下一动作：按新测试候选实测草稿确认发送、清空重录/撤销、右键朗读、菜单和审批导航；补 REM-05 真实设备证据。

证据：[docs/development/remote-integration.md](remote-integration.md) — 2026-10-21：主应用内连接、按钮设置、原生来源判断、麦克风到原目标草稿、休眠/退出及打包已接线；离线回归、组件编译/管道和复制依赖的 Electron 加载通过。真实硬件、输入法、多设备及安装验收待完成。（source-and-offline）；[prototypes/live2d-codex/tests/remote-integration.test.mjs](../../prototypes/live2d-codex/tests/remote-integration.test.mjs) — 模拟连接、按键去重、音频解码、目标草稿、断线/取消旧结果及输入共存。（offline-tests）；[prototypes/live2d-codex/tests/remote-ui.test.mjs](../../prototypes/live2d-codex/tests/remote-ui.test.mjs) — 手动连接取消、迟到结果与审批二次确认的界面回归。（offline-tests）；[docs/development/remote-controls-ui.md](remote-controls-ui.md) — 2026-10-22：遥控草稿确认发送、清空/撤销、固定朗读入口及分类设置已接入；离线功能和真实 renderer 布局检查通过。音量 Consumer Control 编译/自检及播放增益回归通过，物理键待验收。（source-offline-and-renderer）；[docs/development/release-0.5.0-review.md](release-0.5.0-review.md) — 修复六分类确认及项目/会话列表刷新导致的遥控焦点丢失，真实 renderer 的导航/字段保留检查通过。（source-offline-review）

## UI-02 缩放、桌面重建和显示环境验收

状态：待施工；阶段：release；责任角色：桌面界面。

实现位置：[prototypes/live2d-codex/backend/wallpaper-host.cjs](../../prototypes/live2d-codex/backend/wallpaper-host.cjs)、[prototypes/live2d-codex/scripts/verify-character-switch.mjs](../../prototypes/live2d-codex/scripts/verify-character-switch.mjs)。

依赖：BASE-01。原编号：T-22。

验收条件：

- 125%/150% 缩放、锁屏/唤醒、Explorer 重启、分辨率变化有记录；多屏未经实现不作兼容承诺。

下一动作：建立单屏实机矩阵和稳定恢复步骤。

证据：尚无完成验收记录，不能标为完成。

## REM-01 RC003 Raw Input 与 ATVV 可行性诊断

状态：已验证限定范围；阶段：remote；责任角色：设备输入。

实现位置：[tools/remote-diagnostics/session.mjs](../../tools/remote-diagnostics/session.mjs)、[tools/remote-diagnostics/atvv.py](../../tools/remote-diagnostics/atvv.py)、[tests/remote-buttons.test.mjs](../../tests/remote-buttons.test.mjs)。

依赖：无。原编号：R-04、R-34、B-03、B-15、S-03、D-08、D-14。

验收条件：

- 一次真实按键/音频/本地识别成功可追溯；明确它不是主应用集成验收。

下一动作：作为下一步适配器输入，不据单次成功宣布稳定。

证据：[docs/project-status.md](../project-status.md) — 2026-10-20：389 帧、5.835 秒、识别约 2.984 秒及短语匹配；完整私人记录本地保留。（hardware-summary）

## REM-02 主应用 RC003 设备连接与按键生命周期

状态：已实现待验收；阶段：remote；责任角色：设备输入。

实现位置：[prototypes/live2d-codex/backend/remote-controller.mjs](../../prototypes/live2d-codex/backend/remote-controller.mjs)、[prototypes/live2d-codex/backend/remote-native.mjs](../../prototypes/live2d-codex/backend/remote-native.mjs)、[prototypes/live2d-codex/native/rc003-helper.cs](../../prototypes/live2d-codex/native/rc003-helper.cs)、[prototypes/live2d-codex/backend/remote-input.cjs](../../prototypes/live2d-codex/backend/remote-input.cjs)。

依赖：REM-01、FIX-02。原编号：R-03、R-23、R-27、R-34、B-03、B-15、T-03、T-19、S-03、D-01、D-08、K-05、K-06。

验收条件：

- 主应用只有一个设备连接拥有者；来源过滤、长按去重、断线代际和退出清理；普通键盘原始消息保留，输入法/多设备实际时序另行验收。
- 应用内搜索、配对/连接、断开、清除记录和自动连接；设备状态不依赖独立诊断窗口。

下一动作：修正版已观察到用户操作产生的一次完整收音到草稿日志；继续按 REM-05 实测稳定性、识别准确率、键盘/输入法共存与重连。

证据：[docs/development/remote-integration.md](remote-integration.md) — 2026-10-21：主应用内连接、按钮设置、原生来源判断、麦克风到原目标草稿、休眠/退出及打包已接线；离线回归、组件编译/管道和复制依赖的 Electron 加载通过。真实硬件、输入法、多设备及安装验收待完成。（source-and-offline）；[prototypes/live2d-codex/tests/remote-integration.test.mjs](../../prototypes/live2d-codex/tests/remote-integration.test.mjs) — 模拟连接、按键去重、音频解码、目标草稿、断线/取消旧结果及输入共存。（offline-tests）；[docs/development/remote-integration.md](remote-integration.md) — 2026-10-21：复现并修正物理语音键不启动、无音频时状态提前推进及停止播报清掉录音提示；全量288项离线测试通过。用户实机失败原因尚需新阶段记录确认，不将回归结果记为硬件通过。（regression-and-open-hardware-feedback）；[docs/development/remote-controls-ui.md](remote-controls-ui.md) — 2026-10-22：只读检查用户测试日志，观察到主应用物理语音键触发、113帧/1695ms音频、本地识别与写入草稿完成。单次链路有运行证据；未读取识别文本，不代替稳定性、识别准确率或音量验收。（user-run-log-summary）

## REM-03 RC003 音频接入捕获目标和草稿

状态：已实现待验收；阶段：remote；责任角色：设备/语音。

实现位置：[prototypes/live2d-codex/backend/remote-audio.mjs](../../prototypes/live2d-codex/backend/remote-audio.mjs)、[prototypes/live2d-codex/main.cjs](../../prototypes/live2d-codex/main.cjs)、[prototypes/live2d-codex/renderer/draft-session.mjs](../../prototypes/live2d-codex/renderer/draft-session.mjs)、[prototypes/live2d-codex/renderer/remote-voice-status.mjs](../../prototypes/live2d-codex/renderer/remote-voice-status.mjs)。

依赖：REM-02、BASE-03、FIX-01。原编号：G-01、R-04、R-06、R-09、R-21、B-16、B-17、T-01、T-02、T-04、T-05、T-06、K-04。

验收条件：

- 按下/松开形成有上限的音频段；接 SenseVoice；切换会话不误投草稿；静音/丢尾/断线可解释；不默认录音落盘。
- 电脑麦克风与遥控器麦克风来源明确；连接、已收到声音与本地识别按实际阶段反馈，物理语音键和协议请求共用采集互斥。

下一动作：修正版已观察到用户操作产生的一次完整收音到草稿日志；继续按 REM-05 实测稳定性、识别准确率、键盘/输入法共存与重连。

证据：[docs/development/remote-integration.md](remote-integration.md) — 2026-10-21：主应用内连接、按钮设置、原生来源判断、麦克风到原目标草稿、休眠/退出及打包已接线；离线回归、组件编译/管道和复制依赖的 Electron 加载通过。真实硬件、输入法、多设备及安装验收待完成。（source-and-offline）；[prototypes/live2d-codex/tests/remote-integration.test.mjs](../../prototypes/live2d-codex/tests/remote-integration.test.mjs) — 模拟连接、按键去重、音频解码、目标草稿、断线/取消旧结果及输入共存。（offline-tests）；[prototypes/live2d-codex/tests/workbench.test.mjs](../../prototypes/live2d-codex/tests/workbench.test.mjs) — 设备设置与听写 ID 持久化、重载幂等及同文追加回归。（offline-tests）；[docs/development/remote-integration.md](remote-integration.md) — 2026-10-21：复现并修正物理语音键不启动、无音频时状态提前推进及停止播报清掉录音提示；全量288项离线测试通过。用户实机失败原因尚需新阶段记录确认，不将回归结果记为硬件通过。（regression-and-open-hardware-feedback）；[docs/development/remote-controls-ui.md](remote-controls-ui.md) — 2026-10-22：只读检查用户测试日志，观察到主应用物理语音键触发、113帧/1695ms音频、本地识别与写入草稿完成。单次链路有运行证据；未读取识别文本，不代替稳定性、识别准确率或音量验收。（user-run-log-summary）

## REM-04 遥控确认发送、中断、朗读及审批

状态：已实现待验收；阶段：remote；责任角色：输入交互。

实现位置：[prototypes/live2d-codex/backend/remote-config.mjs](../../prototypes/live2d-codex/backend/remote-config.mjs)、[prototypes/live2d-codex/renderer/remote-ui.mjs](../../prototypes/live2d-codex/renderer/remote-ui.mjs)、[prototypes/live2d-codex/main.cjs](../../prototypes/live2d-codex/main.cjs)。

依赖：REM-02、UI-01、DATA-01。原编号：G-01、R-10、R-33、B-08、B-14、T-01、T-09、D-05、K-01。

验收条件：

- 确认只发送当前已确认草稿；按键连发不重复提交；审批使用明确动作；中断定位会话与轮次。
- 用户按按钮名称选择功能并立即保存；语音键按住说话，不要求录入键码。

下一动作：按新测试候选实测草稿确认发送、清空重录/撤销、右键朗读、菜单和审批导航；补 REM-05 真实设备证据。

证据：[docs/development/remote-integration.md](remote-integration.md) — 2026-10-21：主应用内连接、按钮设置、原生来源判断、麦克风到原目标草稿、休眠/退出及打包已接线；离线回归、组件编译/管道和复制依赖的 Electron 加载通过。真实硬件、输入法、多设备及安装验收待完成。（source-and-offline）；[prototypes/live2d-codex/tests/remote-integration.test.mjs](../../prototypes/live2d-codex/tests/remote-integration.test.mjs) — 模拟连接、按键去重、音频解码、目标草稿、断线/取消旧结果及输入共存。（offline-tests）；[prototypes/live2d-codex/tests/remote-ui.test.mjs](../../prototypes/live2d-codex/tests/remote-ui.test.mjs) — 手动连接取消、迟到结果与审批二次确认的界面回归。（offline-tests）；[docs/development/remote-controls-ui.md](remote-controls-ui.md) — 2026-10-22：遥控草稿确认发送、清空/撤销、固定朗读入口及分类设置已接入；离线功能和真实 renderer 布局检查通过。音量 Consumer Control 编译/自检及播放增益回归通过，物理键待验收。（source-offline-and-renderer）

## REM-05 RC003 连续操作与休眠重连验收

状态：施工中；阶段：remote；责任角色：硬件验收。

实现位置：[tools/remote-diagnostics/README.md](../../tools/remote-diagnostics/README.md)、[docs/development/testing.md](testing.md)。

依赖：REM-03、REM-04。原编号：G-04、R-03、R-06、R-07、R-23、R-27、R-34、B-03、B-04、B-19、T-04、T-18、T-19、S-03、S-04、D-01、K-06、K-08。

验收条件：

- 记录 100 次采集、50 条语料及 200 次目标操作；有效音频/延迟/语义按目标统计；拔插、休眠、断线不重放旧事件。

下一动作：复测语音输入、确认一次发送、清空/重录/撤销、朗读和物理音量键；保留没有事件或没有听感变化的失败记录，再继续既定稳定性矩阵。

证据：[docs/development/remote-integration.md](remote-integration.md) — 2026-10-21：用户反馈遥控器连接后不能语音听写，录音设备显示电脑麦克风。已开始主应用实测但尚未通过；已确认源码缺陷与现场唯一根因分开记录。（user-reported-failure）；[docs/development/remote-controls-ui.md](remote-controls-ui.md) — 用户复测反馈界面拥挤、草稿无清空方式、确认发送和朗读难以发现、物理音量无系统提示或可听变化。相关代码和界面已修正，仍需新候选实机复测。（open-user-feedback）；[docs/development/remote-controls-ui.md](remote-controls-ui.md) — 2026-10-22：只读检查用户测试日志，观察到主应用物理语音键触发、113帧/1695ms音频、本地识别与写入草稿完成。单次链路有运行证据；未读取识别文本，不代替稳定性、识别准确率或音量验收。（user-run-log-summary）；[docs/development/release-0.5.0-review.md](release-0.5.0-review.md) — 用户于2026-10-22反馈上一修正版“效果基本 ok”；仅记录有限反馈，物理音量、连续操作、睡眠重连与IME矩阵未据此勾选。（limited-user-feedback）

## REM-06 遥控组件安装与退出验收

状态：已实现待验收；阶段：remote；责任角色：构建发布。

实现位置：[prototypes/live2d-codex/scripts/package-portable.mjs](../../prototypes/live2d-codex/scripts/package-portable.mjs)、[prototypes/live2d-codex/backend/remote-native.mjs](../../prototypes/live2d-codex/backend/remote-native.mjs)、[tools/qa/remote-component.mjs](../../tools/qa/remote-component.mjs)、[tools/release/installer.iss](../../tools/release/installer.iss)、[prototypes/live2d-codex/scripts/copy-agent-dependencies.mjs](../../prototypes/live2d-codex/scripts/copy-agent-dependencies.mjs)。

依赖：REM-05、REL-01。原编号：G-05、R-02、B-23、K-05、K-10。

验收条件：

- 独立目录安装后能定位组件和依赖；与其他桥接器冲突可诊断；退出/卸载保留数据且只停止自有连接。

下一动作：使用0.5.0完成物理遥控器连接、桥接冲突、休眠、退出和卸载组合验收；保留现有数据与模型。

证据：[docs/development/remote-integration.md](remote-integration.md) — 2026-10-21：主应用内连接、按钮设置、原生来源判断、麦克风到原目标草稿、休眠/退出及打包已接线；离线回归、组件编译/管道和复制依赖的 Electron 加载通过。真实硬件、输入法、多设备及安装验收待完成。（source-and-offline）；[docs/release-audit.md](../release-audit.md) — 2026-10-22：0.5.0安装/升级逐文件验证包含遥控组件；原生辅助程序、管道、受控退出与依赖加载通过。物理设备连接、冲突、休眠、退出及卸载组合仍待验收。（isolated-installer-and-gui）

## AGT-01 Claude/Grok/OpenCode 源码适配器

状态：已验证限定范围；阶段：agents；责任角色：Agent 适配。

实现位置：[prototypes/live2d-codex/backend/claude-agent.mjs](../../prototypes/live2d-codex/backend/claude-agent.mjs)、[prototypes/live2d-codex/backend/acp-agent.mjs](../../prototypes/live2d-codex/backend/acp-agent.mjs)、[prototypes/live2d-codex/backend/native-agent.mjs](../../prototypes/live2d-codex/backend/native-agent.mjs)、[prototypes/live2d-codex/CLI-AGENTS.md](../../prototypes/live2d-codex/CLI-AGENTS.md)。

依赖：无。原编号：R-30、B-20、S-02。

验收条件：

- 三个适配器及界面选择存在；未完成的真实功能不能计入已发布支持。

下一动作：源码与离线协议范围已验证；各家真实账户/主应用验收仍由 AGT-03/04/05 承担，继续保留实验标识。

证据：[prototypes/live2d-codex/tests/agent-protocol.test.mjs](../../prototypes/live2d-codex/tests/agent-protocol.test.mjs) — 实际 Claude/ACP 适配器在 SDK 边界与 ACP stdio 合成对端中覆盖，不计为真实 CLI 验收。（offline-regression）

## AGT-02 新 Agent 的统一契约和失败路径测试

状态：已验证限定范围；阶段：agents；责任角色：Agent 适配。

实现位置：[prototypes/live2d-codex/backend/native-agent.mjs](../../prototypes/live2d-codex/backend/native-agent.mjs)、[prototypes/live2d-codex/backend/agent-questions.mjs](../../prototypes/live2d-codex/backend/agent-questions.mjs)、[prototypes/live2d-codex/backend/agent-process.mjs](../../prototypes/live2d-codex/backend/agent-process.mjs)、[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs)、[prototypes/live2d-codex/tests/agent-protocol.test.mjs](../../prototypes/live2d-codex/tests/agent-protocol.test.mjs)、[tools/qa/data-agent.mjs](../../tools/qa/data-agent.mjs)。

依赖：AGT-01、FIX-03。原编号：G-03、R-16、R-19、R-20、R-22、R-24、R-28、B-20、T-11、T-13、T-15、T-16、T-17、T-20、T-23、D-10、D-16、K-03、K-09。

验收条件：

- 每家覆盖创建/恢复/发送/流式/审批/提问/中断/退出、晚到事件和权限差异；测试不调用真实账户。

下一动作：保持 106 项专项回归；按 AGT-03/04/05 与验收清单做真实 CLI/账户验证。

证据：[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs) — 原有并发、关闭、最终文本和历史结果语义回归保持通过。（offline-regression）；[prototypes/live2d-codex/tests/agent-protocol.test.mjs](../../prototypes/live2d-codex/tests/agent-protocol.test.mjs) — 23 项实际适配器/锁定 ACP SDK 的离线矩阵：创建恢复、流式、审批、问题、工具中断、退出、旧/外来事件及权限差异。（offline-regression）；[docs/development/data-agent-validation.md](data-agent-validation.md) — 各家矩阵和无真实账户边界；不宣称已发布支持。（offline-regression）

## AGT-03 Claude 主应用真实验收

状态：待施工；阶段：agents；责任角色：Agent 验收。

实现位置：[prototypes/live2d-codex/backend/claude-agent.mjs](../../prototypes/live2d-codex/backend/claude-agent.mjs)、[tools/probes/cli-agents/claude-probe.mjs](../../tools/probes/cli-agents/claude-probe.mjs)。

依赖：AGT-02、DEC-01、FIX-01、FIX-02。原编号：G-03、R-14、R-28、R-30、R-36、B-05、B-20、B-22、T-23、T-24、S-02、D-04、D-16。

验收条件：

- 原有 CLI 登录、两轮任务、审批/拒绝、提问、运行工具取消、重启恢复、模型、草稿和朗读分别记录。

下一动作：先用独立探针验证当前 CLI，再验证主应用完整路径。

证据：尚无完成验收记录，不能标为完成。

## AGT-04 Grok 主应用真实验收

状态：待施工；阶段：agents；责任角色：Agent 验收。

实现位置：[prototypes/live2d-codex/backend/acp-agent.mjs](../../prototypes/live2d-codex/backend/acp-agent.mjs)、[tools/probes/cli-agents/acp-probe.mjs](../../tools/probes/cli-agents/acp-probe.mjs)。

依赖：AGT-02、DEC-01、FIX-03。原编号：G-03、R-14、R-28、R-36、B-22、T-24、D-16。

验收条件：

- 同一主应用最小契约逐项通过；账户、权限和取消行为有实测；缺能力不以空操作通过。

下一动作：复核原生登录与协议能力，再进入独立数据目录的桌面验收。

证据：尚无完成验收记录，不能标为完成。

## AGT-05 OpenCode 主应用真实验收

状态：待施工；阶段：agents；责任角色：Agent 验收。

实现位置：[prototypes/live2d-codex/backend/acp-agent.mjs](../../prototypes/live2d-codex/backend/acp-agent.mjs)、[tools/probes/cli-agents/acp-probe.mjs](../../tools/probes/cli-agents/acp-probe.mjs)。

依赖：AGT-02、DEC-01、FIX-03。原编号：G-03、R-14、R-28、R-36、B-22、T-24、D-16。

验收条件：

- 验证真实登录提供商及权限规则；会话恢复、取消、草稿与朗读通过；握手成功不代替任务完成。

下一动作：先消除历史账户/模型请求证据缺口，再测主应用。

证据：尚无完成验收记录，不能标为完成。

## AGT-06 跨 provider 会话与草稿隔离

状态：已实现待验收；阶段：agents；责任角色：会话数据。

实现位置：[prototypes/live2d-codex/backend/workspace-store.mjs](../../prototypes/live2d-codex/backend/workspace-store.mjs)、[prototypes/live2d-codex/renderer/draft-session.mjs](../../prototypes/live2d-codex/renderer/draft-session.mjs)、[prototypes/live2d-codex/renderer/workbench.js](../../prototypes/live2d-codex/renderer/workbench.js)。

依赖：AGT-01、DATA-02。原编号：G-02、R-09、R-35、B-17、B-21、T-05、T-10、K-01。

验收条件：

- 相同目录/同名会话/相同 ID 在不同 provider 下不混淆；忙碌与录音时切换有明确行为。

下一动作：草稿容量与基础 provider 隔离已有回归；继续验证相同 ID、录音中切换及逐家真实验收。

证据：[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs) — 106 条草稿跨三个新增 provider、Codex 和两个项目，磁盘重载仍保留；忙碌/录音切换尚待完整验收。（offline-regression）

## REL-01 当前源码安装候选与数据恢复验收

状态：已实现待验收；阶段：release；责任角色：构建发布。

实现位置：[tools/release/build.mjs](../../tools/release/build.mjs)、[prototypes/live2d-codex/scripts/package-portable.mjs](../../prototypes/live2d-codex/scripts/package-portable.mjs)、[docs/build.md](../build.md)、[tools/release/test-build.mjs](../../tools/release/test-build.mjs)、[docs/development/test-acceptance.md](test-acceptance.md)。

依赖：FIX-01、FIX-02、FIX-03、DATA-02、AGT-02。原编号：R-01、R-31、B-24、B-26、T-21、S-05、K-09。

验收条件：

- 新版本独立目录安装、升级/回滚、卸载、中文路径、缺 CLI/模型/无 GPU 均有证据；不复用旧 0.4 报告充当新结果。

下一动作：0.5.0已完成隔离中文路径安装解包、0.4.0覆盖升级和人物恢复；补注册安装/卸载、真实数据回滚、缺CLI/模型/无GPU与全新系统矩阵。

证据：[docs/development/data-agent-validation.md](data-agent-validation.md) — 内部候选 20261022-data-agent-02 的 ZIP 与独立 Test 安装器已构建；包内 106 项离线回归通过、8255 个文件校验通过；真实安装/升级/回滚仍未测。（test-candidate）；[docs/development/test-acceptance.md](test-acceptance.md) — 人工场景初始均为未测，包含数据、四家 Agent、RC003 及安装回滚；待用户执行。（acceptance-plan）；[docs/development/remote-integration.md](remote-integration.md) — 2026-10-21：生成20261022-remote-voice-01候选（ZIP与独立Test安装器）；包内37项遥控器离线回归通过，8260个文件哈希和应用源码指纹核对通过。本机已启动并观察到协议连接及按键接口就绪；尚无本次录音成功证据，安装器仍未实装验收。（test-candidate）；[docs/development/remote-controls-ui.md](remote-controls-ui.md) — 2026-10-22：生成 20261022-remote-controls-02 ZIP/Setup。8263 个包文件哈希、68 个已打包应用源文件与源码快照匹配，ZIP 9261 项 CRC 通过；随包45项遥控/语音专项通过。新便携程序实际启动、Agent ready、RC003 connected；继续原测试数据，项目/草稿/发送记录及已有设置逐项一致，只新增音量按钮默认配置。未验证安装器或物理音量效果。（built-test-candidate）；[docs/release-audit.md](../release-audit.md) — 2026-10-22：0.5.0正式安装器在隔离中文/空格路径PORTABLE解包及0.4.0覆盖升级通过；两份安装各8242文件校验一致，实际安装版5组人物故障/恢复/重启检查通过。未覆盖注册安装、卸载、真实数据回滚或物理设备。（isolated-installer-and-gui）

## REL-02 本批源码提交同步与 upstream

状态：施工中；阶段：release；责任角色：仓库维护。

实现位置：[.gitignore](../../.gitignore)、[.github/workflows/check.yml](../../.github/workflows/check.yml)、[docs/development/data-and-release.md](data-and-release.md)。

依赖：ORG-03、ORG-04。原编号：新增工作。

验收条件：

- 本批改动经过公开扫描和 diff 审查后提交到原仓库开发分支；对应 upstream 明确；工作区不被误当已同步。

下一动作：已审查全部公共源码与工作区，正在准备提交、原 origin 开发分支 upstream、main 合入与 CI；以实际推送结果结案。

证据：尚无完成验收记录，不能标为完成。

## REL-03 下一应用版本发布验收

状态：施工中；阶段：release；责任角色：构建发布。

实现位置：[tools/release/resource-manifest.json](../../tools/release/resource-manifest.json)、[docs/release-audit.md](../release-audit.md)。

依赖：REL-01、SEC-01、UI-02。原编号：B-28、K-12。

验收条件：

- 稳定支持仅声明已验收范围；实验能力明确标识、默认由用户选择，不放宽审批/数据/凭据约束；版本、哈希、许可、指南与已知限制一致；完整矩阵另按依赖任务验收。

下一动作：构建 0.5.0 并完成独立安装验证后发布；RC003 和新增 Agent 保持实验边界，完整硬件/账户/显示矩阵仍待验收。

证据：[docs/development/release-0.5.0-review.md](release-0.5.0-review.md) — 0.5.0 发布前完成 Standards/Spec 两轴审查与修复；用户反馈上一候选基本可用，尚不能替代完整设备/账户矩阵。（source-offline-review）

## DEC-01 确认新增后端的账户和计费边界

状态：已实现待验收；阶段：decisions；责任角色：产品/Agent。

实现位置：[prototypes/live2d-codex/CLI-AGENTS.md](../../prototypes/live2d-codex/CLI-AGENTS.md)、[docs/development/decisions.md](decisions.md)。

依赖：AGT-01。原编号：R-30、R-36、B-05、T-24、S-02、D-13。

验收条件：

- 旧 R-36 的沿用 CLI 账户约束与当前可选 API Key 能力有明确产品决策；不自动更换计费来源。

下一动作：Claude 发布入口已限定 API/官方云 API 并说明独立费用；其余逐家真实认证与扩大正式支持继续验收，不自动更改用户计费。

证据：[docs/development/release-0.5.0-review.md](release-0.5.0-review.md) — 依官方 SDK 要求修正 Claude 产品认证/命名，实际来源白名单拒绝 OAuth 与未知来源，有协议回归。（source-offline-review）

## DEC-02 明确原 TUI 共存与并发任务的后续定位

状态：待施工；阶段：decisions；责任角色：产品/架构。

实现位置：[docs/development/decisions.md](decisions.md)、[tools/probes/codex-tui-probe.mjs](../../tools/probes/codex-tui-probe.mjs)。

依赖：无。原编号：G-06、R-15、R-17、R-29、B-02、B-12、T-12、T-14、S-01、D-03、D-12、K-03、K-07。

验收条件：

- 旧原 TUI 同任务控制和多活动任务要求有明确保留/后置决定；当前壁纸工作台不假称实现。

下一动作：基于当前桌面主流程说明收益、限制与成本，再决定是否进入后续里程碑。

证据：尚无完成验收记录，不能标为完成。

## SEC-01 新增后端的日志、凭据和依赖审计

状态：已实现待验收；阶段：release；责任角色：隐私/发布。

实现位置：[docs/privacy.md](../privacy.md)、[tools/release/audit-public.mjs](../../tools/release/audit-public.mjs)、[prototypes/live2d-codex/THIRD-PARTY-NOTICES.md](../../prototypes/live2d-codex/THIRD-PARTY-NOTICES.md)。

依赖：AGT-02、DEC-01。原编号：R-26、B-27、T-18、S-05、K-11、K-12。

验收条件：

- 新增 SDK 的许可和对应源码要求核对；消息缓存保留政策准确；正文/凭据不进入公共日志；原生权限差异说明完整。

下一动作：公开文件、锁定依赖及源码数据流已审查；真实新增后端账户的数据流仍按 AGT-03/04/05 验证。

证据：[docs/development/release-0.5.0-review.md](release-0.5.0-review.md) — npm 官方审计无已知漏洞；保留各SDK许可，纠正本地诊断隐私说明，并检查不分发CLI、模型或凭据。（source-offline-review）

## PRIVATE-01 私人 Dots 通道保留与隔离

状态：已验证限定范围；阶段：baseline；责任角色：私人扩展。

实现位置：[docs/development/repository-map.md](repository-map.md)、[.gitignore](../../.gitignore)。

依赖：无。原编号：新增工作。

验收条件：

- 本机桥接与配置保留；公开仓库/安装包不纳入私人服务。

下一动作：仅在本机需要时用单独测试验证，不阻塞公共源码开发。

证据：[docs/project-status.md](../project-status.md) — 原通道留在原路径；公开忽略范围保持。（local-audit-summary）；[docs/development/quality-audit.md](quality-audit.md) — STD-03/04：本地私人适配器关闭中连接及并发发送两项缺陷先复现后修复，合成I/O回归通过，未调用私人服务；公开CI不依赖私人文件。（offline-regression）

## FUT-01 有限语音操作意图

状态：后置；阶段：future；责任角色：交互设计。

实现位置：[docs/development/product.md](product.md)。

依赖：REM-05。原编号：R-32、D-07。

验收条件：

- 显式进入操作模式；否定/歧义需确认；听写正文不会执行控制。

下一动作：遥控主流程稳定后再立项。

证据：尚无完成验收记录，不能标为完成。

## ART-01 精细 Live2D 可行性调研与现有绑定核查

状态：已验证限定范围；阶段：future；责任角色：美术/渲染。

实现位置：[docs/development/live2d-feasibility.md](live2d-feasibility.md)、[tools/qa/live2d-model-inspection.mjs](../../tools/qa/live2d-model-inspection.mjs)。

依赖：BASE-01。原编号：新增工作。

验收条件：

- 以现有代码和 MOC3 参数采样区分运行时、姿态图切换与实际网格变形。
- 通过一手资料区分拆件、自动绑定、模型导出和播放工具，记录本机接口检查与未验证边界。
- 形成保留现有渲染链的样例路线，不把调研或参数采样称为新人物画质、GPU性能或安装验收。

下一动作：调研路线已在ART-02进入单角色样例；后续以实际预览验收决定FUT-02范围。

证据：[docs/development/live2d-feasibility.md](live2d-feasibility.md) — 2026-10-21：男女模型各2个网格、24个参数；采样仅4项影响网格或透明度，抬头为透明度切换。已有PSD2Live 3.4.5的help/targets返回0；公开制作/AI工具、调用边界和SDK许可已调研。未生成或验收精细新模型。（source-research-and-offline-inspection）

## ART-02 女生 Live2D 半身样例与独立预览

状态：施工中；阶段：future；责任角色：美术/渲染。

实现位置：[prototypes/live2d-halfbody](../../prototypes/live2d-halfbody)、[tools/project/preview-halfbody.mjs](../../tools/project/preview-halfbody.mjs)、[tools/qa/live2d-halfbody-preview.mjs](../../tools/qa/live2d-halfbody-preview.mjs)、[tools/qa/live2d-halfbody-diagnose.mjs](../../tools/qa/live2d-halfbody-diagnose.mjs)、[tests/live2d-halfbody.test.mjs](../../tests/live2d-halfbody.test.mjs)、[docs/development/live2d-halfbody-preview.md](live2d-halfbody-preview.md)。

依赖：BASE-01、ART-01。原编号：新增工作。

验收条件：

- 保留现有男女壁纸与设置，提供女生半身的独立可编辑模型和预览。
- 连续转头、眨眼、实际声音驱动口型与发丝摆动；停止播放及加载失败可恢复。
- 中立姿态保留母版的头身、脸型、五官和颈肩比例；同画布分层复合可还原母版，未审定的非等比拉伸不得用于凑位置。
- 左右、俯仰、四个组合角及眨眼/口型中间形均经实图检查；零翻折和可播放不代表美术通过，需用户认可画风、人物身份与动作。

下一动作：按原画保真小样计划，从原女生 attention 图的头颈开始：同画布拆件/静态复合对照通过后，逐关键形制作头部并交付10–15秒试片，再扩展半身和发丝。See-through尚未部署或实测；自动拆件一轮实验及最多两轮定向修正仍不能保真时，停止扩展并建议专业美术接手。原壁纸继续保留。

证据：[docs/development/live2d-halfbody-preview.md](live2d-halfbody-preview.md) — 2026-10-21：14个素材部件导出16个网格、20个参数；修正闭眼翻折及重复唇线；243组组合采样无非有限坐标或可见翻折，真实语音口型、停止竞态、坏音频恢复和模型重试通过。这些仅为技术证据；后续人工美术验收失败。（offline-model-and-browser-preview）；[docs/development/live2d-halfbody-preview.md](live2d-halfbody-preview.md) — 2026-10-22：用户否决人体比例和脸型。复查母图、图集、实际PNG尺寸、MOC3及浏览器姿态，确认3个发层非等比拉伸、独立重绘拼装和颈部合并问题；关闭风并缩小转头不能修复中立比例。本机MCP查询确认可逐关键形精修；未产生或验收新角色，任务退回返工。（visual-rejection-and-source-diagnosis）；[docs/development/live2d-halfbody-preview.md](live2d-halfbody-preview.md) — 2026-10-22：制定原画分层保真、头颈关键形、短动态试片、半身/头发四阶段计划及两轮定向修正止损条件；优先保留原画脸型和姿态，每阶段有可见交付和效果门槛。这是方案更新，不是新模型实现或验收证据。（rework-plan）

## ART-03 已下载动态壁纸的源码检查与接入调研

状态：已验证限定范围；阶段：future；责任角色：美术/渲染。

实现位置：[docs/development/external-wallpaper-feasibility.md](external-wallpaper-feasibility.md)。

依赖：BASE-01、ART-01。原编号：新增工作。

验收条件：

- 定位当前 Wallpaper Engine 壁纸及可读资源，区分视频、Web、Scene 与实时 Live2D。
- 检查动态媒体和入场、循环、过渡、暂停机制，记录独立预览中的失败与未验证范围。
- 基于主应用实际窗口与启动代码形成接入路线；不把调查称为已交付兼容模式、实时口型或美术验收。

下一动作：优先评估 Wallpaper Engine 保留渲染、本应用独立提供对话和语音的兼容模式；随后按需实现本地视频导入。正式实施需移除隐藏模式的原角色加载、处理气泡与声线映射，并实测桌面共存和循环；ART-02 的美术返工尚未通过。

证据：[docs/development/external-wallpaper-feasibility.md](external-wallpaper-feasibility.md) — 2026-10-22：从运行进程和当前壁纸配置定位 Web 项目，确认 HTML/JS 和三档 WebM；探测媒体编码并播放 1440p 动态素材，发现独立预览循环衔接超时。检查双视频预加载、帧回调及宿主接口，确认主应用 hidden 入口仍加载原角色。仅完成调研，未修改第三方壁纸或交付正式接入。（local-source-media-and-browser-inspection）

## FUT-02 更精细人物绑定与扩展素材

状态：后置；阶段：future；责任角色：美术/渲染。

实现位置：[docs/development/product.md](product.md)、[docs/development/live2d-feasibility.md](live2d-feasibility.md)。

依赖：BASE-01、ART-01、ART-02。原编号：新增工作。

验收条件：

- 新的绑定、动作与素材许可独立验收；保留现有两人物。
- 单角色样例先验证连续转头、眨眼、口型、发丝与组合参数；再验收目标运行时、人物声线一致性、失败重试和实机资源占用。

下一动作：ART-02已提供女生独立半身样例；先人工确认画风和动作，再决定正式壁纸接入及双人物全面精修。

证据：[docs/development/live2d-feasibility.md](live2d-feasibility.md) — ART-01提供已有绑定实测和制作路线，不代表FUT-02的新模型、美术或性能验收完成。（research-only）

## FUT-03 多屏、多硬件和跨平台

状态：后置；阶段：future；责任角色：平台架构。

实现位置：[docs/development/product.md](product.md)。

依赖：REM-05。原编号：新增工作。

验收条件：

- 每个新增平台/硬件单独定义兼容矩阵和资源预算。

下一动作：Windows 单屏 RC003 主线稳定后按需求排序。

证据：尚无完成验收记录，不能标为完成。

## FUT-04 多个后台任务与同目录并发控制

状态：后置；阶段：future；责任角色：会话架构。

实现位置：[prototypes/live2d-codex/backend/native-agent.mjs](../../prototypes/live2d-codex/backend/native-agent.mjs)、[prototypes/live2d-codex/backend/codex.mjs](../../prototypes/live2d-codex/backend/codex.mjs)。

依赖：DEC-02、DATA-01。原编号：R-15、T-12、D-12、K-07。

验收条件：

- 并发目标隔离和同目录互斥真实可验证；不改变当前单活动后端的语义。

下一动作：先明确产品是否保留旧三活动任务目标。

证据：尚无完成验收记录，不能标为完成。

## FIX-04 统一会话切换锁与旧连接释放所有权

状态：已验证限定范围；阶段：stability；责任角色：Agent 适配。

实现位置：[prototypes/live2d-codex/backend/agent-lifecycle.mjs](../../prototypes/live2d-codex/backend/agent-lifecycle.mjs)、[prototypes/live2d-codex/backend/native-agent.mjs](../../prototypes/live2d-codex/backend/native-agent.mjs)、[prototypes/live2d-codex/backend/claude-agent.mjs](../../prototypes/live2d-codex/backend/claude-agent.mjs)、[prototypes/live2d-codex/backend/acp-agent.mjs](../../prototypes/live2d-codex/backend/acp-agent.mjs)、[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs)。

依赖：ORG-04。原编号：新增工作。

验收条件：

- 第一 await 前锁定切换；并发新建/恢复/发送被拒绝；关闭阻止新连接，重复关闭等待正在释放的旧连接。

下一动作：协议适配新增资源时继续遵守共享锁与可等待的释放约定。

证据：[docs/development/review-fixes.md](review-fixes.md) — 对应审查 S-01；三后端并发/关闭及真实适配器的假child释放回归通过。（offline-regression）

## FIX-05 恢复原生历史时保留轮次结果和朗读资格

状态：已验证限定范围；阶段：stability；责任角色：Agent/语音。

实现位置：[prototypes/live2d-codex/backend/reply-state.mjs](../../prototypes/live2d-codex/backend/reply-state.mjs)、[prototypes/live2d-codex/backend/claude-agent.mjs](../../prototypes/live2d-codex/backend/claude-agent.mjs)、[prototypes/live2d-codex/backend/acp-agent.mjs](../../prototypes/live2d-codex/backend/acp-agent.mjs)、[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs)。

依赖：ORG-04。原编号：新增工作。

验收条件：

- 已知完成/失败/中断/进行中及commentary状态恢复一致；歧义或外部改变的历史可展示但不能冒充成功完成。

下一动作：真实 CLI 验收时检查原生历史分段变化；未知结果保守不可朗读。

证据：[docs/development/review-fixes.md](review-fixes.md) — 对应审查 S-02；Claude/Grok/OpenCode 受控历史、分段合并与歧义回归通过。（offline-regression）

## DATA-03 保留超过100条的未发送草稿

状态：已验证限定范围；阶段：stability；责任角色：会话数据。

实现位置：[prototypes/live2d-codex/backend/workspace-store.mjs](../../prototypes/live2d-codex/backend/workspace-store.mjs)、[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs)。

依赖：ORG-04。原编号：新增工作。

验收条件：

- 保存更多会话草稿不淘汰其他非空输入；跨provider/项目落盘和重载后保留；只有明确清空目标才删除该草稿。

下一动作：保持非空草稿不自动淘汰；未来容量策略须有可恢复的数据方案。

证据：[docs/development/review-fixes.md](review-fixes.md) — 对应审查 SPEC-01；106条草稿写盘/重载及单条清空回归通过。（offline-regression）

## TOOL-01 探针报告使用新运行目录并保护历史证据

状态：已验证限定范围；阶段：organization；责任角色：开发工具。

实现位置：[tools/qa/run-output.mjs](../../tools/qa/run-output.mjs)、[tools/probes/codex-probe.mjs](../../tools/probes/codex-probe.mjs)、[tools/probes/codex-tui-probe.mjs](../../tools/probes/codex-tui-probe.mjs)、[tools/probes/windows-preflight.ps1](../../tools/probes/windows-preflight.ps1)、[tests/qa-tools.test.mjs](../../tests/qa-tools.test.mjs)。

依赖：ORG-04。原编号：新增工作。

验收条件：

- 报告不写旧docs/evidence日期路径；每次新建work/qa目录，拒绝已有目录、目录外目标和重复报告。

下一动作：新增验收工具复用输出边界；历史结果保持原样。

证据：[docs/development/review-fixes.md](review-fixes.md) — 对应审查 STD-TOOLS-01；唯一目录、范围与禁止覆盖回归通过，旧证据未修改。（offline-regression）

## TOOL-02 显式运行门槛与旧GUI验收工具收敛

状态：已验证限定范围；阶段：organization；责任角色：开发工具。

实现位置：[tools/probes/README.md](../../tools/probes/README.md)、[tools/qa/gui/README.md](../../tools/qa/gui/README.md)、[tools/qa/gui/run.mjs](../../tools/qa/gui/run.mjs)、[tools/qa/gui/context.mjs](../../tools/qa/gui/context.mjs)、[tests/qa-tools.test.mjs](../../tests/qa-tools.test.mjs)。

依赖：ORG-04。原编号：新增工作。

验收条件：

- 真实CLI/GUI工具默认帮助；15个旧check源码有带哈希归档，4个维护迁移、11个历史源码保留，人物切换一并统一；无执行逻辑的说明桩已由TOOL-03移出维护目录，avatar用例模式明确。

下一动作：按具体 GUI/硬件/账户任务运行显式验收；本次默认帮助与静态迁移检查不冒充真实 GUI 通过。

证据：[docs/development/review-fixes.md](review-fixes.md) — 对应审查 STD-TOOLS-02 及旧工具残留建议；16份原文（15旧check+人物切换）哈希保留，5个维护用例默认帮助回归通过。（offline-regression）

## DOC-01 更新当前指南与实验Agent支持口径

状态：已验证限定范围；阶段：organization；责任角色：项目维护。

实现位置：[prototypes/live2d-codex/PORTABLE-README.md](../../prototypes/live2d-codex/PORTABLE-README.md)、[prototypes/live2d-codex/CLI-AGENTS.md](../../prototypes/live2d-codex/CLI-AGENTS.md)、[prototypes/live2d-codex/renderer/agent-picker.mjs](../../prototypes/live2d-codex/renderer/agent-picker.mjs)、[prototypes/live2d-codex/backend/agent-catalog.cjs](../../prototypes/live2d-codex/backend/agent-catalog.cjs)、[prototypes/live2d-codex/scripts/package-portable.mjs](../../prototypes/live2d-codex/scripts/package-portable.mjs)、[docs/development/review-fixes.md](review-fixes.md)。

依赖：ORG-04。原编号：新增工作。

验收条件：

- 用户指南去除手写旧版本；注明验证日期并区分离线/真实验收；同一catalog生成三后端实验标签和包清单。

下一动作：真实验收通过并决定正式支持后再修改实验标记和发布记录。

证据：[docs/development/review-fixes.md](review-fixes.md) — 对应审查 SPEC-02 及发布范围风险；已更新指南、共享选择器和包清单，未制作或发布安装包。（offline-regression）

## FIX-06 退出时等待后端替换并释放未发布实例

状态：已验证限定范围；阶段：stability；责任角色：主进程。

实现位置：[prototypes/live2d-codex/main.cjs](../../prototypes/live2d-codex/main.cjs)、[prototypes/live2d-codex/tests/provider-switch.test.mjs](../../prototypes/live2d-codex/tests/provider-switch.test.mjs)。

依赖：FIX-02。原编号：新增工作。

验收条件：

- 切换后端在构造、旧连接关闭、目录/设置保存之后检查退出状态；退出等待整个切换并释放未发布实例，不在关闭后启动替代后端。

下一动作：在当前源码安装候选中补真实进程退出验收；本项只验证受控异步交错。

证据：[docs/development/quality-audit.md](quality-audit.md) — STD-01：实际主进程切换与退出边界的五阶段离线回归通过，独立复审无遗留发现。（offline-regression）

## FIX-07 隔离电脑听写取消、重录与晚到识别

状态：已验证限定范围；阶段：stability；责任角色：语音/交互。

实现位置：[prototypes/live2d-codex/renderer/speech-ui.js](../../prototypes/live2d-codex/renderer/speech-ui.js)、[prototypes/live2d-codex/tests/capture-lifecycle.test.mjs](../../prototypes/live2d-codex/tests/capture-lifecycle.test.mjs)。

依赖：BASE-03。原编号：新增工作。

验收条件：

- 录音初始化、resume、flush、close、识别返回后均核对操作编号；旧操作不得创建新会话节点、释放新目标或回填其他provider；取消保留已有草稿。

下一动作：真实麦克风和RC003互斥/输入法共存继续按设备任务验收。

证据：[docs/development/quality-audit.md](quality-audit.md) — STD-02/SPEC-01：五项录音生命周期回归通过，独立复核补测旧flush晚到不发起识别或清新目标。（offline-regression）

## FIX-08 旧原生Agent缓存缺失轮次结果时禁止朗读

状态：已验证限定范围；阶段：stability；责任角色：Agent适配。

实现位置：[prototypes/live2d-codex/backend/native-agent.mjs](../../prototypes/live2d-codex/backend/native-agent.mjs)、[prototypes/live2d-codex/tests/agent-contract.test.mjs](../../prototypes/live2d-codex/tests/agent-contract.test.mjs)。

依赖：FIX-05。原编号：新增工作。

验收条件：

- 加载整个缓存索引时将缺失turnStatus标为unknown；保留原文和明确的completed/interrupted/failed，旧缓存不能被误判为成功回复。

下一动作：真实原生历史变化与账户恢复继续按AGT任务验收。

证据：[docs/development/quality-audit.md](quality-audit.md) — SPEC-02：四种缓存状态回归与既有三后端历史恢复矩阵通过；无真实账户访问。（offline-regression）

## TOOL-03 清理失效提示入口并统一RC003状态说明

状态：已验证限定范围；阶段：organization；责任角色：开发工具/项目维护。

实现位置：[tools/project/status.mjs](../../tools/project/status.mjs)、[tests/project-launcher.test.mjs](../../tests/project-launcher.test.mjs)、[tools/qa/gui/README.md](../../tools/qa/gui/README.md)、[docs/development/quality-audit.md](quality-audit.md)。

依赖：TOOL-02、ORG-03。原编号：新增工作。

验收条件：

- 11个无执行逻辑的GUI说明桩归档并校验哈希；维护兼容入口不变；未使用导入与重复忽略规则清理；RC003源码接入与硬件验收状态分别从台账显示。

下一动作：新过程输出写入work/qa；旧数据/模型/历史包继续按目录保护规则保留。

证据：[docs/development/quality-audit.md](quality-audit.md) — SPEC-03及文件整理：11个提示桩已归档，11个无用导入与7条重复忽略规则已清理；状态文字/JSON回归通过。（offline-regression）

## UI-03 遥控草稿闭环与对话设置界面整理

状态：已实现待验收；阶段：remote；责任角色：桌面交互。

实现位置：[prototypes/live2d-codex/renderer/composer-controls.mjs](../../prototypes/live2d-codex/renderer/composer-controls.mjs)、[prototypes/live2d-codex/renderer/settings-navigation.mjs](../../prototypes/live2d-codex/renderer/settings-navigation.mjs)、[prototypes/live2d-codex/renderer/draft-session.mjs](../../prototypes/live2d-codex/renderer/draft-session.mjs)、[prototypes/live2d-codex/tests/composer-controls.test.mjs](../../prototypes/live2d-codex/tests/composer-controls.test.mjs)、[tools/qa/interface-check.mjs](../../tools/qa/interface-check.mjs)。

依赖：UI-01、REM-03、REM-04。原编号：新增工作。

验收条件：

- 草稿框中确认一次发送，左键清空并持久化，右键朗读或撤销；会话切换、新输入和识别/发送保护不误改数据。
- 朗读入口固定，播报/录音状态分开，设置按六类展示并保留未保存字段；菜单及审批导航保留。

下一动作：离线和标准/紧凑 renderer 验证通过；等待用户在新测试版完成遥控实际操作。

证据：[docs/development/remote-controls-ui.md](remote-controls-ui.md) — 2026-10-22：遥控草稿确认发送、清空/撤销、固定朗读入口及分类设置已接入；离线功能和真实 renderer 布局检查通过。音量 Consumer Control 编译/自检及播放增益回归通过，物理键待验收。（source-offline-and-renderer）；[docs/development/release-0.5.0-review.md](release-0.5.0-review.md) — 修复六分类确认及项目/会话列表刷新导致的遥控焦点丢失，真实 renderer 的导航/字段保留检查通过。（source-offline-review）

## REM-07 遥控媒体音量键与应用播报音量

状态：已实现待验收；阶段：remote；责任角色：设备/语音。

实现位置：[prototypes/live2d-codex/native/rc003-helper.cs](../../prototypes/live2d-codex/native/rc003-helper.cs)、[prototypes/live2d-codex/backend/remote-config.mjs](../../prototypes/live2d-codex/backend/remote-config.mjs)、[prototypes/live2d-codex/renderer/speech-ui.js](../../prototypes/live2d-codex/renderer/speech-ui.js)、[prototypes/live2d-codex/tests/speech-ui.test.mjs](../../prototypes/live2d-codex/tests/speech-ui.test.mjs)、[tools/qa/remote-component.mjs](../../tools/qa/remote-component.mjs)。

依赖：REM-02、BASE-03。原编号：新增工作。

验收条件：

- 仅所选遥控器的键盘式或 Consumer Control 音量键进入动作通路，按下去重、断线清理且不记录普通键盘。
- 音量动作与屏幕滑块改变实际 Web Audio GainNode，保存并沿用于后续播放；音量设置不重载语音模型。
- 必须另行证实物理音量加减事件与听感变化；没有事件时保留阻断记录。

下一动作：C# 编译、媒体 usage/边沿自检和实际增益节点的离线回归通过；物理音量按键尚未验收。

证据：[docs/development/remote-controls-ui.md](remote-controls-ui.md) — 2026-10-22：遥控草稿确认发送、清空/撤销、固定朗读入口及分类设置已接入；离线功能和真实 renderer 布局检查通过。音量 Consumer Control 编译/自检及播放增益回归通过，物理键待验收。（source-offline-and-renderer）

## FIX-09 旧听写结束仅清理自身超时保护

状态：已验证限定范围；阶段：stability；责任角色：桌面/数据。

实现位置：[prototypes/live2d-codex/main.cjs](../../prototypes/live2d-codex/main.cjs)、[prototypes/live2d-codex/tests/capture-lifecycle.test.mjs](../../prototypes/live2d-codex/tests/capture-lifecycle.test.mjs)。

依赖：FIX-07。原编号：新增工作。

验收条件：

- 旧请求成功/失败晚到均不清除新采集计时器；当前请求正常释放自身资源。

下一动作：保持对应离线回归；实机与分发结果分别记录，不混用证据。

证据：[docs/development/release-0.5.0-review.md](release-0.5.0-review.md) — 2026-10-22：审查发现已修复，针对性回归和完整离线测试通过。（source-offline-review）

## FIX-10 未决发送记录保护项目入口

状态：已验证限定范围；阶段：stability；责任角色：桌面/数据。

实现位置：[prototypes/live2d-codex/backend/workspace-store.mjs](../../prototypes/live2d-codex/backend/workspace-store.mjs)、[prototypes/live2d-codex/tests/submission-safety.test.mjs](../../prototypes/live2d-codex/tests/submission-safety.test.mjs)。

依赖：DATA-01。原编号：新增工作。

验收条件：

- 任何provider未决记录的目标与原目标不能移除；核查/恢复可继续，已解决记录不妨碍正常移除。

下一动作：保持对应离线回归；实机与分发结果分别记录，不混用证据。

证据：[docs/development/release-0.5.0-review.md](release-0.5.0-review.md) — 2026-10-22：审查发现已修复，针对性回归和完整离线测试通过。（source-offline-review）

## REL-04 发布版本一致与产物覆盖保护

状态：已验证限定范围；阶段：release；责任角色：构建发布。

实现位置：[tools/release/release-inputs.mjs](../../tools/release/release-inputs.mjs)、[tools/qa/release-package.mjs](../../tools/qa/release-package.mjs)、[tests/release-inputs.test.mjs](../../tests/release-inputs.test.mjs)。

依赖：无。原编号：新增工作。

验收条件：

- 不同版本或已有输出在构建前拒绝；不覆盖旧安装器；发布包有版本/哈希/源码和分发边界校验。

下一动作：保持对应离线回归；实机与分发结果分别记录，不混用证据。

证据：[docs/development/release-0.5.0-review.md](release-0.5.0-review.md) — 2026-10-22：审查发现已修复，针对性回归和完整离线测试通过。（source-offline-review）
