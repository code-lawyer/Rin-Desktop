# 工作、望窗、看向用户：三状态转场素材包

日期：2026-10-24。关联 ART-09。用户将本阶段收敛为工作、望窗、看向用户三个状态，稍后提供视频工具，本轮只准备素材。五姿态方案中的捧杯、托腮与拿杯试验不进入这一阶段。

## 本轮交付与边界

复用[旧版写实候选](character-video-keyframes.md)的三张生成原图，重新整理为三张参考图、六条独立完整提示词、制作清单及静帧对照页。旧九段方案及原图保留，新包单独命名为 `video-kit-three-state-v1`。没有重新生成图片、制作视频、订阅服务或替换主应用；已有语音、对话框、工作台、遥控器及运行设置保持。

三张图已逐张查看：坐姿、双手、电脑和家具构图基本一致，主要变化在头部，适合作为这轮小幅转头的候选输入。这是视觉检查结论，不是背景逐像素相同或用户美术验收通过的声明。原图实际为 **1586×992，约16:10**；本包不放大，不称作原生4K。

本阶段采用静帧停留、短视频转场。工作停留暂不含敲键盘动作，也不另生成呼吸、眨眼、雨滴或实时口型循环。转场不是两张图叠化，必须生成真实连续转头。不要把这套素材清单直接当成应用运行时媒体清单。

## 三张参考图

| 编号 | 文件 | 稳定状态 |
| --- | --- | --- |
| A | `frames/A-work.png` | 专注电脑，双手在键盘上，低头看屏幕 |
| B | `frames/B-window.png` | 抬眼自然望向左侧雨窗，手和身体保持原位置 |
| C | `frames/C-user.png` | 闭口看向屏幕外用户，手和身体保持原位置 |

三张均为之前由内置图像工具生成的虚构成年女性候选，没有复制第三方案例视频帧。A 是工作母版，B、C 曾以 A 为编辑参考。SHA-256、尺寸和来源包记入本地 `clips.json`。本轮复用原文件字节，不再画一套独立家具，不添加无人背景图或分层抠像交付。

## 六段转场与生成顺序

| 序号 | 导出文件名 | 首帧 → 尾帧 | 目标时长 |
| --- | --- | --- | --- |
| 01 | `01_work_to_user_A-C.mp4` | A → C | 4秒 |
| 02 | `02_user_to_work_C-A.mp4` | C → A | 4秒 |
| 03 | `03_work_to_window_A-B.mp4` | A → B | 4秒 |
| 04 | `04_window_to_work_B-A.mp4` | B → A | 4秒 |
| 05 | `05_window_to_user_B-C.mp4` | B → C | 4秒 |
| 06 | `06_user_to_window_C-B.mp4` | C → B | 4秒 |

先做01、02，验工作与用户之间的往返接缝，再做03、04，最后05、06。六个方向均有独立提示词，不倒放、不用一条多镜头视频替代六段。用户提供工具后先确认其实际首尾帧输入和画幅能力，再开始生成。

统一制作要求：

- 首帧和尾帧分别使用表中指定原图，不只上传首帧。提示词中的四秒是目标；工具仅支持五秒等固定时长时选择不短于四秒的统一选项，保留原始导出，后续按实际动作裁切。
- 首段约0.3秒稳定，随后自然转头，末段约0.5秒充分静止，眼睛睁开、嘴唇闭合。时间分配按实际输出时长调整，不通过加速硬塞。
- 摄像机、坐姿、双手、电脑、杯子及家具保持；本轮背景雨滴不另做动画。眼睛先转、头部自然跟随，颈肩仅做必要的小幅调整。
- 三图使用同一画幅、位置、曝光与色彩，视频也使用同一分辨率和帧率。工具不支持原画幅时，先统一处理三张输入的补边或裁切并检查构图，不能分别自动裁切或拉伸。4K处理留到动作通过后，低分辨率来源明确标作超分。
- 不生成语音、音乐、音效、字幕、水印或口型表演。声音继续使用产品独立的语音与环境音系统。
- 输出保留为原始文件，按表中名称放入素材包的 `videos/`；不通过聊天软件压缩后再交付。实际编码兼容性在收到文件后验证。

## 01 工作转向用户：A → C

