# 许可与第三方分发

Rin-Desktop 自有源代码采用根目录 MIT 许可。安装包是多个独立组件的组合，不应把整个安装包或所有模型称为 MIT。

- Electron、PixiJS、marked、显示封装、Node.js 等按各自许可提供。安装目录保留 Electron/Chromium 的许可文件，以及 `licenses/` 的副本。Codex CLI 由用户自行安装，不包含在本项目安装包中。
- Live2D Cubism Core 为专有运行时，保持原始文件，不纳入 MIT。安装步骤要求接受其保护条款；本版只提供固定的雨夜场景，不提供任意模型导入，也不再分发 Hiyori 回退人物。请遵守 [官方 Core 条款](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html) 和 [发行条件](https://www.live2d.com/en/sdk/license/)。企业用途、扩展模型能力或重新发行时应重新判断适用条件。
- 4K 雨夜原画由本项目制作过程中的生成式图像工具生成，绑定和交互代码由本项目制作。本项目允许随本应用展示、修改和再分发这些场景文件；不声称对生成内容享有排他版权，不代表任何既有动漫作品或厂商的官方授权。
- SenseVoice 和 Kokoro 模型保留各自模型许可证。CPU 语音工作进程及其链接的 Sherpa 原生语音组件按 GPL-3.0-or-later 的组合分发条件提供，保留上游 Apache/MIT/BSD 通知；不能把组合二进制称为仅 Apache/MIT。接收者可修改、重建、重新分发该语音组件，自有源文件仍可按 MIT 单独使用。桌面与 Live2D 组件通过 JSON 文本/PCM 与独立 `node.exe` 语音子进程通信，不链接 Sherpa；安装包将这些独立组件聚合提供。
- Release 的 `Third-Party-Corresponding-Source` 附件提供 Sherpa、eSpeak NG、piper、静态依赖及 LGPL 音频库的对应源码、固定版本和构建说明。需要修改、重新链接或重建这些库时使用这些材料。
- Qwen3-TTS 权重及 Qwen 运行库采用 Apache-2.0；Python、PyTorch、Torchaudio、NumPy、SciPy、LLVM、libsndfile、soxr 等保留自身及依赖许可。`licenses/python-packages` 和 Python 包内的许可文件同时保留。
- 发行版的 libsndfile 1.2.2 使用提供的源码重新编译，关闭外部编解码器与 MPEG 支持；仅供本应用 WAV/PCM 工作流使用。soxr Python 包装器与其 libsoxr 为 LGPL-2.1-or-later，可按源码包说明重建、替换动态模块；保留修改与重新链接权利。
- CUDA 12.8 和 cuDNN 9.10.2 属于 NVIDIA 专有组件，其 EULA 单独归档，不受 MIT 覆盖；显卡驱动需由电脑用户自行通过 NVIDIA 官方渠道安装。无兼容显卡时可以使用 CPU 听写、轻量播报和文字对话。
- Qwen 所需 Microsoft Visual C++ 运行库不从开发电脑复制，也不重新许可；缺少时由安装器从微软固定官方地址下载、校验并运行其安装程序。参见 [微软部署说明](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files)。

应用并非 OpenAI、Live2D 或 NVIDIA 的官方产品。完整安装清单和许可来源位于安装目录 `manifest.json`、`THIRD-PARTY-NOTICES.md`、`licenses/SOURCES.json`。
