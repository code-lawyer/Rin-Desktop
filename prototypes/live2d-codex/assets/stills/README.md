# 静态人物资源

当前女生使用 `female-v2-4k`：work（伏案工作）、cup（捧杯休息）、thinking（托腮思考）、window（侧身看雨）、attention（转身陪伴），五张实际尺寸均为 **3840×2400**。这是沿用先前已采用流程制作的超分4K，不能称为原生4K绘画。

内置 image_gen 先引用原女生生成工作母版，另外四张全部引用新母版；五张1586×992原始输出完整保留在 `female-v2`，也用于工作台小缩略图。完整提示词见 [prompts-v2.json](prompts-v2.json)。高清加工使用 Real-ESRGAN `realesrgan-x4plus` 4倍超分、FFmpeg Lanczos适配，再混合65%超分与35%原图放大结果；没有启用人脸修复或重新生成。来源、工具版本/哈希、加工参数、原图与成品哈希见 [processing-v2-4k.json](processing-v2-4k.json)。

女生现在绘制完整目标帧，保留肩背和手臂变化；解码成功后直接切换，不变形、不叠化、不插入过渡图。工作、捧杯、托腮和看雨用于日常，陪伴用于交互。生成素材的面容、场景一致性和细节仍需用户试用确认，详见[实现记录](../../../../docs/development/still-set-v2-implementation.md)。

旧 `female` 文件夹完整保留：work / attention 是此前已验收的3840×2400超分图，其他四张1586×992，旧提示词见 [prompts.json](prompts.json)。它们不再是女生的运行时姿态。男生继续使用既有1586×992原画与头部合成方式。本轮未覆盖任何旧原图。

这些生成场景允许随本应用展示、修改和再分发，不声称享有排他版权。没有 Wallpaper Engine、视频播放器或外部壁纸素材依赖。
