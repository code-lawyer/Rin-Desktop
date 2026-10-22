# 项目状态与开发入口

更新日期：2026-10-22。持续开发先读[开发手册](development/README.md)，施工状态只维护[JSON 台账](development/backlog.json)，再生成[进度表](development/progress.md)。历史整理与审查过程分别保留在[目录地图](development/repository-map.md)、[验证记录](development/verification.md)和[前轮质量审查](development/quality-audit.md)。

Rin Desktop 的目标是把 Windows 动态壁纸、Agent 工作台、本地语音与 RC003 遥控器形成统一入口。0.5.0 整合原有功能、数据保护、分类设置、遥控草稿清空/撤销/发送与回复朗读。新增 Agent 和 RC003 仍有实验边界，发布不代表完整硬件或账户矩阵已通过。

## 版本与仓库

继续使用 [code-lawyer/Rin-Desktop](https://github.com/code-lawyer/Rin-Desktop)，没有新建仓库、替换 origin 或重写历史。0.4.0 基线为 `9293be972414243c62d4e6c52a1ea8322e71d8a6`；0.5.0 的版本、安装器校验和实际验证见[发布记录](release-audit.md)。

`npm run status` 只读显示本地分支、origin、upstream、未提交文件和启动条件；它不自动 fetch、push、下载或启动应用。本地源码、远端 main 与 Release 安装包分别核对，不能只比较版本号。

## 当前功能

| 模块 | 当前范围 | 后续工作 |
| --- | --- | --- |
| 壁纸、气泡、项目工作台 | 原两个人物、原画与动画保留；设置按六类显示 | 显示缩放、桌面重建与更广显卡矩阵 UI-02 |
| Codex | 沿用原生 CLI/账户；流式、审批、恢复、项目与会话 | 协议变更持续回归；不并发控制同一原生会话 |
| 本地听写与朗读 | SenseVoice、Kokoro、Qwen；录音先写草稿，固定朗读入口与实际播放音量 | 真实语料、长回复与不同硬件性能 |
| RC003（实验） | 应用内连接/设置、遥控麦克风、清空/撤销/发送/朗读、媒体音量接线 | REM-05 的连续操作、物理音量、睡眠重连、键盘/IME 共存仍待验收 |
| Claude/Grok/OpenCode（实验） | 统一契约与权限/失败路径离线回归 | AGT-03/04/05 各家真实账户/完整主应用验收；Claude 仅 API 或官方云 API |
| 数据保护 | 事务保存、备份恢复、未知提交核查、原稿与项目入口保护 | 真实断电、升级/回退及异常存储环境矩阵 |
| 通用按键、Dots、半身预览 | 兼容按键保留；Dots 私人可选；精细人物仍为独立开发样例 | Dots/制作素材不进入公共包；半身样例不替换现有壁纸 |

用户于本轮反馈测试版“效果基本 ok”，只记为有限反馈。最新[两轴审查](development/release-0.5.0-review.md)修复录音计时器所有权、未决发送项目移除和遥控焦点问题，并纠正认证、隐私和发布指南。完整离线回归 312 项通过，其中公开源码对应 307 项；详细证据与限制以发布记录为准。

## 统一入口与数据边界

| 操作 | 入口 |
| --- | --- |
| 当前源码启动 | 根目录 `npm start` 或 `启动 Rin Desktop.cmd` |
| 只读启动检查 | `npm start -- --check` |
| 安装版启动 | Windows 开始菜单 Rin Desktop |
| 当前开发进度 | [施工清单](development/progress.md) |
| 人工验收 | [验收清单](development/test-acceptance.md) |
| 数据恢复预览 | `npm run data:recover -- --source="<源目录>" --out="<全新目录>"` |

旧“雨夜壁纸/整合壁纸”入口仍转到同一源码启动器，不回退到旧 exe。源码默认数据在 `work/runtime/avatar`；安装版在 `%LOCALAPPDATA%/VibeVoice` 或用户选择的已有目录；Test 包默认隔离。升级/整理不自动搬迁或合并个人数据，回滚先保留副本并核对旧格式。

当前源码、开发文档、测试与工具在同一 Git 仓库。模型、runtime、node_modules、artwork 母图、私人 Dots、原始研究/日志、旧 Release 都按[目录规则](development/repository-layout.json)保留原位置；新增运行输出统一进忽略的 `work/qa`。历史材料用于追溯，不再与当前架构或状态并列维护。

## 下一阶段

1. 按 REM-05/06 验证遥控连续操作、物理音量和睡眠/输入法共存，保留失败结果。
2. 按 AGT-03/04/05 逐家验证新增 CLI 的认证、任务、拒绝审批、中断、恢复和语音；通过前保留实验标识。
3. 补 UI-02、REL-01/03 的全新 Windows、显示/显卡、安装/卸载/回滚矩阵，再扩大正式支持范围。

源码同步、安装器验证、GitHub Release 发布分别记录。提交前扫描公开工作区和实际 index；发布包只含应用与允许分发的运行资源，不含 Agent CLI、模型、个人数据或凭据。
