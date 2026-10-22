# 界面验收工具

维护入口为 `node tools/qa/gui/run.mjs`，默认只显示帮助。先构建应用、准备相应视觉资源，并在主应用可解析的位置安装 Playwright，或用 `VIBE_PLAYWRIGHT` 指定已有模块。没有把 Playwright 作为普通测试的必需依赖。

```powershell
npm run build
node tools/qa/gui/run.mjs --case=bubble-drag --run
node tools/qa/gui/run.mjs --case=avatar-controls --run
node tools/qa/gui/run.mjs --case=character-switch --run
```

显式运行会启动真实 Electron、连接本机 CLI，并可能显示/移动测试窗口；不会发送 Agent 提示词、加载语音模型或读取原有应用数据。先退出正在运行的 Rin，避免应用的单实例机制接管测试启动。输出、应用数据和测试项目分别位于每次新建的 `work/qa/gui-*/<时间与随机后缀>/`；可用 `--output=work/qa/新的目录` 指定位置，已有目录一律拒绝复用。

| 用例 | 模式 | 验收内容 |
| --- | --- | --- |
| [avatar-controls](cases/avatar-controls.mjs) | avatar | 缩放、重置、原生菜单、退出和重启恢复 |
| [avatar-drag](cases/avatar-drag.mjs) | avatar | 真实指针拖动和人物尺寸稳定 |
| [placement](cases/placement.mjs) | avatar | 气泡对齐、阅读、Markdown、布局与透明度；支持 `--initial-only` |
| [bubble-drag](cases/bubble-drag.mjs) | wallpaper | 气泡拖动、焦点呼回、草稿、位置恢复、高 DPI |
| [character-switch](cases/character-switch.mjs) | wallpaper | 人物加载失败、重试、快速切换、声线与重启恢复；可追加 `--package=便携包目录` |

原来的 `check-avatar-controls`、`check-avatar-drag`、`check-placement`、`check-bubble-drag` 与 `verify-character-switch` 路径转发到上述实现，默认也只显示帮助。三个 avatar 验收现在明确使用 avatar 模式。普通自动测试检查这些默认门槛，不代表真实 GUI 已验收。

## 历史工具去向（2026-10-21）

15 个旧 `check-*.mjs` 原文，以及迁移前的人物切换工具，完整保存在本机 `work/archive/gui-acceptance-2026-10-21/`；`manifest.json` 记录原路径、SHA-256 与维护替代。原始验收数据和历史证据保持原位。

| 历史入口 | 当前替代或保留原因 |
| --- | --- |
| check-characters | character-switch；旧脚本含模型检查，不作为普通人物回归 |
| check-bubble、check-ui | placement、bubble-drag；旧 DOM/CDP 检查保留为历史 |
| check-review-fixes | Agent 契约、草稿和输入单元测试；旧脚本含真实 Agent 提示词 |
| check-integration | 历史集成验收；正式多CLI与遥控器闭环由AGT-03/04/05和REM-02至06重新验收 |
| check-package、check-final-package | 旧机器/包路径验证；当前发布流程及 REL 任务接管 |
| check-complete-narration、check-resident-speech、check-resident-ui | 真实模型/声音验收原文保留；离线边界由FIX-01/03回归覆盖，真实声音和安装候选由AGT-03/04/05及REL-01接管 |
| check-wallpaper | 历史场景采样；当前人物切换和壁纸验收任务接管 |

以上 11 个入口的归档提示桩已从主应用 scripts 目录移出，保存在本机 `work/archive/project-quality-2026-10-21/retired-entrypoints/` 并附哈希清单；原始验收实现仍在前述历史归档。维护目录只保留五个实际转发入口。若后续任务需要复用历史断言，应先迁入这里并采用隔离上下文，而不是直接批量执行归档。设备、模型和发布验收仍按[测试规范](../../../docs/development/testing.md)记录真实结果。