```text
Create one 4-second, photorealistic, single continuous shot. Use the supplied first image A as the starting pose and the supplied last image C as the finishing pose. Preserve the identity of this same fictional adult East Asian woman, her natural facial proportions, long black low twin ponytails, wine-red blouse, clothing, skin texture and lighting.

She notices the person beyond the screen. Her eyes gently lift from the laptop toward the camera, then her head follows in a small comfortable turn and lift. She finishes with calm, attentive eye contact and a relaxed closed mouth, matching image C. Keep her hands resting exactly where they are on the keyboard. Her seated body and crossed legs remain in place; only minimal natural neck and shoulder adjustment accompanies the head turn. Loose hair follows softly without wind.

Hold the starting pose for about 0.3 seconds, perform the movement smoothly, and settle fully into the final pose for about the last 0.5 seconds. Keep both endpoint poses still, with eyes open. Lock camera position, framing, laptop, armchair, side table, cup, window, rain droplets and exposure. Maintain the supplied aspect ratio and framing. No camera motion, cuts, dissolves, morphing, broad smile, hand gestures, speaking, audio, text, new objects or furniture changes.
```

## 02 用户转回工作：C → A

```text
Create one 4-second, photorealistic, single continuous shot. Use the supplied first image C as the starting pose and the supplied last image A as the finishing pose. Preserve the identity of this same fictional adult East Asian woman, her natural facial proportions, long black low twin ponytails, wine-red blouse, clothing, skin texture and lighting.

After listening to the person beyond the screen, she calmly returns her attention to the laptop. Her eyes lower toward its screen first, followed by a small comfortable head turn and a slight lowering of the chin. She finishes in the focused working pose of image A. Keep both hands resting on the keyboard without typing during this transition. Her seated body and crossed legs remain in place; her neck stays relaxed and aligned. Loose hair follows the movement softly. Perform a new forward-time action, not reverse footage.

Hold the starting pose for about 0.3 seconds, perform the movement smoothly, and settle fully into the final pose for about the last 0.5 seconds. Keep both endpoint poses still, with eyes open and lips closed. Lock camera position, framing, laptop, armchair, side table, cup, window, rain droplets and exposure. Maintain the supplied aspect ratio and framing. No camera motion, cuts, dissolves, morphing, bowing, hand gestures, speaking, audio, text, new objects or furniture changes.
```

## 03 工作转向雨窗：A → B

```text
Create one 4-second, photorealistic, single continuous shot. Use the supplied first image A as the starting pose and the supplied last image B as the finishing pose. Preserve the identity of this same fictional adult East Asian woman, her natural facial proportions, long black low twin ponytails, wine-red blouse, clothing, skin texture and lighting.

She takes a quiet pause from the laptop and looks toward the rainy window on the viewer's left. Her eyes lead the movement; her chin lifts gently to a comfortable level, and her head follows through the small turn shown by image B. She settles into a thoughtful outward gaze. Do not turn her head farther than the last image or arch her neck. Both hands stay in their original keyboard positions. Her seated body and crossed legs remain in place, with only a minimal natural shoulder adjustment. Loose hair settles softly.

Hold the starting pose for about 0.3 seconds, perform the movement smoothly, and settle fully into the final pose for about the last 0.5 seconds. Keep both endpoint poses still, with eyes open and lips closed. Lock camera position, framing, laptop, armchair, side table, cup, window, rain droplets and exposure. Maintain the supplied aspect ratio and framing. No camera motion, cuts, dissolves, morphing, exaggerated profile, stretched neck, hand gestures, speaking, audio, text, new objects or furniture changes.
```

## 04 雨窗转回工作：B → A

```text
Create one 4-second, photorealistic, single continuous shot. Use the supplied first image B as the starting pose and the supplied last image A as the finishing pose. Preserve the identity of this same fictional adult East Asian woman, her natural facial proportions, long black low twin ponytails, wine-red blouse, clothing, skin texture and lighting.

She gently brings her attention back from the rainy window to her laptop. Her eyes move down toward the screen first, then her head makes a small comfortable turn with a slight chin lowering. She finishes in the focused working pose of image A. Keep her neck naturally aligned with relaxed shoulders. Both hands stay in their original keyboard positions without typing, and her seated body and crossed legs remain in place. Loose hair follows softly. Perform a new forward-time action, not reverse footage.

Hold the starting pose for about 0.3 seconds, perform the movement smoothly, and settle fully into the final pose for about the last 0.5 seconds. Keep both endpoint poses still, with eyes open and lips closed. Lock camera position, framing, laptop, armchair, side table, cup, window, rain droplets and exposure. Maintain the supplied aspect ratio and framing. No camera motion, cuts, dissolves, morphing, exaggerated bow, stretched neck, hand gestures, speaking, audio, text, new objects or furniture changes.
```

