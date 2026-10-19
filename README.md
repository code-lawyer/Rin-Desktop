# Rin Desktop

Windows 雨夜交互壁纸与 Codex 本地工作台。保留 3840×2400 场景，通过半透明气泡发送任务、阅读回复，在工作台切换本地项目和对话。内置中文听写、可选本地女声播报和全局快捷键；小米遥控器可映射按键，普通键盘鼠标始终可用。

## 安装

本项目基于 **Codex CLI**，请先自行安装并登录。基础安装包不包含、不自动安装或更新 CLI。按 [OpenAI 官方指南](https://learn.chatgpt.com/docs/codex/cli) 准备 Windows 原生 CLI，并在终端确认 `codex --version` 和 `codex login` 可正常运行。支持 PATH 中的原生程序、标准 npm 全局安装以及官方 Windows 安装路径；自定义安装可设置用户环境变量 `VIBE_CODEX_BINARY` 为 `codex.exe` 的绝对路径。更改 PATH 后重启 Rin Desktop。仅安装在 WSL 中的 CLI 不适用于此 Windows 原型。

然后从 [Releases](https://github.com/code-lawyer/Rin-Desktop/releases) 下载 **Rin-Desktop-0.3.0-Setup.exe**（约 259 MB），双击安装。基础包只有桌面应用、4K 壁纸和必要运行组件，**不含语音模型**；沿用你当前用户的 CLI 登录。CLI 已安装但尚未登录时，也可使用气泡里的官方浏览器登录入口。

需要 Windows 10/11 x64，建议 16 GB 内存。首次使用语音时，在「语音与按键 → 语音资源」分别下载中文听写、Kokoro 轻量播报或 Qwen3-TTS。界面显示下载和解包体积、进度，支持取消、续传和校验；下载后保存在本机，后续直接复用。只用文字对话时无需任何语音下载。CPU 听写与轻量播报无需独显；Qwen 需要兼容 CUDA 12.8 的 NVIDIA 驱动，建议 8 GB 显存，默认不加载、不自动播报。

离线准备语音：单独下载所需的 `voice-asr`、`voice-kokoro` 或 `voice-qwen` 的 `.exe` 和全部同名前缀 `.bin`，放在同一目录后运行该资源安装器。默认安装到 `%LOCALAPPDATA%\VibeVoice\voice-resources\组件名-0.3.0`；如已选择旧数据目录，请将其改为该数据目录下的同名路径。Qwen 还需要微软 VC++ 14.44 或更新运行库，缺少时从微软官方校验下载，可能需要一次管理员确认。所有 Release 文件提供 SHA-256。安装器暂未签名，Windows 可能显示未知发布者。

| 可选资源 | 下载量 | 作用 |
| --- | ---: | --- |
| SenseVoice | 约 169 MB | CPU 本地中文听写 |
| Kokoro | 约 154 MB | CPU 轻量播报 |
| Qwen3-TTS | 约 6.76 GB | 中文女声，含独立 Python、PyTorch 和模型 |

## 使用

| 操作 | 默认快捷键 |
| --- | --- |
| 呼出或收起对话 | Ctrl+Alt+空格 |
| 项目与对话工作台 | Ctrl+Alt+P |
| 开始 / 结束听写 | Ctrl+Alt+V |
| 发送当前草稿 | Ctrl+Alt+Enter |
| 朗读当前完整回复 | Ctrl+Alt+R |
| 停止播报 | Ctrl+Alt+S |

回复完成后响提示音。听写只填入草稿，由你确认发送；朗读会先完整准备音频再连续播放。项目、会话、草稿、麦克风、按键和声音设置均保存在本机。托盘菜单可打开对话、工作台或退出全部应用进程。Codex 推理需要联网，录音识别与语音合成在本机运行。

旧 Vibe Voice 用户可在「语音与按键 → 使用已有数据目录」沿用旧会话和设置。升级、卸载均保留个人数据；首次安装不复制任何维护者账号或聊天记录。

## 开发与许可

- [操作说明](prototypes/live2d-codex/PORTABLE-README.md)
- [从源码构建](docs/build.md)
- [隐私与数据](docs/privacy.md)
- [许可与对应源码](docs/licenses.md)
- [发布审查与验证](docs/release-audit.md)

自有代码采用 [MIT](LICENSE)。第三方运行时、模型与素材保留各自许可，Live2D Core 和 NVIDIA 组件不属于 MIT。语音原生组件包含 GPL/LGPL 依赖，Release 同时提供对应源码材料。本项目与 OpenAI、Live2D、小米及 NVIDIA 无隶属关系。

核心应用位于 `prototypes/live2d-codex`，目录名为兼容已有开发入口保留；公开仓库不包含研究过程、个人运行数据、下载缓存或开发者的模型环境。
