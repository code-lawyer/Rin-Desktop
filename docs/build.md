# 从源码构建

Windows x64，Node.js 24 或更高，npm，Inno Setup 6.7.3。安装器构建使用官方 Inno Setup 编译器；通过 `INNO_ISCC` 指定 `ISCC.exe` 的绝对路径。

```powershell
npm ci
npm --prefix prototypes/live2d-codex ci
npm run status
npm run check:project
npm test
npm run build
```

单元测试和前端构建不需要语音模型。Windows 设备组件可执行 `npm run qa:remote-component` 编译并检查管道，不访问设备。源码初次连接时自动准备组件；打包脚本预编译到 runtime，使用 Windows 自带 .NET Framework 4.8 和 WinMetadata，不依赖 Python 或 Windows SDK。用户自行安装所选 Agent 的 Windows 原生 CLI：Codex、Claude Code、Grok Build 或 OpenCode V2。新版协议依赖锁定在应用目录的 `package-lock.json`；发布脚本收集 SDK 及必要依赖，不打包 CLI 程序或账号。新增 Agent 的使用和手动验收见 [CLI Agent 说明](../prototypes/live2d-codex/CLI-AGENTS.md)；基础构建通过不等于新增后端完成主应用验收，当前范围见[项目状态](project-status.md)。应用的 Node 运行时、默认女性壁纸与 Cubism Core 从锁定的基础安装包获取。当前壁纸使用 `assets/scene/rin-poses` 完整姿态、`assets/motion/female` 真人视频，并保留 `assets/stills` 兼容素材与回退图；男士资源已删除，旧安装包恢复工具会过滤它们，打包保留兼容女生素材并明确排除男士资源。

RC003 输入层还使用锁定的 Koffi 3.3.3 和 `@koromix/koffi-win32-x64` 预编译包，通过上述 npm 安装。不要省略 Windows 本平台的 optional dependency。打包脚本显式复制该原生包及许可，并在输出目录加载输入模块；组件检查还在独立副本中用 Electron 的 Node 模式核对加载。连接、按钮设置、麦克风和待验收范围见 [项目状态](project-status.md)。

动漫动态角色使用自有 WebGL2 完整姿态渲染器。运行素材位于 `assets/scene/rin-poses`，已经随源码提供，普通构建不需要生成工具或在线账户。维护者重建素材可使用 `npm run art:pose-avatar -- --run`；检查输出后加 `--install` 写入运行资源目录。输入与素材条款见[完整姿态说明](../prototypes/live2d-codex/assets/scene/rin-poses/README.md)。Sharp 仅用于构建素材，不随应用运行。旧 `rin` 目录和骨骼制作工具保留作为源文件，不在当前主应用中加载或打包。

执行 `npm run test:puppet` 与 `npm run test:poses` 验证口型包络、播放所有权、素材完整性、全部姿态组合、唤醒中断和快速改选。`npm run qa:poses -- --run` 生成约 22 秒切换样片和表情帧，在真实 WebGL 中检查固定背景、身体像素不受表情影响、零透明度时完全退场，以及像素转场的原画端点、完全消隐、背景固定和可见马赛克差异；需要本机 FFmpeg。加 `--stills` 只生成检查帧，不需要 FFmpeg。构建后执行 `npm run qa:puppet -- --run`，在隔离 Electron 中操作五个姿态按钮，检查唤醒与恢复、暂停、减少动态效果、合成 PCM 口型、素材失败、反复重载及 WebGL 丢失恢复。输出位于 `work/qa/pose-visual` 与 `work/qa/puppet-desktop`，还需观看实际效果，不能用测试通过代替美术验收。这些检查不调用账户、摄像头、麦克风或真实语音模型。打包入口校验原画、完整人物贴图和表情区域，拒绝缺失、路径越界、无效配置、尺寸及哈希不符；仅复制运行文件白名单与素材条款。

需要比较切换节奏时，运行 `npm run qa:pose-options -- --run`。它使用相同原画渲染四种候选淡化，输出单独视频与同步四格对照至 `work/qa/pose-transition-options`。增加 `--cyber` 可生成像素、竖条、点阵和故障效果的 Canvas2D 转场原型，输出至 `work/qa/pose-cyber-options`。应用使用已选定的 A 像素重组，默认 1.1 秒分解、0.1 秒停顿、1.6 秒聚合；对照工具不会更改这些参数。这是独立视觉对照工具，需要本机 FFmpeg。

