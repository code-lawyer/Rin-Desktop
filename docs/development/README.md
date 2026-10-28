# Rin Desktop 开发手册

这是持续开发的入口。阅读本目录即可了解产品目标、当前实现、待办、验收和发布方式，不需要本次对话或维护者的私人研究目录。产品工作名曾为 Vibe Voice；仓库名为 Rin-Desktop，本机目录名与用户数据目录为兼容保留。

## 首次接手

1. 阅读[产品目标与范围](product.md)，明确已发布能力和目标能力。
2. 阅读[架构与技术路线](architecture.md)及[目录地图](repository-map.md)，找到需要修改的模块。
3. 查看[进度与施工清单](progress.md)，选一个任务 ID，确认前置任务与验收条件。最新发布核对见[0.6.1最终审查与发布验证](release-0.6.1-review.md)，全项目检查见[2026-10-28全面审查与清理](project-audit-2026-10-28.md)，历史[静态壁纸集成后的审查](project-review-2026-10-22.md)，其中五项问题已完成[修复与双轴复审](five-fixes-review-2026-10-22.md)；已发布版本与前轮记录见[0.5.0 审查与修复](release-0.5.0-review.md)、[质量审查与清理](quality-audit.md)。DATA-01/02 与 Agent 既有离线契约见[数据与契约交付](data-agent-validation.md)。后续用[测试包验收清单](test-acceptance.md)完成真实账户、RC003 与安装验证；RC003 代码边界见[接入说明](remote-integration.md)。
4. 按[构建说明](../build.md)安装依赖；先跑不调用真实账户的检查，再按任务需要启动桌面或做硬件验收。
5. 完成后更新台账与证据，按[贡献流程](../../CONTRIBUTING.md)提交。当前工作区修改、已提交源码、GitHub 分支和已发布安装包是不同状态。

```powershell
npm ci
npm --prefix prototypes/live2d-codex ci
npm run check:project
npm test
npm run build
npm run check:public
npm run status
```

以上测试不需要语音模型、真实 Agent 账户或遥控器。启动当前源码还需准备视觉资源与 Electron，见构建说明；执行 `npm start -- --check` 只检查条件，`npm start` 才构建并打开应用。

## 文档与事实来源

