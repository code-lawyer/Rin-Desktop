# 界面验收工具

旧窗口操作用例的维护入口为 `node tools/qa/gui/run.mjs`，默认只显示帮助。先构建应用、准备相应视觉资源；除人物切换外，还需在主应用可解析的位置安装 Playwright，或用 `VIBE_PLAYWRIGHT` 指定已有模块。没有把 Playwright 作为普通测试的必需依赖。

```powershell
npm run build
node tools/qa/gui/run.mjs --case=bubble-drag --run
node tools/qa/gui/run.mjs --case=avatar-controls --run
npm run qa:stills -- --character-switch
```

四个旧窗口用例显式运行会启动真实 Electron、连接本机 CLI，并可能显示/移动测试窗口；不会发送 Agent 提示词、加载语音模型或读取原有应用数据。先退出正在运行的 Rin，避免应用的单实例机制接管这些测试启动。输出、应用数据和测试项目分别位于每次新建的 `work/qa/gui-*/<时间与随机后缀>/`。

壁纸风格切换沿用兼容命令 `qa:stills -- --character-switch`，使用生产页面、preload、壁纸提交逻辑及真实存储，加合成后端和隔离 Electron；不需要 Playwright，不连接 CLI、账户、麦克风或遥控器。它拦截当前 PNG 请求，验证失败、重复重试、快速切换、声线和另一个新进程的存储恢复；动态媒体另用 `npm run qa:motion -- --run`。输出在 `work/qa/still-desktop/<时间与随机后缀>/`。两类工具均可用 `--output=work/qa/新的目录` 指定位置，已有目录一律拒绝复用。

| 用例 | 模式 | 验收内容 |
| --- | --- | --- |
| [avatar-controls](cases/avatar-controls.mjs) | avatar | 缩放、重置、原生菜单、退出和重启恢复 |
| [avatar-drag](cases/avatar-drag.mjs) | avatar | 真实指针拖动和人物尺寸稳定 |
| [placement](cases/placement.mjs) | avatar | 气泡对齐、阅读、Markdown、布局与透明度；支持 `--initial-only` |
| [bubble-drag](cases/bubble-drag.mjs) | wallpaper | 气泡拖动、焦点呼回、草稿、位置恢复、高 DPI |
| [character-switch](cases/character-switch.mjs) | 隔离生产 renderer | 转发 `qa:stills -- --character-switch`；当前图片失败、重试、快速切换、声线及新进程恢复 |

原来的 `check-avatar-controls`、`check-avatar-drag`、`check-placement`、`check-bubble-drag` 与 `verify-character-switch` 路径转发到上述实现，默认也只显示帮助。人物切换的两个兼容入口仍要求 `--run`；旧 `--package` 明确拒绝，不能用源代码隔离验证声称安装包验收，实际包按[验收清单](../../release/TEST-ACCEPTANCE.md)另测。三个 avatar 验收明确使用 avatar 模式。普通自动测试检查默认门槛和当前图片请求契约，不代表真实 GUI 已验收。
