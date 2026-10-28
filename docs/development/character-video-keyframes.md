# 写实女生视频首尾帧与生成单

> 2026-10-24 更新：这套三张候选静帧已复用于新的[三状态、六转场素材包](three-state-video-kit-2026-10-24.md)，本轮只准备素材，等待用户提供视频工具。下文九段制作单仍是历史版本，其中三条循环不属于当前批次。

> 路线变更（2026-10-22）：用户已明确放弃视频片段方案，当前方向为 [4K 静态壁纸与环境音](static-wallpaper-plan.md)。下文是此前研究/试用的历史记录，后续视频制作与验收计划已停止；已有代码和素材保留，主应用视频入口已由 ART-09 退出，当前实现见[原画恢复与第一阶段小样](static-wallpaper-preview.md)。

2026-10-22，ART-07。用户在首版望窗姿态上提出修订：人物更像真人、颈肩自然，参考案例的摄影质感，允许重新设计原角色。当前产出是三张候选静帧与九段视频的制作单；尚未获得用户美术验收，尚未生成新视频，也未替换主应用的现有壁纸。

## 候选人物与画面

保留黑色长发、酒红衬衫、电脑与雨夜窗景的识别元素，改用自然皮肤、正常眼部比例和摄影光线。人物在画面右侧，左侧留出雨窗；工作、望窗、注视用户共用一套场景。望窗改为轻微抬眼和小幅转头，避免扭颈、大幅后仰或身体固定而头部强转。

本地生成包名为 `video-kit-realistic-v1`，其中三张 PNG 原始尺寸均为 **1586×992，约 16:10**。输出来自图像生成工具，未通过网格变形构造姿势。A 是新人物母版，B、C 分别以 A 为编辑参考。最终视频仍需检查身份、脸型、手指和接缝；三张静帧相近并不保证视频生成结果连续。

| 锚点 | 文件 | 用途 |
| --- | --- | --- |
| A | `frames/A-work.png` | 低头专注电脑、敲击键盘 |
| B | `frames/B-window.png` | 轻抬下巴、自然望向左侧雨窗 |
| C | `frames/C-user.png` | 暂停工作、闭口注视屏幕外用户 |

## 生成顺序与参数

先生成 01 工作循环、06 工作转向用户及 03 注视用户循环，验证人物身份和连接质量；通过后补齐其余片段。三条循环与六条有向过渡构成完整动作集合，包含互动结束后的返回动作。

每条都使用指定首帧、尾帧，循环则在两个位置上传同一张图。保持输入比例和完整构图，不拉伸为 16:9，不另加裁切；同一批视频统一分辨率和帧率。生成平台如只能提供固定时长，选择接近且不短于目标的选项，之后根据实际视频裁切。无需声音、字幕或自动配音。保留平台导出的原文件。

| 导出文件名 | 首帧 → 尾帧 | 建议时长 | 动作 |
| --- | --- | --- | --- |
| `01_work_loop_A-A.mp4` | A → A | 6 秒 | 工作待机循环 |
| `02_window_loop_B-B.mp4` | B → B | 6 秒 | 望窗待机循环 |
| `03_user_loop_C-C.mp4` | C → C | 6 秒 | 注视用户循环 |
| `04_work_to_window_A-B.mp4` | A → B | 4 秒 | 停下打字，望窗 |
| `05_window_to_work_B-A.mp4` | B → A | 4 秒 | 从望窗回到电脑 |
| `06_work_to_user_A-C.mp4` | A → C | 4 秒 | 从工作转向用户 |
| `07_window_to_user_B-C.mp4` | B → C | 4 秒 | 从望窗转向用户 |
| `08_user_to_work_C-A.mp4` | C → A | 4 秒 | 从用户回到电脑 |
| `09_user_to_window_C-B.mp4` | C → B | 4 秒 | 从用户回到望窗 |

以下每段都是可单独复制的完整提示词。本地素材包同时包含九个对应的文本文件。

## 01 工作循环：A → A