构建内部测试包后，运行 `npm run qa:release-package -- --package=<包目录>` 核对全部字节、源码与许可，再运行 `npm run qa:puppet-package -- --run --package=<包目录>`。后者启动真正的测试包主程序，使用隔离数据与明确不可用的 CLI，不连接账户、不把测试壁纸挂到日用桌面；验证两种风格、声线、正常退出与新进程恢复。安装器可用 `/PORTABLE=1` 解包到新验证目录后再运行这些检查；这不等于新机器注册安装、卸载或物理显示验收。

```powershell
npm run resources
```

这条命令按 `tools/release/resource-manifest.json` 下载基础安装包，校验 SHA-256 后以不注册安装项的方式解包到 `work/release-resources/版本号`。不下载语音模型或 CLI。源码树缺失的运行时与 Core 目录会连接到解包目录；壁纸资源递归补齐缺失文件，已有文件保留，且不写入目录联接指向的其他位置。补齐后校验动态媒体的大小与哈希，不能只因目录或清单已存在就跳过视频。请先阅读第三方许可。

当前清单锁定0.6.2应用安装包。默认从该版本Release下载；已有同版安装包时可使用下列命令，仍须通过清单的大小和SHA-256校验，不能换成任意安装器。它仅提供锁定的视觉/基础运行资源，不会用安装包中的应用代码覆盖当前源码或Electron依赖。

```powershell
npm run resources -- --installer="release/v0.6.2/Rin-Desktop-0.6.2-Setup.exe"
```

准备好后，在仓库根目录运行：

```powershell
npm start -- --check
npm start
```

双击根目录 `启动 Rin Desktop.cmd` 使用同一启动器；旧“雨夜壁纸”和“整合壁纸”快捷入口也指向当前源码。`npm --prefix prototypes/live2d-codex start` 保留为兼容入口。所有这些入口都不会扫描 `release/` 并回退到旧可执行文件。只读检查不会启动 Electron 或下载模型；缺少条件会明确报错。

默认使用壁纸和上次选择的 Agent。`npm start -- --provider=codex` 可明确选择后端；`--project="项目路径"`、`--storage="数据路径"` 支持空格，相对路径以仓库根目录为准。参数名使用小写，未知参数会报错。源码默认沿用 `work/runtime/avatar`，不覆盖安装版数据。双击入口等待构建及进程启动成功，失败时显示错误；启动器与应用日志均在 `work/runtime/launcher`。需要实时看错误时使用终端 `npm start`。切换已运行的安装版和源码版前先从托盘退出原实例。

`npm run start:avatar` 需要本地旧 Hiyori 素材；`npm run start:dots` 需要本地私人桥接。它们不构成公开安装版的新功能。`npm run remote:diagnose` 是需要单独准备环境的硬件诊断，不会随正常启动自动运行。

壁纸风格切换回归先运行 `npm run build`，再执行 `npm run qa:stills -- --character-switch`。它使用生产页面、preload、真实存储与合成后端，在隔离 Electron 中验证当前图片失败、明确重试、声线保留、快速切换和新进程恢复；不需要 Playwright，不连接 CLI、账户或设备。结果保存在每次新建的 `work/qa/still-desktop/` 子目录，可追加 `--output=work/qa/新的目录`。旧 GUI character-switch 与 verify-character-switch 路径仍可带 `--run` 转发，默认仅帮助。旧 `--package` 已明确退役；安装包必须按当前发布验收清单单独验证，不能用源码 fixture 代替。动态媒体使用 `npm run qa:motion -- --run`。

```powershell
$resourceVersion = (Get-Content tools/release/resource-manifest.json -Raw | ConvertFrom-Json).version
$env:VIBE_RESOURCE_APP = (Resolve-Path "work/release-resources/$resourceVersion/resources/app").Path
$env:INNO_ISCC = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
npm run package
```

打包始终写入新的版本目录，已有目录会被拒绝。输出独立基础安装器，先检查根目录与应用版本一致，并拒绝覆盖已有安装器输出，再将锁定哈希写入仓库内的 `tools/release/resource-manifest.json`，不将模型或 CLI 加入应用。运行源码可执行 `npm --prefix prototypes/live2d-codex start`；语音仍在应用内按需下载。

