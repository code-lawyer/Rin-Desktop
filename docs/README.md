# Rin Desktop 文档索引

持续开发从[开发手册](development/README.md)开始；进度以[统一施工清单](development/progress.md)为准。项目已形成壁纸＋Codex＋本地语音主应用；专用 RC003 设备链路和新多 CLI 仍需产品验收。更新于 2026-10-22。

| 要解决的问题 | 阅读位置 |
| --- | --- |
| 安装和日常使用 | [根 README](../README.md)、[用户指南](../prototypes/live2d-codex/PORTABLE-README.md) |
| 哪些已完成、哪些还分开 | [项目状态、目录职责、GitHub 关系](project-status.md) |
| 下一步先做什么 | [项目计划](../PROJECT_PLAN.md) |
| 产品目标、架构和阶段路线 | [产品](development/product.md)、[架构](development/architecture.md)、[开发计划](development/roadmap.md) |
| 所有施工事项和历史编号去哪了 | [进度表](development/progress.md)、[逐条归并](development/legacy-reconciliation.md) |
| 文件整理、测试和交接 | [目录地图](development/repository-map.md)、[测试规范](development/testing.md)、[贡献流程](../CONTRIBUTING.md) |
| 全面审查发现的问题是否已修复 | [0.5.0 全面审查](development/release-0.5.0-review.md)、[前轮修复记录](development/review-fixes.md) |
| 数据保护和 Agent 契约交付、测试包怎么验 | [本轮交付](development/data-agent-validation.md)、[验收清单](development/test-acceptance.md) |
| 如何准备和启动源码、检查与打包 | [构建说明](build.md) |
| 新 CLI 的配置和验收边界 | [CLI Agent 接入](../prototypes/live2d-codex/CLI-AGENTS.md) |
| 数据保存、网络来源 | [隐私与数据](privacy.md) |
| 许可与第三方源码 | [许可说明](licenses.md) |
| 已发布版本实际验了什么 | [发布记录](release-audit.md) |

本机早期 00–12 文档和旧示例已实际归档到 `docs/history/controller-v0.2`。`docs/history`、`docs/research`、`docs/evidence` 及 `work` 的原始研究与验收保持私人范围。公共手册已经提供开发所需的现状、旧事项摘要及复现方法，不能要求新开发者先读私人记录或对话。

维护规则：先更新当前状态与验收范围，再同步受影响的用户/开发文档。明确区分代码存在、自动测试、真实软件验收和真实硬件验收；公开文档不链接仅存在于私人目录的证据正文，公共分发边界仍按 Git 忽略规则及发布清单执行。
