# Rin Desktop

Windows 雨夜交互壁纸与 Codex 本地工作台。保留 3840×2400 场景，通过半透明气泡发送任务、阅读回复，在工作台切换本地项目和对话。内置中文听写、可选本地女声播报和全局快捷键；小米遥控器可映射按键，普通键盘鼠标始终可用。

## 安装

本项目基于 **Codex CLI**，请先自行安装并登录。基础安装包不包含、不自动安装或更新 CLI。按 [OpenAI 官方指南](https://learn.chatgpt.com/docs/codex/cli) 准备 Windows 原生 CLI，并在终端确认 `codex --version` 和 `codex login` 可正常运行。支持 PATH 中的原生程序、标准 npm 全局安装以及官方 Windows 安装路径；自定义安装可设置用户环境变量 `VIBE_CODEX_BINARY` 为 `codex.exe` 的绝对路径。更改 PATH 后重启 Rin Desktop。仅安装在 WSL 中的 CLI 不适用于此 Windows 原型。

然后从 [Releases](https://github.com/code-lawyer/Rin-Desktop/releases) 下载 **Rin-Desktop-0.3.1-Setup.exe**（约 259 MB），双击安装。基础包只有桌面应用、4K 壁纸和必要运行组件，**不含语音模型**；沿用你当前用户的 CLI 登录。CLI 已安装但尚未登录时，也可使用气泡里的官方浏览器登录入口。

需要 Windows 10/11 x64，建议 16 GB 内存。在管理面板「语音与按键 → 本地语音模型」点击 **下载并载入模型**，应用才会直接从模型上游的 **Hugging Face** 仓库下载。面板显示百分比、已下载体积和进度条，支持取消、续传与 SHA-256 校验；之后显示准备环境、载入和已载入状态。再次使用时点击「载入模型」即可；「释放模型」释放内存，保留本机文件。

模型既不放入安装包，也不由本项目的 GitHub 仓库或 Release 重新分发。首次安装和普通启动不会自动下载模型。模型保存到数据目录的 `voice-resources` 中，版本和哈希锁定，准备好后可离线识别和合成。Codex 对话仍需联网。

Qwen 首次启用还会从 Astral 上游准备独立 Python，再从 PyPI / PyTorch 官方索引安装固定版本、带哈希的依赖；这一阶段显示状态与活动进度条。无需用户预装 Python，也不会修改系统 Python 或 PATH。缺少微软 VC++ 14.44 运行库时，从微软官方下载并校验，可能需要一次 Windows 管理员确认。首次准备 Qwen 建议预留约 20 GB 临时空间，完成后清理下载缓存。

CPU 听写与轻量播报无需独显。Qwen 需要兼容 CUDA 12.8 的 NVIDIA 驱动，建议 8 GB 显存。默认不常驻、不自动播报；点击「下载并载入」或「载入模型」后启用对应模型，是否自动朗读仍由单独设置控制。安装器暂未代码签名，Windows 可能显示未知发布者。

| 可选模型 | Hugging Face 模型下载量 | 作用 |
| --- | ---: | --- |
| SenseVoice | 约 240 MB | CPU 本地中文听写 |
| Kokoro | 约 215 MB | CPU 轻量播报 |
| Qwen3-TTS | 约 4.52 GB | 中文女声；首次另需约 3.3 GB 运行依赖 |

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
