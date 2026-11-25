# 从源码构建

Windows x64，Node.js 24 或更高，npm，Inno Setup 6.7.3。安装器构建使用官方 Inno Setup 编译器；通过 `INNO_ISCC` 指定 `ISCC.exe` 的绝对路径。

## 目录约定

| 目录 | 用途 |
| --- | --- |
| `prototypes/live2d-codex` | 当前主应用，路径为兼容现有入口保留；本机 `models`、`runtime`、`vendor` 与依赖保持原位 |
| `prototypes/video-companion` | 主应用仍在复用的播放器及媒体预览 |
| `prototypes/live2d-halfbody` | 保留的半身预览源码 |
| `prototypes/qwen-tts-evaluation`、`prototypes/dots-bridge` | 本机语音环境与私人桥接，保持原位，不进入公开源码 |
| `docs` | 当前维护的使用、构建、隐私、许可与支持说明 |
| `tools`、`tests` | 维护中的构建、素材制作、验证工具及回归测试 |
| `artwork` | 原始美术与制作输入，保持原位 |
| `work/runtime` | 源码运行数据与设备环境，主应用数据仍为 `work/runtime/avatar` |
| `work/qa` | 源码验证输出，默认按类别与独立运行分层。支持 `--output` 的命令可指定其下的新目录。报告和素材输入不能视作通用缓存删除 |
| `work/release-build/tools`、`work/release-resources` | 打包编译器及锁定的基础运行资源 |
| `work/archive` | 本机历史文档、研究、旧安装器与构建产物；归档脚本仅供追溯，操作使用当前根命令 |
| `release` | 当前候选安装包与第三方对应源码；旧安装器集中保存在本机归档中 |

清理时可移除已保留安装器的重复展开包及可重建缓存；先确认没有运行进程、目录联接或资源引用。模型、运行环境、用户数据、原始美术和私人 Dots 保持原位。

## 系统架构与核心模块

主应用采用 Electron 多进程隔离架构，源码位于 `prototypes/live2d-codex`，通过明确的子进程与存储契约隔离桌面渲染、外部 CLI、本地语音和蓝牙硬件：

| 层级 | 核心文件 | 职责与边界 |
| --- | --- | --- |
| Electron 主进程 | `main.cjs` | 单实例锁、特权只读协议 `app://local`（仅允许访问 `renderer/`、`dist/`、`assets/`、`vendor/`）、窗口 CSP 与 IPC 来源校验、壁纸两阶段原子提交（画面解码并暂存设置后再落盘切换，保留声线）、退出前草稿刷盘确认（`draft:flush`）及全部后台子进程托管 |
| 沙盒渲染窗口 | `preload.cjs`、`renderer/index.html`、`renderer/workbench.html`、`dist/app.js`、`dist/workbench.js` | 开启 `contextIsolation` 与 `sandbox`，通过预加载脚本公开的 `window.companion` 接口与主进程通信。承载桌面壁纸视图（`still-wallpaper.js`、`puppet-wallpaper.mjs` WebGL2 五种可选姿态及思考原画像素重组、`motion-wallpaper.mjs` 真人两态视频）、悬浮对话气泡（`app.js`、`speech-ui.js`）与项目/设置工作台（`workbench.js`） |
| 桌面层与点击宿主 | `backend/wallpaper-host.cjs`、`scripts/wallpaper-host.ps1`、`scripts/wallpaper-pose-input.cs` | 将应用自有壁纸窗口挂载至 Windows `Progman`/`WorkerW` 桌面图标层后方；动漫模式空闲时通过低层鼠标观察判断桌面露出人物单击并原样放行系统鼠标事件 |
| 多 Agent 协议适配 | `backend/agent-catalog.cjs`、`backend/codex.mjs`、`backend/acp-agent.mjs`、`backend/claude-agent.mjs`、`backend/native-agent.mjs` | 从固定目录选择后端，以 `shell: false` 运行本机 CLI。Codex 使用 `app-server` stdio JSON-RPC，Antigravity、Grok Build 和 DeepSeek Harness 使用 ACP v1 stdio，Claude 使用官方 Agent SDK 和 API 认证。凭据与完整历史归原生 CLI，Rin 的非 Codex 会话缓存最近 200 条显示消息 |
| 本地语音与资源 | `backend/resident-speech.mjs`、`backend/speech-worker.cjs`、`backend/qwen-speech.mjs`、`backend/qwen-worker.py`、`backend/voice-resources.mjs` | 独立 `runtime/node.exe` 子进程加载 `sherpa-onnx-node`（GPL-3.0-or-later 组合边界，仅交换 JSON 与 PCM）执行 SenseVoice 听写和 Kokoro 朗读；可选独立 Python 3.12 环境运行 Qwen3-TTS GPU 合成；上游模型按固定 revision 与 SHA-256 校验下载 |
| RC003 遥控器层 | `backend/remote-controller.mjs`、`backend/remote-input.cjs`、`backend/remote-native.mjs`、`native/rc003-helper.cs` | C# 原生辅助进程（`runtime/rc003-helper.exe`）负责 BLE GATT/ATVV 16 kHz ADPCM 语音流，Koffi 绑定 Win32 Raw Input 区分遥控器按键与普通键盘/输入法 |
| 持久化与回执保护 | `backend/workspace-store.mjs`、`backend/submission-guard.mjs`、`backend/durable-json.mjs`、`backend/data-recovery.mjs` | 按 `[provider, cwd, threadId]` 隔离草稿，写入使用临时文件 `fsync`、`.bak` 备份与原子重命名。发送前记录基线，断线回执不明时保留原稿供核查，绝不自动重发 |
| 工程与发布工具链 | `tools/project/*`、`tools/release/*`、`tools/qa/*`、`tools/probes/*` | 统一启动器、文档链接与版本一致性检查（`check:project`）、工作区公开审计（`check:public`）、Git 暂存区公开审计（`node tools/release/audit-public.mjs --staged`）、Inno Setup 打包与产物字节级校验 |