```text
Create a 6-second photorealistic locked-camera desktop-companion video, using the supplied identical start and end images as precise pose anchors. Preserve this same fictional adult East Asian woman's identity, natural facial anatomy, realistic eye proportions, skin texture, black low twin ponytails, wine-red blouse, dark skirt and tights. Preserve the exact framing, rainy city window, warm lamp, leather armchair, laptop, legs and lighting. She is quietly focused on her laptop. Use only tiny, anatomically believable finger presses on the keyboard, with relaxed wrists remaining in place; no sweeping hand gestures. Add subtle breathing, one natural blink in the middle, and barely perceptible loose-hair movement caused by her own motion. Keep her gaze on the computer and her lips gently closed. Movement eases back into the exact supplied hand, face and body pose by the end, eyes open. Match the beginning and ending pose and motion speed for a repeatable loop. Rain outside remains subtle and physically plausible; the room and camera stay stable. No speech, no sound, no camera movement, no zoom, no cuts, no text, no facial morphing, no anime look, no plastic skin, no extra fingers, no warped keyboard, no exaggerated breathing, no wind-blown hair, no lighting flicker. Keep the source aspect ratio without cropping or stretching.
```

## 02 望窗循环：B → B

```text
Create a 6-second photorealistic locked-camera desktop-companion video, using the supplied identical start and end images as precise pose anchors. Preserve this same fictional adult East Asian woman's identity, natural facial anatomy, realistic eye proportions, skin texture, black low twin ponytails, wine-red blouse, dark skirt and tights. Preserve the exact framing, rainy city window, warm lamp, leather armchair, laptop, resting hands, legs and lighting. She quietly looks through the rain-covered window to the viewer's left, thoughtful and relaxed, with her chin level and neck comfortably aligned with her shoulders. Maintain this gentle three-quarter head angle. Add only subtle breathing, one natural blink in the middle and barely perceptible loose-hair settling. Her hands stay resting on the keyboard, her lips stay closed, and she does not look back at the computer or toward the camera. Return to the exact supplied pose at the end, eyes open, with beginning and ending motion speeds matched for a repeatable loop. Rain outside remains subtle and physically plausible; the room and camera stay stable. No speech, no sound, no camera movement, no zoom, no cuts, no text, no facial morphing, no anime look, no plastic skin, no stretched neck, no raised shoulder, no extreme profile, no hand motion, no wind-blown hair, no lighting flicker. Keep the source aspect ratio without cropping or stretching.
```

## 03 注视用户循环：C → C

```text
Create a 6-second photorealistic locked-camera desktop-companion video, using the supplied identical start and end images as precise pose anchors. Preserve this same fictional adult East Asian woman's identity, natural facial anatomy, realistic eye proportions, skin texture, black low twin ponytails, wine-red blouse, dark skirt and tights. Preserve the exact framing, rainy city window, warm lamp, leather armchair, laptop, resting hands, legs and lighting. She gently maintains eye contact with the camera, attentive and calm, as if listening to the person beyond the screen. Use a relaxed closed mouth with only the faintest warmth in her expression. Add subtle breathing, one natural blink in the middle and tiny natural eye movement; no nodding or broad smiling. Her neck and shoulders remain comfortable, and her hands remain still on the keyboard. Return to the exact supplied pose at the end, eyes open, with beginning and ending motion speeds matched for a repeatable loop. Rain outside remains subtle and physically plausible; the room and camera stay stable. No speech, no lip movement, no sound, no camera movement, no zoom, no cuts, no text, no facial morphing, no anime look, no plastic skin, no exaggerated head tilt, no hand gestures, no wind-blown hair, no lighting flicker. Keep the source aspect ratio without cropping or stretching.
```

## 04 工作转望窗：A → B