当前两态动态分支还要求 `prototypes/live2d-codex/assets/motion/female/manifest.json` 与正式四段视频、两张回退图。清单沿用播放器的 `format: 1`、`clips`、`posters`，并增加 `integrity`：以六个媒体文件名为键，记录各自的正整数字节数 `bytes` 与小写 SHA-256 `sha256`。四个片段ID为 `work-loop`、`work-user`、`user-loop`、`user-work`；每个条目包含独立的 `.mp4` 文件名、实际 `duration` 与 `fps`，两张 `.png` 由 `posters.work/user` 指定。

正式/测试/便携打包入口在写入新包之前校验这些文件，缺失或哈希不符会停止；只收集六个媒体和规范化运行清单，不把生成账户响应、母片或制作目录整体打包。复制后的字节再次校验，最后才写运行清单。安装包核查还将这六个媒体与当前源码资源逐项比较。完整性校验不代表接缝、4K效果或许可验收。源代码、媒体完整性与实际安装验收分别记录。已发布0.5.0的基础资源不包含本次四段视频；0.6.0旧候选也不包含2026-10-28后续代码与安全修复，不能用版本号代替包内容核对。

内部验收使用 `npm run package:test -- --id=<新的测试标识>`，需要相同资源、Inno Setup 和 Windows tar。该命令生成独立 ZIP 与测试安装器、文件/源码指纹、离线检查、数据恢复和验收表，输出 `release/test-builds/<标识>`；不修改正式资源清单、基础版本或已有产物。测试安装器使用独立 AppId/目录/快捷方式，测试数据默认隔离。构建不启动真实 Agent 或硬件，人工验收按[测试清单](../tools/release/TEST-ACCEPTANCE.md)进行。

供用户下载安装的候选也使用此隔离入口：先同步根目录、应用及两个 lockfile 的候选版本号，提交并推送已审计源码，再以唯一测试标识构建。GitHub Release 标记为预发布，标签指向构建记录中的源码提交，仅上传经过安装验证的 Setup。公开下载文件可命名为 `Rin-Desktop-<候选版本>-Setup.exe`，但必须与原测试安装器逐字节一致；保留包内测试标识、隔离目录和验收说明。候选不替换稳定版 Latest，也不更新稳定资源清单。

语音模型不打包、不上传到本项目 Release。`prototypes/live2d-codex/voice-resources.json` 只保存上游仓库、固定 revision、文件大小和 SHA-256。运行 `node tools/release/build-voice-manifest.mjs` 可从 Hugging Face 元数据重建清单；清单生成器不会下载权重。资源目录版本独立于应用版本，普通应用升级不触发重复模型下载。

首次启用 Qwen 时，在用户数据目录中下载并校验 Astral 的 uv，由其从上游准备 Python 3.12.14，并按 `backend/qwen-requirements.txt` 的版本与哈希安装依赖。Python 保存在该 Qwen 资源目录内，不改系统环境。依赖锁变更后必须重新做全新目录安装、移动目录和实际合成测试。不要把维护者的 Python 环境复制到发布包。

发布前运行 `npm run check:public` 检查当前工作区的公开文件，再用 `node tools/release/audit-public.mjs --staged` 检查实际暂存内容；继续运行单元测试、原生界面测试、独立目录安装与卸载测试。核对许可和对应源码包；每个 Release 资产必须小于 GitHub 的单文件限制。请勿使用 `git add .` 代替公开文件清单审计。

应用 Release 只上传 `Rin-Desktop-版本-Setup.exe`，不要将开发用 JSON 清单、校验清单或第三方源码混入普通用户的安装附件。版本和安装包校验值保存在仓库清单中；`voice-resources.json` 已随应用提供。

第三方对应源码单独保存在 `third-party-source-v版本` 的开发者发布页。首次分离已有源码附件时，先创建与该应用版本相同提交的开发者草稿，在 Actions 手动运行 `Archive third-party source`，填写应用版本和开发者发布页 ID。流程会在 GitHub 端复制并核对 SHA-256。确认新页面公开可下载后，才能移除应用 Release 中的原源码附件。开发者发布页标记为非应用更新，不能替换 Latest 应用版本；README 和应用发布说明保留对应源码的明确入口。