## 准备与验证

```powershell
npm ci
npm --prefix prototypes/live2d-codex ci
npm run status
npm run check:project
npm test
npm run build
```

单元测试和前端构建不需要语音模型。Windows 设备组件可执行 `npm run qa:remote-component` 编译并检查管道，不访问设备。源码初次连接时自动准备组件。打包脚本使用 Windows 自带 .NET Framework 4.8 和 WinMetadata 预编译到 runtime，不依赖 Python 或 Windows SDK。

用户自行安装所选 Agent 的 CLI。协议依赖锁定在应用目录的 `package-lock.json`。应用包收集 ACP SDK 及其依赖，Claude Agent SDK 由安装版用户从 npm 单独安装。覆盖升级会清理旧应用目录里的自定义 Agent 模块和旧版随 Claude SDK 打包的专属依赖。安装准备见 [CLI Agent 说明](../prototypes/live2d-codex/CLI-AGENTS.md)。真实账户和主应用验收范围见 [项目状态](project-status.md)。

应用的 Node 运行时与真人壁纸媒体从锁定的基础安装包获取（历史锁包若含 Cubism Core，也可供源码旧头像模式复用）。安装包从 `assets/scene/rin-poses` 和 `assets/scene/rin-male-poses` 的资源清单打包两套动漫原画，另含 `assets/motion/female` 真人视频、`assets/ambience` 环境音和 `assets/character-previews`、`assets/stills` 预览与兼容回退图。覆盖升级时，`[InstallDelete]` 清理已移除的旧 `Cubism Core`、旧雨夜 Live2D 模型、旧男士壁纸及仅源码使用的历史原型和预览模块。

RC003 输入层还使用锁定的 Koffi 3.3.3 和 `@koromix/koffi-win32-x64` 预编译包，通过上述 npm 安装。不要省略 Windows 本平台的 optional dependency。打包脚本显式复制该原生包及许可，并在输出目录加载输入模块；组件检查还在独立副本中用 Electron 的 Node 模式核对加载。连接、按钮设置、麦克风和待验收范围见 [项目状态](project-status.md)。

`assets/motion/anime` 的动漫动作视频仅保留为本地实验素材；正式入口不加载它们，打包不要求或复制这些媒体及实验播放器。已有原图、视频、提示词和通用模型输入包保持原位。详见[实验素材说明](../prototypes/live2d-codex/assets/motion/anime/README.md)。

