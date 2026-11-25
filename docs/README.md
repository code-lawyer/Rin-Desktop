# Rin Desktop 文档

| 用途 | 入口 |
| --- | --- |
| 安装与日常使用 | [README](../README.md)、[随包用户指南](../prototypes/live2d-codex/PORTABLE-README.md) |
| 当前功能与待验收边界 | [项目状态](project-status.md) |
| 系统架构、源码准备、构建与发布 | [架构与构建说明](build.md)、[贡献流程](../CONTRIBUTING.md)、[仓库工作规范](../AGENTS.md) |
| CLI 与自定义 ACP Agent 接入 | [CLI Agent 指南](../prototypes/live2d-codex/CLI-AGENTS.md) |
| 本机存储、隔离与网络边界 | [隐私说明](privacy.md) |
| 开源许可与第三方合规分发 | [许可说明](licenses.md)、[随包第三方声明](../prototypes/live2d-codex/THIRD-PARTY-NOTICES.md)、[CPU 语音对应源码说明](../tools/release/corresponding-source.md) |
| 自动化验证、探针与人工验收 | [验收清单](../tools/release/TEST-ACCEPTANCE.md)、[QA 工具说明](../tools/qa/README.md)、[协议探针](../tools/probes/README.md)、[RC003 硬件诊断](../tools/remote-diagnostics/README.md) |

本目录只保留当前使用、架构与构建、隐私、许可和支持边界说明，并由 `npm run check:project` 与 `npm run check:public` 自动校验内部链接、版本号一致性和公开路径边界。本机历史研究与开发过程资料集中归档在忽略的 `work/archive`，不作为当前操作指南或公开源码依赖；已提交的历史仍可在 Git 中查阅。目录职责与模块结构见[架构与构建说明](build.md#目录约定)。