```text
Create a 4-second photorealistic single continuous shot transitioning precisely from the supplied work pose in the first image to the supplied window-looking pose in the last image. Preserve the same fictional adult East Asian woman, natural facial anatomy, realistic eye proportions, skin texture, hair, wine-red blouse, dark skirt and tights. Lock the camera, framing, rainy window, city, lamp, armchair, laptop, legs and exposure. She pauses typing, with both hands remaining lightly on the keyboard. Her eyes lead the motion toward the window on the viewer's left, her chin gently lifts to a neutral level, and her head follows through a small comfortable turn with a subtle natural shoulder adjustment. She settles into a thoughtful look at the rain, matching the final image. Keep the neck aligned, never twisted, stretched or arched. Use smooth natural acceleration and deceleration; settle into the final pose for about the final half second with only subtle breathing. Her mouth stays closed; loose hair follows the head softly. No speech, no sound, no camera movement, no zoom, no cuts, no text, no face or body morphing, no anime look, no plastic skin, no exaggerated turn, no reaching hands, no additional fingers, no background or lighting changes. Keep the source aspect ratio without cropping or stretching.
```

## 05 望窗转工作：B → A

```text
Create a 4-second photorealistic single continuous shot transitioning precisely from the supplied window-looking pose in the first image to the supplied work pose in the last image. Preserve the same fictional adult East Asian woman, natural facial anatomy, realistic eye proportions, skin texture, hair, wine-red blouse, dark skirt and tights. Lock the camera, framing, rainy window, city, lamp, armchair, laptop, legs and exposure. She gently brings her attention back from the window to her laptop. Her eyes move toward the screen first, followed by a small comfortable head turn and slight chin lowering. Her neck stays naturally aligned with her relaxed shoulders. Both hands remain resting in place on the keyboard; by the end she is ready to resume work and matches the exact final image. Use smooth natural acceleration and deceleration; settle into the final pose for about the final half second with only subtle breathing. Her mouth stays closed; loose hair follows the head softly. No speech, no sound, no camera movement, no zoom, no cuts, no text, no face or body morphing, no anime look, no plastic skin, no exaggerated bow, no reaching hands, no additional fingers, no background or lighting changes. This is a newly performed forward-time action, not reverse footage. Keep the source aspect ratio without cropping or stretching.
```

## 06 工作转用户：A → C

```text
Create a 4-second photorealistic single continuous shot transitioning precisely from the supplied work pose in the first image to the supplied camera-facing attentive pose in the last image. Preserve the same fictional adult East Asian woman, natural facial anatomy, realistic eye proportions, skin texture, hair, wine-red blouse, dark skirt and tights. Lock the camera, framing, rainy window, city, lamp, armchair, laptop, legs and exposure. She notices the user, pauses typing and keeps both hands resting lightly on the keyboard. Her gaze lifts from the laptop toward the camera lens, followed by a small natural lifting and turning of her head. Her neck remains comfortable and her shoulders stay relaxed. She settles into gentle eye contact with a calm, softly attentive closed-mouth expression, exactly matching the final image. No theatrical surprise or broad smile. Use smooth natural acceleration and deceleration; settle into the final pose for about the final half second with only subtle breathing. Loose hair follows the head softly. No speech, no lip movement, no sound, no camera movement, no zoom, no cuts, no text, no face or body morphing, no anime look, no plastic skin, no exaggerated head tilt, no reaching hands, no additional fingers, no background or lighting changes. Keep the source aspect ratio without cropping or stretching.
```

## 07 望窗转用户：B → C

```text
Create a 4-second photorealistic single continuous shot transitioning precisely from the supplied window-looking pose in the first image to the supplied camera-facing attentive pose in the last image. Preserve the same fictional adult East Asian woman, natural facial anatomy, realistic eye proportions, skin texture, hair, wine-red blouse, dark skirt and tights. Lock the camera, framing, rainy window, city, lamp, armchair, laptop, resting hands, legs and exposure. She gently shifts her attention from the rainy window on the viewer's left to the user at the camera. Let her eyes lead a small comfortable head turn toward the lens; her shoulders follow only as naturally necessary. Her chin stays relaxed and her neck stays aligned with her torso, never twisted or extended. She finishes with gentle direct eye contact and a calm closed-mouth expression, matching the final image. Hands remain still on the keyboard. Use smooth natural acceleration and deceleration; settle into the final pose for about the final half second with only subtle breathing. Loose hair follows the head softly. No speech, no lip movement, no sound, no camera movement, no zoom, no cuts, no text, no face or body morphing, no anime look, no plastic skin, no exaggerated smile or head tilt, no hand gestures, no additional fingers, no background or lighting changes. Keep the source aspect ratio without cropping or stretching.
```

