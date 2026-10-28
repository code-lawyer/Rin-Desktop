# 小雨与轻敲录音

用于 ART-09 的独立静态壁纸小样。当前未接入正式主应用，不依赖 Wallpaper Engine 或在线声音服务。

| 文件 | 原录音与作者 | 许可 |
| --- | --- | --- |
| `light-rain.ogg` | [Medium Light Rain](https://freesound.org/people/Baconation/sounds/592482/) — Baconation；作者说明为公寓窗外中小雨 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `soft-keyboard.ogg` | [typing on laptop keyboard 1.wav](https://freesound.org/people/Sorinious_Genious/sounds/561102/) — Sorinious_Genious；笔记本键盘实录 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

2026-10-22 已核对两个原始发布页的 CC0 标记。素材取自发布页公开的高质量 MP3 试听版；原始下载地址、输入与输出 SHA-256、处理设置及音频测量见 [sources.json](sources.json)。不将处理后的声音标为作者未经修改的原录音。

雨声选取第 20–84 秒，移除低频轰鸣并柔化高频，经 4 秒环接后形成 60 秒循环。键盘保留实录时序，播放器选取七段较轻的短句，段间停顿 5–12 秒。两路分别调节电平并柔化突兀峰值；默认小雨 12%、键盘 8%，开始试听需要主动开启。

从已下载的两个原始文件重做音频：

```powershell
npm run audio:prepare -- --run --rain=<rain-hq.mp3> --keys=<keyboard-hq.mp3>
```

此命令使用现有 FFmpeg，仅处理本地文件，不下载模型或安装软件。输出位于本目录，输入原文件和现场报告不纳入公开仓库。电平与完整性检查不能替代实际试听。