两套动漫原画使用自有 WebGL2 渲染器，运行素材随源码提供。女版维护者可用 `npm run art:pose-avatar -- --run` 重建，检查后加 `--install`。素材标准与条款见[女版原画](../prototypes/live2d-codex/assets/scene/rin-poses/README.md)和[男版原画](../prototypes/live2d-codex/assets/scene/rin-male-poses/README.md)。用 `npm run qa:poses -- --run --stills --anime-male` 检查男版画面、表情和转场不变量。Sharp 仅用于制作素材。

构建后运行 `npm run qa:wallpaper-modes -- --run`，在隔离 Electron 中核对旧动漫视频设置兼容、五姿态、真人视频切换与暂停、新进程恢复及声线/项目/草稿保留。输出进入 `work/qa/wallpaper-modes`，使用实际素材与合成后端，不连接账户或挂载日用桌面。

执行 `npm run test:puppet` 与 `npm run test:poses` 验证口型包络、播放所有权、素材完整性、全部姿态组合、唤醒中断和快速改选。`npm run qa:poses -- --run` 生成约 22 秒切换样片和表情帧，在真实 WebGL 中检查固定背景、身体像素不受表情影响、零透明度时完全退场，以及像素转场的原画端点、完全消隐、背景固定和可见马赛克差异；需要本机 FFmpeg。加 `--stills` 只生成检查帧，不需要 FFmpeg。构建后执行 `npm run qa:puppet -- --run`，在隔离 Electron 中操作五个姿态按钮，检查唤醒与恢复、暂停、减少动态效果、合成 PCM 口型、素材失败、反复重载及 WebGL 丢失恢复。输出位于 `work/qa/pose-visual` 与 `work/qa/puppet-desktop`，还需观看实际效果，不能用测试通过代替美术验收。这些检查不调用账户、摄像头、麦克风或真实语音模型。打包入口校验原画、完整人物贴图和表情区域，拒绝缺失、路径越界、无效配置、尺寸及哈希不符；仅复制运行文件白名单与素材条款。

需要比较切换节奏时，运行 `npm run qa:pose-options -- --run`。它使用相同原画渲染四种候选淡化，输出单独视频与同步四格对照至 `work/qa/pose-transition-options`。增加 `--cyber` 可生成像素、竖条、点阵和故障效果的 Canvas2D 转场原型，输出至 `work/qa/pose-cyber-options`。应用使用已选定的 A 像素重组，默认 1.1 秒分解、0.1 秒停顿、1.6 秒聚合；对照工具不会更改这些参数。这是独立视觉对照工具，需要本机 FFmpeg。

构建内部测试包后，运行 `npm run qa:release-package -- --package=<包目录>` 核对全部字节、源码与许可，再运行 `npm run qa:puppet-package -- --run --package=<包目录>`。后者以隔离数据运行测试包主程序，验证三种风格、声线、正常退出与新进程恢复。测试使用明确不可用的 CLI 和独立于日用桌面的壁纸窗口。安装器可用 `/PORTABLE=1` 解包到新验证目录后再运行这些检查。新机器的安装、卸载及物理显示按验收清单另行执行。

真人视频的切换失败回退使用 `npm run qa:wallpaper-recovery -- --run --package=<测试包目录>`：在隔离渲染器中分别注入真实解码错误和首次播放失败，确认原画面与已保存设置不变，再验证显式重试和新进程恢复。测试不改写实际媒体，不连接账户或设备，输出在 `work/qa/wallpaper-recovery-package`。

```powershell
npm run resources
```

这条命令按 `tools/release/resource-manifest.json` 下载基础安装包，校验 SHA-256 后以不注册安装项的方式解包到 `work/release-resources/版本号`。源码树缺失的运行时目录会连接到解包目录，壁纸资源递归补齐缺失文件，已有文件保留。补齐后校验动态媒体的大小与哈希。历史资源包若带有 Core，也可用于准备源码旧头像模式。

当前清单锁定 0.6.3-rc.12 安装包，默认从保留的同版 Release 下载；已有同版安装包时可使用下列命令，仍须通过清单的大小和 SHA-256 校验，不能换成任意安装器。它仅提供锁定的视觉/基础运行资源，不会用安装包中的应用代码覆盖当前源码或 Electron 依赖。使用候选包提供资源不代表其已完成稳定版验收。