## 08 用户转工作：C → A

```text
Create a 4-second photorealistic single continuous shot transitioning precisely from the supplied camera-facing attentive pose in the first image to the supplied work pose in the last image. Preserve the same fictional adult East Asian woman, natural facial anatomy, realistic eye proportions, skin texture, hair, wine-red blouse, dark skirt and tights. Lock the camera, framing, rainy window, city, lamp, armchair, laptop, legs and exposure. After listening, she calmly returns her attention to her laptop. Her eyes lower toward the computer screen first, followed by a small natural head turn and slight chin lowering. Keep her neck comfortably aligned with relaxed shoulders. Both hands stay lightly resting on the keyboard, ready to work, and she ends in the exact supplied work pose. Use smooth natural acceleration and deceleration; settle into the final pose for about the final half second with only subtle breathing. Her lips remain closed; loose hair follows the head softly. No speech, no sound, no camera movement, no zoom, no cuts, no text, no face or body morphing, no anime look, no plastic skin, no bowing or exaggerated nod, no reaching hands, no additional fingers, no background or lighting changes. This is a newly performed forward-time action, not reverse footage. Keep the source aspect ratio without cropping or stretching.
```

## 09 用户转望窗：C → B

```text
Create a 4-second photorealistic single continuous shot transitioning precisely from the supplied camera-facing attentive pose in the first image to the supplied window-looking pose in the last image. Preserve the same fictional adult East Asian woman, natural facial anatomy, realistic eye proportions, skin texture, hair, wine-red blouse, dark skirt and tights. Lock the camera, framing, rainy window, city, lamp, armchair, laptop, resting hands, legs and exposure. After listening, she quietly looks back toward the rain-covered window on the viewer's left. Her eyes lead a small comfortable head turn, accompanied by only a subtle natural shoulder adjustment. Keep the chin level and neck aligned, without twisting or looking upward. She settles into the thoughtful three-quarter window gaze of the exact final image. Hands remain still on the keyboard. Use smooth natural acceleration and deceleration; settle into the final pose for about the final half second with only subtle breathing. Her mouth stays closed; loose hair follows the head softly. No speech, no sound, no camera movement, no zoom, no cuts, no text, no face or body morphing, no anime look, no plastic skin, no extreme profile, no stretched neck, no hand gestures, no additional fingers, no background or lighting changes. This is a newly performed forward-time action, not reverse footage. Keep the source aspect ratio without cropping or stretching.
```

## 收到视频后的接入计划

- 日常播放 01 工作循环；安静时通过 04 转到 02 望窗循环，再通过 05 返回工作。
- 呼出对话框仍表示转向用户。根据当前姿态使用 06 或 07，接入 03 注视用户循环。对话框立即响应，人物在视频中可衔接的位置转换。
- 互动结束后使用 08 或 09 返回对应待机状态。返回片单独生成，不把完整前进片倒放，以免雨滴、眨眼和微动作逆行。
- 视频加载、连续请求与出错仍沿用预加载、过期请求取消、失败保留当前画面和明确重试的机制。具体裁切点与过渡时机必须等实际视频检查后再定，不能仅凭首尾静帧假设任意时刻都可无缝切换。
- 注视用户片段保持闭口，语音继续由原朗读系统输出。本批素材不等同于根据任意播报文本驱动的实时口型同步。

收到原始导出文件后，先检查实际首尾帧、脸与手的稳定性、曝光、雨滴接缝、解码兼容性及连续播放，再生成应用运行清单。素材包里的 `clips.json` 只是制作单，不能直接当作播放器的媒体清单。
