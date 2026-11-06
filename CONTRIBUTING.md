# 维护与贡献

使用入口见 [README](README.md)，构建与资源准备见 [构建说明](docs/build.md)，支持范围见 [项目状态](docs/project-status.md)。

1. 保留现有工作区变动。主应用位于 `prototypes/live2d-codex`，根目录 npm 命令是统一入口；不要为了整理目录移动用户数据、模型、runtime 或私人 Dots。
2. 为实际行为缺陷补充有意义的回归测试。普通测试使用合成账户/协议，不调用真实 CLI、麦克风或遥控器；维护验证源放在 `tools/qa` 和 `tools/probes`，运行产物放在忽略的 `work/qa`。
3. 运行 `npm run check:project`、相关测试、受影响的前端构建及 `npm run check:public`。发布前运行完整 `npm test`，并使用 `node tools/release/audit-public.mjs --staged` 审计实际暂存内容。
4. 修改使用行为时同步维护对应指南；当前限制集中在项目状态，不维护重复任务台账、过程报告或自动生成的进度页。
5. 提交前检查 diff 和公开文件清单；通过原 GitHub 仓库的分支/PR 同步。源码提交与应用 Release 分别验收；既有安装包不会因源码更新自动改变。

安装候选与实机测试使用 [验收清单](tools/release/TEST-ACCEPTANCE.md)。检查项尚未执行时保持未测，不将单元测试、页面缩放或组件编译描述为硬件、系统 DPI 或真实账户验收。
