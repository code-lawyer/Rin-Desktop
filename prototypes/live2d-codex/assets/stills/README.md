# 静态人物资源

本目录保留女生五种姿态原画：`female-v2-4k` 包含 work（伏案工作）、cup（捧杯休息）、thinking（托腮思考）、window（侧身看雨）、attention（转身陪伴），五张实际尺寸均为 **3840×2400**。这是沿用项目超分流程制作的高清图，不能称为原生 4K 绘画。

内置 image_gen 先引用原女生生成工作母版，另外四张全部引用新母版；五张1586×992原始输出完整保留在 `female-v2`，也用于工作台小缩略图。完整提示词见 [prompts-v2.json](prompts-v2.json)。高清加工使用 Real-ESRGAN `realesrgan-x4plus` 4倍超分、FFmpeg Lanczos适配，再混合65%超分与35%原图放大结果；没有启用人脸修复或重新生成。来源、工具版本/哈希、加工参数、原图与成品哈希见 [processing-v2-4k.json](processing-v2-4k.json)。

当前主应用的「动漫静态」模式由相邻的 [`rin-poses`](../scene/rin-poses/README.md) 自有 WebGL2 渲染器驱动（约 2.8 秒马赛克分解重组切换、眨眼、轻微视线与朗读口型），本目录的 `female-v2-4k/attention.png` 作为首帧及异常回退底图保留，`female-v2` 与 `scene-v3` 同时作为 `rin-poses` 重建输入和兼容回归素材保留。生成素材的面容、场景一致性和细节仍需结合实机显示验收确认，范围见[项目状态](../../../../docs/project-status.md)。

旧 `female` 文件夹完整保留：work / attention 是此前已验收的3840×2400超分图，其他四张1586×992，旧提示词见 [prompts.json](prompts.json)。它们不再是女生的运行时姿态。2026-11-01已移除男士壁纸及其资源；现有女生原图和处理证据保持原样。

这些生成场景允许随本应用展示、修改和再分发，不声称享有排他版权。没有 Wallpaper Engine、视频播放器或外部壁纸素材依赖。
