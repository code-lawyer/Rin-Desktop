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

单元测试和前端构建不需要语音模型。Windows 设备组件可执行 `npm run qa:remote-component` 编译并检查管道，不访问设备。源码初次连接时自动准备组件；打包脚本预编译到 runtime，使用 Windows 自带 .NET Framework 4.8 和 WinMetadata，不依赖 Python 或 Windows SDK。用户自行安装所选 Agent 的 Windows 原生 CLI：Codex、Claude Code、Grok Build 或 OpenCode V2。新版协议依赖锁定在应用目录的 `package-lock.json`；发布脚本收集 SDK 及必要依赖，不打包 CLI 程序或账号。新增 Agent 的使用和手动验收见 [CLI Agent 说明](../prototypes/live2d-codex/CLI-AGENTS.md)；基础构建通过不等于新增后端完成主应用验收，当前范围见[项目状态](project-status.md)。应用的 Node 运行时、默认女性壁纸与 Cubism Core 从锁定的基础安装包获取。新增男性人物运行资源和两张设置预览位于源码的 `assets/rainy-window-male` 与 `assets/character-previews`，打包时使用源码中的版本。

RC003 输入层还使用锁定的 Koffi 3.3.3 和 `@koromix/koffi-win32-x64` 预编译包，通过上述 npm 安装。不要省略 Windows 本平台的 optional dependency。打包脚本显式复制该原生包及许可，并在输出目录加载输入模块；组件检查还在独立副本中用 Electron 的 Node 模式核对加载。连接、按钮设置、麦克风和待验收范围见 [RC003 接入说明](development/remote-integration.md)。

```powershell
npm run resources
```

这条命令按 `tools/release/resource-manifest.json` 下载基础安装包，校验 SHA-256 后以不注册安装项的方式解包到 `work/release-resources/版本号`。不下载语音模型或 CLI。源码树缺失的运行时与 Core 目录会连接到解包目录；壁纸资源逐项补齐，已有男性素材和预览不覆盖。请先阅读第三方许可。

准备好后，在仓库根目录运行：

```powershell
npm start -- --check
npm start
```

双击根目录 `启动 Rin Desktop.cmd` 使用同一启动器；旧“雨夜壁纸”和“整合壁纸”快捷入口也指向当前源码。`npm --prefix prototypes/live2d-codex start` 保留为兼容入口。所有这些入口都不会扫描 `release/` 并回退到旧可执行文件。只读检查不会启动 Electron 或下载模型；缺少条件会明确报错。

默认使用壁纸和上次选择的 Agent。`npm start -- --provider=codex` 可明确选择后端；`--project="项目路径"`、`--storage="数据路径"` 支持空格，相对路径以仓库根目录为准。参数名使用小写，未知参数会报错。源码默认沿用 `work/runtime/avatar`，不覆盖安装版数据。双击入口等待构建及进程启动成功，失败时显示错误；启动器与应用日志均在 `work/runtime/launcher`。需要实时看错误时使用终端 `npm start`。切换已运行的安装版和源码版前先从托盘退出原实例。

`npm run start:avatar` 需要本地旧 Hiyori 素材；`npm run start:dots` 需要本地私人桥接。它们不构成公开安装版的新功能。`npm run remote:diagnose` 是需要单独准备环境的硬件诊断，不会随正常启动自动运行。

人物切换的原生回归检查需要已安装的 Playwright，可通过 `VIBE_PLAYWRIGHT` 指定其模块路径。先运行 `npm run build`，再执行 `node tools/qa/gui/run.mjs --case=character-switch --run`；验证便携包时追加 `--package=便携包绝对目录`。旧verify-character-switch路径也转发同一实现，默认帮助，需显式追加`--run`。检查使用独立临时数据，覆盖模型与贴图加载失败、明确重试、声线保留、快速切换和重启恢复，不发送对话或加载语音模型，结果保存在每次新建的 `work/qa/gui-character-switch/` 子目录。

```powershell
$env:VIBE_RESOURCE_APP = (Resolve-Path 'work/release-resources/0.4.0/resources/app').Path
$env:INNO_ISCC = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
npm run package
```

打包始终写入新的版本目录，已有目录会被拒绝。输出独立基础安装器，先检查根目录与应用版本一致，并拒绝覆盖已有安装器输出，再将锁定哈希写入仓库内的 `tools/release/resource-manifest.json`，不将模型或 CLI 加入应用。运行源码可执行 `npm --prefix prototypes/live2d-codex start`；语音仍在应用内按需下载。

内部验收使用 `npm run package:test -- --id=<新的测试标识>`，需要相同资源、Inno Setup 和 Windows tar。该命令生成独立 ZIP 与测试安装器、文件/源码指纹、离线检查、数据恢复和验收表，输出 `release/test-builds/<标识>`；不修改正式资源清单、基础版本或已有产物。测试安装器使用独立 AppId/目录/快捷方式，测试数据默认隔离。构建不启动真实 Agent 或硬件，人工验收按[测试清单](development/test-acceptance.md)进行。

语音模型不打包、不上传到本项目 Release。`prototypes/live2d-codex/voice-resources.json` 只保存上游仓库、固定 revision、文件大小和 SHA-256。运行 `node tools/release/build-voice-manifest.mjs` 可从 Hugging Face 元数据重建清单；清单生成器不会下载权重。资源目录版本独立于应用版本，普通应用升级不触发重复模型下载。

首次启用 Qwen 时，在用户数据目录中下载并校验 Astral 的 uv，由其从上游准备 Python 3.12.14，并按 `backend/qwen-requirements.txt` 的版本与哈希安装依赖。Python 保存在该 Qwen 资源目录内，不改系统环境。依赖锁变更后必须重新做全新目录安装、移动目录和实际合成测试。不要把维护者的 Python 环境复制到发布包。

发布前运行 `npm run check:public` 检查当前工作区的公开文件，再用 `node tools/release/audit-public.mjs --staged` 检查实际暂存内容；继续运行单元测试、原生界面测试、独立目录安装与卸载测试。核对许可和对应源码包；每个 Release 资产必须小于 GitHub 的单文件限制。请勿使用 `git add .` 代替公开文件清单审计。

应用 Release 只上传 `Rin-Desktop-版本-Setup.exe`，不要将开发用 JSON 清单、校验清单或第三方源码混入普通用户的安装附件。版本和安装包校验值保存在仓库清单中；`voice-resources.json` 已随应用提供。

第三方对应源码单独保存在 `third-party-source-v版本` 的开发者发布页。首次分离已有源码附件时，先创建与该应用版本相同提交的开发者草稿，在 Actions 手动运行 `Archive third-party source`，填写应用版本和开发者发布页 ID。流程会在 GitHub 端复制并核对 SHA-256。确认新页面公开可下载后，才能移除应用 Release 中的原源码附件。开发者发布页标记为非应用更新，不能替换 Latest 应用版本；README 和应用发布说明保留对应源码的明确入口。