## 05 雨窗转向用户：B → C

```text
Create one 4-second, photorealistic, single continuous shot. Use the supplied first image B as the starting pose and the supplied last image C as the finishing pose. Preserve the identity of this same fictional adult East Asian woman, her natural facial proportions, long black low twin ponytails, wine-red blouse, clothing, skin texture and lighting.

She notices the person beyond the screen while looking through the rainy window on the viewer's left. Her eyes shift toward the camera, followed by a small natural head turn. Her shoulders follow only as much as needed for a comfortable neck position. She finishes with calm, attentive eye contact and a relaxed closed mouth, precisely adopting the pose of image C. Both hands stay resting on the keyboard, and her seated body and crossed legs remain in place. Loose hair settles softly. Avoid surprise or a theatrical reaction.

Hold the starting pose for about 0.3 seconds, perform the movement smoothly, and settle fully into the final pose for about the last 0.5 seconds. Keep both endpoint poses still, with eyes open. Lock camera position, framing, laptop, armchair, side table, cup, window, rain droplets and exposure. Maintain the supplied aspect ratio and framing. No camera motion, cuts, dissolves, morphing, nodding, broad smile, hand gestures, speaking, audio, text, new objects or furniture changes.
```

## 06 用户转回雨窗：C → B

```text
Create one 4-second, photorealistic, single continuous shot. Use the supplied first image C as the starting pose and the supplied last image B as the finishing pose. Preserve the identity of this same fictional adult East Asian woman, her natural facial proportions, long black low twin ponytails, wine-red blouse, clothing, skin texture and lighting.

After listening to the person beyond the screen, she quietly returns her attention to the rain-covered window on the viewer's left. Her eyes lead a small comfortable head turn; her shoulders adjust only as naturally necessary. Keep the chin level and neck aligned, without twisting, arching or looking upward. She finishes in the thoughtful outward gaze of image B. Both hands stay in their original keyboard positions, and her seated body and crossed legs remain in place. Loose hair follows softly. Perform a new forward-time action, not reverse footage.

Hold the starting pose for about 0.3 seconds, perform the movement smoothly, and settle fully into the final pose for about the last 0.5 seconds. Keep both endpoint poses still, with eyes open and lips closed. Lock camera position, framing, laptop, armchair, side table, cup, window, rain droplets and exposure. Maintain the supplied aspect ratio and framing. No camera motion, cuts, dissolves, morphing, extreme profile, stretched neck, hand gestures, speaking, audio, text, new objects or furniture changes.
```

## 收到成片后的拼接与验收

日常在 A 与 B 之间通过03、04切换；从 A 呼出对话用01，从 B 呼出对话用05，进入 C 停留。互动结束根据此前状态播放02或06。对话框、工作台和采音立即响应，不等待转场结束；转场过程中发生新请求时，需要根据实片安全出口实现调度，当前并未实现这一逻辑。

首尾帧输入不保证输出逐像素等于输入。六段必须逐一检查真实起止画面及三个状态的所有入/出接缝，不能仅截取每段末帧便宣称跨片无缝。选用来自最终统一处理时间线的静帧，并检查与所有相关视频是否兼容；必要时重做不匹配的片段。保持固定背景不能仅靠“锁定”提示词验证。

先验脸型、发际线、颈肩、双手、电脑边框、两侧扶手和靠背轮廓，再验连续播放是否有跳脸、亮度突变或黑帧。动作通过后才统一4K处理与编码，且不分别美化静帧和视频。若这些候选图在视频中仍引起家具变化，先定位并修正具体输入或输出，不无限扩大生成批次。

本页记录2026-10-24的素材准备状态。用户随后提供Dreamina工具并认可首条试片；2026-10-27其余五条的有上限生成及独立调度预览见[转场制作记录](three-state-transition-production-2026-10-27.md)。主应用集成仍需修复 FIX-17、接入三态转场调度，并复验原有功能；本包和历史测试均不能代替新的美术及实机验收。