```powershell
npm run resources -- --installer="release/test-builds/v0.6.3-rc.12/Rin-Desktop-0.6.3-rc.12-Setup.exe"
```

资源清单指向可下载的 GitHub 安装器。发布候选版时用已构建的安装器生成资源清单，标签包含最终清单。清理旧 Release 前验证新标签的资源恢复入口。从较早的 Git 标签源码归档构建时，若资源链接已失效，可使用当前 `main` 的资源清单和本说明。

准备好后，在仓库根目录运行：

```powershell
npm start -- --check
npm start
```

双击根目录 `启动 Rin Desktop.cmd` 使用同一启动器；旧“雨夜壁纸”和“整合壁纸”快捷入口也指向当前源码。`npm --prefix prototypes/live2d-codex start` 保留为兼容入口。所有这些入口都不会扫描 `release/` 并回退到旧可执行文件。只读检查不会启动 Electron 或下载模型。缺少真人视频资源时，启动器提示 `npm run resources`，已准备就绪的动漫壁纸仍可启动。

默认使用壁纸和上次选择的 Agent。`npm start -- --provider=codex` 可明确选择后端；`--project="项目路径"`、`--storage="数据路径"` 支持空格，相对路径以仓库根目录为准。参数名使用小写，未知参数会报错。源码默认沿用 `work/runtime/avatar`。在源码版选择已有数据副本时，选择记录也保存在该源码数据根，和安装版分开。显式 `--storage` 仍优先。双击入口等待构建及进程启动成功，失败时显示错误；启动器与应用日志均在 `work/runtime/launcher`。需要实时看错误时使用终端 `npm start`。切换已运行的安装版和源码版前先从托盘退出原实例。

`npm run start:avatar` 需要本地旧 Hiyori 素材和 `prototypes/live2d-codex/vendor/live2dcubismcore.min.js`。需要手动准备时，请从 [Live2D Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) 获取并保留其许可。`npm run start:dots` 需要本地私人桥接。`npm run remote:diagnose` 需要单独准备硬件环境。

壁纸风格切换回归先运行 `npm run build`，再执行 `npm run qa:stills -- --character-switch`。它使用生产页面、preload、真实存储与合成后端，在隔离 Electron 中验证当前图片失败、明确重试、声线保留、快速切换和新进程恢复；不需要 Playwright，不连接 CLI、账户或设备。结果保存在每次新建的 `work/qa/still-desktop/` 子目录，可追加 `--output=work/qa/新的目录`。旧 GUI character-switch 与 verify-character-switch 路径仍可带 `--run` 转发，默认仅帮助。旧 `--package` 已明确退役；安装包必须按当前发布验收清单单独验证，不能用源码 fixture 代替。动态媒体使用 `npm run qa:motion -- --run`。

```powershell
$resourceVersion = (Get-Content tools/release/resource-manifest.json -Raw | ConvertFrom-Json).version
$env:VIBE_RESOURCE_APP = (Resolve-Path "work/release-resources/$resourceVersion/resources/app").Path
$env:INNO_ISCC = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
npm run package
```

打包要求根目录与应用版本一致，输出目录必须全新。`npm run package -- --preflight` 在 `work/qa/release-preflight/` 生成使用正式 AppId 的未签名预检包，文件名带 `Preflight`，适合本机隔离解包和兼容性检查。预检保留现有资源锁。预发布版本使用 `npm run package` 时仍更新资源锁。

正式版本号使用 `X.Y.Z`。构建前配置两个环境变量。`RIN_RELEASE_SIGN_SCRIPT` 指向本机签名 PowerShell 脚本，脚本接受一个可执行文件路径，负责用发布者的代码签名身份签名并加时间戳，失败时应返回非零。`RIN_RELEASE_SUBJECT` 设为发布者证书的 Subject。签名脚本和签名服务配置放在本机受控位置。可接入 [Microsoft Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations) 或其他 Windows 公开信任的代码签名服务。

