# 许可与第三方分发

Rin-Desktop 自有源代码采用根目录 MIT 许可。安装包是多个独立组件的组合，不应把整个安装包或所有模型称为 MIT。

- Electron、marked、显示封装、Node.js 等按各自许可提供。安装目录保留 Electron/Chromium 的许可文件，以及 `licenses/` 的副本。Codex CLI 由用户自行安装。
- 动漫模式使用本项目的 WebGL2 渲染代码，按 MIT 提供；素材条款见[动态原画说明](../prototypes/live2d-codex/assets/scene/rin-poses/README.md)。没有分发 LivLiv 播放器或示例角色。Sharp 仅用于开发时组装原画，未作为应用运行依赖打包。
- Claude Agent SDK 0.3.240 的 npm 包按 [Anthropic 商业条款](https://www.anthropic.com/legal/commercial-terms)提供。官方文档允许用 SDK 为终端用户提供应用服务，随第三方 Windows 安装器再分发 SDK 文件的授权范围待确认。Claude 实验入口只允许 API 或官方云平台 API 认证。Agent Client Protocol SDK 1.9.0 采用 Apache-2.0，Koffi 3.3.3 采用 MIT。构建包保留所含依赖的许可与通知，各家 Agent CLI 由用户自行安装。[Claude Agent SDK 许可和认证说明](https://code.claude.com/docs/en/agent-sdk/overview)
- 源码的旧头像模式需要使用者单独准备 Live2D Cubism Core 与 Hiyori。新安装包只提供项目自己的壁纸渲染器。旧头像适配代码附带 [Agent Avatar 的 MIT 许可](../prototypes/live2d-codex/licenses/agent-avatar-LICENSE)。Core 及其分发受 [专有许可协议](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) 和 [发行条件](https://www.live2d.com/en/sdk/license/)约束。
- 当前动漫雨夜原画、同画风完整姿态、透明蒙版及配准表情素材由本项目制作过程中的生成式图像工具生成，渲染和交互代码由本项目制作。本项目允许随本应用展示、修改和再分发这些场景文件；不声称对生成内容享有排他版权，不代表任何既有动漫作品或厂商的官方授权。男士壁纸已从当前源码和新打包清单移除；历史发布包的素材与许可记录保持原样。
- SenseVoice 和 Kokoro 模型由用户启用时直接从上游 Hugging Face 下载，保留各自模型许可证。CPU 语音工作进程及其链接的 Sherpa 原生语音组件按 GPL-3.0-or-later 分发，保留上游 Apache/MIT/BSD 通知。接收者可修改、重建、重新分发该语音组件，自有源文件仍可按 MIT 单独使用。桌面程序通过 JSON 文本和 PCM 与独立 `node.exe` 语音子进程通信。
- [当前发布页](https://github.com/code-lawyer/Rin-Desktop/releases/tag/v0.6.3-rc.9) 随安装器提供 Sherpa、eSpeak NG、piper、静态依赖的对应源码、固定版本和构建说明。下载该页面的 `Third-Party-Corresponding-Source-0.3.1.zip`，阅读包内 `README.md` 和 `SOURCES.json` 即可获取构建步骤和依赖版本。0.3.1 是仍在使用的 CPU 语音组件源码归档版本。附件在提供这些组件的安装包期间持续保留，清理旧 Release 时先迁移并校验。普通用户无需下载源码包。

维护者迁移对应源码时，使用 `Archive third-party source` 工作流，分别填写当前持有附件的 `source_release_tag`（例如 `v0.6.3-rc.5`）、附件的 `source_version`（例如 `0.3.1`）、已有目标的 `destination_release_id` 和 `destination_release_tag`。目标可为保留的应用发布页（例如 `v0.6.4-rc.1`）或开发源码页（例如 `third-party-source-v0.3.1`）；目标 ID 与标签会双重核对，不由源码版本推导。工作流下载并核对大小和 SHA-256，上传后再次核对；已有同名不同内容会拒绝覆盖。只有迁移验证成功后才能清理原发布页。本地等价入口为 `npm run source:archive -- --run`，需配置 `GH_REPO`、`SOURCE_RELEASE_TAG`、`SOURCE_VERSION`、`DESTINATION_ID`、`DESTINATION_RELEASE_TAG` 并自行认证 gh；不带 `--run` 只显示帮助。
- Qwen3-TTS 权重直接来自 Qwen 官方 Hugging Face 仓库，采用 Apache-2.0。独立 Python 由 Astral 上游准备，Qwen、PyTorch 和其他 Python 依赖从 PyPI / PyTorch 官方索引安装；这些权重和运行环境不在本项目 GitHub 或安装器中重新分发。各下载组件保留其上游许可证与许可文件，本项目的 MIT 不替代这些条件。
- PyTorch CUDA 运行时中的 NVIDIA 组件与显卡驱动遵循 NVIDIA 条款。驱动需由电脑用户自行通过官方渠道安装。无兼容显卡时可以使用 CPU 听写、轻量播报和文字对话。
- Qwen 所需 Microsoft Visual C++ 运行库不从开发电脑复制，也不重新许可；首次准备语音运行环境时，缺少的运行库会从微软固定官方地址下载、校验并启动安装。参见 [微软部署说明](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files)。

ART-09 主应用源码另含两段 CC0 1.0 实录声音：Baconation 的小雨与 Sorinious_Genious 的笔记本键盘。处理后文件、作者链接、校验值与处理方式见[音源说明](../prototypes/live2d-codex/assets/ambience/README.md)。新增女生姿态与生成说明见[静态资源](../prototypes/live2d-codex/assets/stills/README.md)。0.6.1安装包包含这些资源；录音不属于本项目 MIT 原创素材声明。

应用并非 OpenAI、Live2D 或 NVIDIA 的官方产品。完整安装清单和许可来源位于安装目录 `manifest.json`、`THIRD-PARTY-NOTICES.md`、`licenses/SOURCES.json`。

真人两态视频由 Dreamina 国际版 Canvas CLI 生成。成片保留生成标识并移除生成音轨，生成媒体的许可独立于 MIT 源代码许可。Dreamina 第 8 节规定了合规用户的输入和输出权益。公开分发还需核对生成账号适用的地区条款及 Seedance 2.0 功能补充条件。生成、剪辑和超分工具由制作端使用。[动态素材说明](../prototypes/live2d-codex/assets/motion/female/README.md) · [Dreamina 服务条款](https://www.capcut.com/clause/dreamina-terms-of-service)