| 内容 | 唯一维护位置 |
| --- | --- |
| 产品目标、范围、用户流程、性能目标 | [product.md](product.md) |
| 当前架构、进程、接口、技术路线 | [architecture.md](architecture.md) |
| 分阶段开发计划与放行标准 | [roadmap.md](roadmap.md) |
| 每项施工的状态、责任角色、依赖、位置、验收、证据 | [backlog.json](backlog.json)，生成[进度表](progress.md) |
| 旧 G/R/B/T/S/D/K 编号的逐项去向 | [legacy-mapping.json](legacy-mapping.json)，生成[历史归并表](legacy-reconciliation.md) |
| 当前结构及实际文件迁移 | [repository-map.md](repository-map.md)、[目录规则](repository-layout.json) |
| 自动测试、真实工具、硬件和安装验收 | [testing.md](testing.md) |
| 数据保护、GitHub 同步、分发与回滚 | [data-and-release.md](data-and-release.md) |
| 已采用路线、仍需决定的问题与风险 | [decisions.md](decisions.md) |
| 文件整理和交接的历史验证 | [verification.md](verification.md) |
| 前轮审查缺陷修复与工具迁移记录 | [review-fixes.md](review-fixes.md) |
| 最新全项目审查与修复 | [2026-10-28全面审查与清理](project-audit-2026-10-28.md)；历史[原审查记录](project-review-2026-10-22.md)、[五项修复与复审](five-fixes-review-2026-10-22.md)；历史修复与清理见[quality-audit.md](quality-audit.md) |
| 前端视觉与布局终验 | [静态人物、气泡、工作台及遥控焦点](visual-final-check-2026-10-22.md)；新姿态超分4K细节与系统显示环境仍待用户验收 |
| 女生状态与动作辨识度反馈 | [六状态实际内容、自动条件与画风差异核查](still-state-diagnosis-2026-10-23.md)；资源接入不等于六种完整动作验收 |
| 女生五姿态第二版 | [同源五图、完整姿态与整帧切换](still-set-v2-implementation.md)；五张3840×2400超分成品已接入，1586×992生成原图保留；[本轮审查](still-set-v2-review-2026-10-23.md)发现FIX-17；[固定场景返修小样及重做方案](still-scene-consistency-2026-10-23.md)仍未通过扶手/靠背验收，需重做精确分层，尚未替换主应用 |
| 数据保护、Agent 契约与当前测试包 | [交付范围](data-agent-validation.md)、[人工验收清单](test-acceptance.md) |
| 两态主应用接入 | [实现与验证](two-state-app-integration-2026-10-27.md)：工作、看向用户各有循环，双向转头使用同一母片；保留静态选择、声线和环境音。419项离线测试、双轴复审、正式4K媒体播放与限定安装生命周期已通过；历史[0.6.0本地候选](release-0.6.0-readiness.md)保留；当前交付与补丁见[0.6.1发布核对](release-0.6.1-review.md) |
| 当前人物壁纸方向 | [两态连续母片、四片段](two-state-continuous-master-2026-10-27.md)按明确255积分上限仅生成一次，720p原片和统一超分4K成品保留；已接入主应用，2026-10-28用户实际测试反馈“测试ok”，不替代完整显示/硬件矩阵。ART-09只验证当前两态工程交付，原五姿态家具问题仍保留。历史过程见[三态素材单](three-state-video-kit-2026-10-24.md)、[Dreamina安装授权](dreamina-cli-setup-2026-10-24.md)、[工具与费用](dreamina-three-state-plan-2026-10-24.md)、[首条超分对比](video-upscale-trial-2026-10-24.md)、[六条转场](three-state-transition-production-2026-10-27.md)、[工作循环接缝反馈](work-idle-loop-pilot-2026-10-27.md)和[五姿态方案](five-pose-continuity-plan-2026-10-23.md) |
| 角色陪伴路线探索 | [Olivia Lin 源码与记忆机制核查](olivia-lin-route-research-2026-10-24.md)：EXP-01 仅完成调研，提出独立角色陪伴层小样；未改变当前 Agent 或五姿态美术路线 |
| 历史人物动态试验与研究 | [Live2D 路线](live2d-feasibility.md)、[女生半身验收边界](live2d-halfbody-preview.md)、[参考壁纸资源核查](external-wallpaper-feasibility.md)、[原角色视频制作路线](character-video-reproduction.md)、[独立视频样例](video-companion-preview.md)、[完整桌面视频试用](video-desktop-trial.md)、[写实女生首尾帧与提示词](character-video-keyframes.md)、[16GB 本地视频制作方案](local-video-generation.md) |
| 用户操作、构建、隐私、许可、已发布证据 | [用户入口](../../README.md)、[文档索引](../README.md) |

## 如何保持文档不落后

施工状态只改 `backlog.json`，再运行 `npm run project:docs`。`npm run check:project` 检查任务依赖、历史编号覆盖、代码/证据路径、公共文档链接及生成页是否过期；CI 运行相同检查。新需求增加任务，保留旧 ID，不删除失败证据来制造完成状态。

状态定义：已验证只证明任务写明的范围；已实现表示代码存在但验收不足；施工中表示有人实际在做；待施工尚未落实；后置不属于当前交付。不要把项目进度换算成没有依据的百分比。责任角色是工作归属，不是假定已有专职人员。

私人 Dots、原始研究和设备报告可以辅助开发，但公共文档必须提供足够的脱敏结论和复现方法。当前状态摘要见[项目状态](../project-status.md)，真实已发布范围以[发布审查](../release-audit.md)和对应安装包为准。
