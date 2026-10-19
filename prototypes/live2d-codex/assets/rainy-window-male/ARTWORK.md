# 男性雨夜壁纸

使用内置 image_gen 工具，参考现有女性雨夜原画生成。设定：东亚男青年、黑色短发、金丝眼镜、黑色衬衫与西裤。保留原有窗景、灯光、构图和笔记本电脑位置，分别生成打字与抬头回应两种状态。

原画尺寸为 **1586 × 992**（生成工具实际交付尺寸，非原生 4K）。PSD2Live 3.4.5 复用原有 1586 × 992 场景坐标、网格与动作，导出本目录的 MOC3、模型 JSON 与纹理；桌面渲染按屏幕尺寸缩放。设置预览为原画的 640 × 400 缩略图。

运行时需要 `Generated_artwork.model3.json` 及其 `FileReferences` 中列出的全部文件。本目录与 `assets/character-previews` 随源码及安装包一同分发；原女性资源仍由原有资源准备流程提供。

本项目允许随应用展示、修改和再分发这些生成场景；不声称对生成内容享有排他版权。

## 生成提示词

### 初始人物替换

Use case: precise-object-edit. Asset type: production wallpaper illustration, 3840x2400 landscape, 16:10, to be used as the TypingScene texture of an existing Live2D rig. Input image is the edit target and exact style/composition reference. Replace ONLY the seated woman with a young adult East Asian man (around 25), short neatly styled black hair, delicate gold wire-frame glasses, a black long-sleeved button-up shirt and black tailored suit trousers. Masculine face, calm intelligent expression, subtle warm lamplight on gold frames; elegant realistic-anime illustration matching the original rendering exactly. His eyes look down toward the laptop screen as he types. Keep the same seated posture, body scale, head location, laptop and both hands' positions as closely as possible, with natural male anatomy. Keep crossed legs dressed in black suit trousers. Preserve the rainy city window, buildings, reflections, room, lamp, armchair, cushion, blanket, books, cup, table, laptop, camera, framing and lighting unchanged. The character stays on the right, leaving the city view on the left. No extra people, no ponytails, no feminine clothing, no text, logos or watermark. High-detail final full scene, full-bleed image, no borders. Output 3840x2400 if possible.

### 服装修正（最终打字状态）

Use case: precise-object-edit. Production Live2D wallpaper texture edit. Change ONLY the man's upper-body clothing: REMOVE the suit jacket/blazer entirely. He wears ONLY a fitted black long-sleeved button-up collared shirt, with realistic fine black shirt fabric folds, shirt sleeves and buttoned cuffs; no jacket, no lapels, no waistcoat, no tie. Keep the black tailored suit trousers unchanged. Keep the young adult East Asian male face, short black hair and gold wire-frame glasses exactly the same. Keep the downward gaze toward the laptop, both typing hands, fingers and laptop in precisely the same positions. Preserve every other pixel and the composition of the rainy city window, room, chair, table, legs, lighting and surrounding environment as closely as possible. Match the same sophisticated detailed semi-realistic anime illustration style. 16:10 full-bleed landscape, output at 3840x2400, high detail, no text or borders.

### 抬头回应状态

Use case: precise-object-edit. Asset type: paired AttentionScene texture for the same Live2D wallpaper. Input image is the final TypingScene; this must be a near-identical second frame. Change ONLY the man's gaze and a very small amount of his face angle: the same young adult East Asian man with short black hair and fine gold wire-frame glasses now gently raises his eyes to make direct eye contact with the viewer, calm attentive expression and a very subtle friendly smile, as if pausing his work to listen. Retain the exact same head silhouette and head position; only a tiny chin lift. Keep his black button-up shirt (no jacket), black suit trousers, torso, both typing hands and fingers, laptop, crossed legs and all their positions pixel-aligned with the source. ALL background and other pixels remain unchanged: rainy city window, buildings, reflections, lamp, chair, plant, blanket, table, cup, laptop, lighting. Same detailed semi-realistic anime painterly style. No new objects, no text. 16:10 full-bleed landscape, 3840x2400 output if possible.

## 默认声线依据

- Qwen Dylan 为年轻中文男声，Serena 为中文女声：[Qwen 模型说明](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)。
- Kokoro v1.1-zh 的 `zm_009` 为中文男声 SID 58，`zf_001` 为中文女声 SID 3：[sherpa-onnx 声线映射](https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_1.html)。
