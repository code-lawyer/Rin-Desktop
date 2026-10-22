# 许可与第三方分发

Rin-Desktop 自有源代码采用根目录 MIT 许可。安装包是多个独立组件的组合，不应把整个安装包或所有模型称为 MIT。

- Electron、PixiJS、marked、显示封装、Node.js 等按各自许可提供。安装目录保留 Electron/Chromium 的许可文件，以及 `licenses/` 的副本。Codex CLI 由用户自行安装，不包含在本项目安装包中。
- Claude Agent SDK 0.3.240 按 [Anthropic 商业条款](https://www.anthropic.com/legal/commercial-terms) 提供；它不是 MIT。Agent Client Protocol SDK 1.9.0 采用 Apache-2.0，Koffi 3.3.3 采用 MIT。发布包保留各 SDK/依赖内的 README、LICENSE 和通知，不打包各家 Agent CLI。Claude 产品入口按[官方 SDK 认证与命名要求](https://code.claude.com/docs/en/agent-sdk/overview)显示为 Claude，只允许 API 或官方云平台 API 认证。
- Live2D Cubism Core 为专有运行时，保持原始文件，不纳入 MIT。安装步骤要求接受其保护条款；本版只提供固定的雨夜场景，不提供任意模型导入，也不再分发 Hiyori 回退人物。请遵守 [官方 Core 条款](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) 和 [发行条件](https://www.live2d.com/en/sdk/license/)。企业用途、扩展模型能力或重新发行时应重新判断适用条件。
- 默认女性 4K 雨夜原画和新增男性雨夜原画均由本项目制作过程中的生成式图像工具生成，绑定和交互代码由本项目制作。本项目允许随本应用展示、修改和再分发这些场景文件；不声称对生成内容享有排他版权，不代表任何既有动漫作品或厂商的官方授权。男性原画的生成说明见 `prototypes/live2d-codex/assets/rainy-window-male/ARTWORK.md`。
- SenseVoice 和 Kokoro 模型由用户启用时直接从上游 Hugging Face 下载，不包含在安装器或本项目 Release 中，保留各自模型许可证。CPU 语音工作进程及其链接的 Sherpa 原生语音组件按 GPL-3.0-or-later 的组合分发条件提供，保留上游 Apache/MIT/BSD 通知；不能把组合二进制称为仅 Apache/MIT。接收者可修改、重建、重新分发该语音组件，自有源文件仍可按 MIT 单独使用。桌面与 Live2D 组件通过 JSON 文本/PCM 与独立 `node.exe` 语音子进程通信，不链接 Sherpa；安装包将这些独立组件聚合提供。
- 独立的 [0.3.1 第三方对应源码页](https://github.com/code-lawyer/Rin-Desktop/releases/tag/third-party-source-v0.3.1) 提供安装包所含 Sherpa、eSpeak NG、piper、静态依赖的对应源码、固定版本和构建说明。下载该页面的 `Third-Party-Corresponding-Source-0.3.1.zip`，阅读包内 `README.md` 和 `SOURCES.json` 即可获取构建步骤和依赖版本。源码页在提供该版安装包期间持续保留；普通用户无需下载源码包。
- Qwen3-TTS 权重直接来自 Qwen 官方 Hugging Face 仓库，采用 Apache-2.0。独立 Python 由 Astral 上游准备，Qwen、PyTorch 和其他 Python 依赖从 PyPI / PyTorch 官方索引安装；这些权重和运行环境不在本项目 GitHub 或安装器中重新分发。各下载组件保留其上游许可证与许可文件，本项目的 MIT 不替代这些条件。
- PyTorch CUDA 运行时中的 NVIDIA 组件与显卡驱动遵循 NVIDIA 条款。驱动需由电脑用户自行通过官方渠道安装。无兼容显卡时可以使用 CPU 听写、轻量播报和文字对话。
- Qwen 所需 Microsoft Visual C++ 运行库不从开发电脑复制，也不重新许可；首次准备语音运行环境时，缺少的运行库会从微软固定官方地址下载、校验并启动安装。参见 [微软部署说明](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files)。

应用并非 OpenAI、Live2D 或 NVIDIA 的官方产品。完整安装清单和许可来源位于安装目录 `manifest.json`、`THIRD-PARTY-NOTICES.md`、`licenses/SOURCES.json`。