正式构建先签 `VibeVoice.exe` 和 `rc003-helper.exe` 再重建文件清单，随后由 Inno Setup 签安装器和卸载器。包外 `SHA256SUMS.txt` 绑定待验收安装器。完成 [正式候选包验收](../tools/release/TEST-ACCEPTANCE.md#正式候选包)后，把同一份安装器和对应源码归档发到该版本 Release。附件公开后可运行 `node tools/release/lock-resources.mjs` 将资源锁指向已发布安装器。

当前两态动态分支还要求 `prototypes/live2d-codex/assets/motion/female/manifest.json` 与正式四段视频、两张回退图。清单沿用播放器的 `format: 1`、`clips`、`posters`，并增加 `integrity`：以六个媒体文件名为键，记录各自的正整数字节数 `bytes` 与小写 SHA-256 `sha256`。四个片段ID为 `work-loop`、`work-user`、`user-loop`、`user-work`；每个条目包含独立的 `.mp4` 文件名、实际 `duration` 与 `fps`，两张 `.png` 由 `posters.work/user` 指定。

正式/测试/便携打包入口在写入新包之前校验这些文件，缺失或哈希不符会停止；只收集六个媒体和规范化运行清单，不把生成账户响应、母片或制作目录整体打包。复制后的字节再次校验，最后才写运行清单。安装包核查还将这六个媒体与当前源码资源逐项比较。完整性校验不代表接缝、4K效果或许可验收。源代码、媒体完整性与实际安装验收分别记录。早期 0.5.0 / 0.6.0 旧包不包含当前四段视频及后续数据安全修复，不能用版本号代替包内容核对。

内部验收使用 `npm run package:test -- --id=<新的测试标识>`，需要相同资源、Inno Setup 和 Windows tar。该命令生成独立 ZIP 与测试安装器、文件/源码指纹、离线检查、数据恢复和验收表，输出 `release/test-builds/<标识>`；不修改正式资源清单、基础版本或已有产物。测试安装器使用独立 AppId/目录/快捷方式，测试数据默认隔离。构建不启动真实 Agent 或硬件，人工验收按[测试清单](../tools/release/TEST-ACCEPTANCE.md)进行。

供用户下载安装的候选也使用此隔离入口：先同步根目录、应用及两个 lockfile 的候选版本号，提交并推送已审计源码，再以唯一测试标识构建。GitHub Release 标记为预发布，标签指向构建记录中的源码提交，安装器须通过安装验证。公开下载文件可命名为 `Rin-Desktop-<候选版本>-Setup.exe`，但必须与原测试安装器逐字节一致；保留包内测试标识、隔离目录和验收说明。下载指南直接链接候选发布页；只有预发布版本时，不使用 `releases/latest` 入口。资源清单可以锁定已核验的候选安装器，并须实际验证资源恢复。

语音模型不打包、不上传到本项目 Release。`prototypes/live2d-codex/voice-resources.json` 只保存上游仓库、固定 revision、文件大小和 SHA-256。运行 `node tools/release/build-voice-manifest.mjs` 可从 Hugging Face 元数据重建清单；清单生成器不会下载权重。资源目录版本独立于应用版本，普通应用升级不触发重复模型下载。

首次启用 Qwen 时，在用户数据目录中下载并校验 Astral 的 uv，由其从上游准备 Python 3.12.14，并按 `backend/qwen-requirements.txt` 的版本与哈希安装依赖。Python 保存在该 Qwen 资源目录内，不改系统环境。依赖锁变更后必须重新做全新目录安装、移动目录和实际合成测试。不要把维护者的 Python 环境复制到发布包。

发布前运行 `npm run check:public` 检查当前工作区的公开文件，再用 `node tools/release/audit-public.mjs --staged` 检查实际暂存内容；继续运行单元测试、原生界面测试、独立目录安装与卸载测试。核对许可和对应源码包；每个 Release 资产必须小于 GitHub 的单文件限制。请勿使用 `git add .` 代替公开文件清单审计。

当前 Release 同页提供 `Rin-Desktop-版本-Setup.exe` 与第三方对应源码 ZIP，普通用户只下载 Setup。不要上传开发用 JSON 清单或单独校验清单；版本和安装包校验值保存在仓库清单中，`voice-resources.json` 已随应用提供。

维护旧 Release 时，先把仍在使用的第三方组件对应源码迁到保留的发布页，核对远端大小和 SHA-256，并确认公开下载可用；同时更新资源清单、README、许可说明和 Release 下载入口，验证资源恢复后再删除旧 Release。源码归档版本独立于应用版本，组件未变时保留原文件名和内容。Git 标签、历史、本地安装包与用户数据不随 Release 清理删除。
