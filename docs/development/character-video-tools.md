# 原人物图生视频工具核查

> 路线变更（2026-10-22）：用户已明确放弃视频片段方案，当前方向为 [4K 静态壁纸与环境音](static-wallpaper-plan.md)。下文是此前研究/试用的历史记录，后续视频制作与验收计划已停止；已有代码和素材保留，主应用视频入口已由 ART-09 退出，当前实现见[原画恢复与第一阶段小样](static-wallpaper-preview.md)。

核查日期：2026-10-22。目标是以自己的原画制作固定镜头、短动作、可循环的视频，再由本项目播放。以下是官方能力核查和实验建议，未上传人物素材、生成付费视频、安装模型或完成画质验收。

后续用户提供了另一台 RTX 5060 Ti 16GB、32GB 内存电脑，并明确只需要方案。针对这套新条件的结论见[本地视频制作方案](local-video-generation.md)：优先研究有原生首尾模板的 Wan2.2-Fun-5B-InP Q8。下面基于早先 8GiB 设备条件的取舍是当时背景，不代表 16GB 设备无法本地生成。

来源访问说明：方舟页面直接打开需要 JavaScript，相关参数通过限定官方域名的搜索索引正文交叉核查；这不代表已完成 API 调用。Runway 能力另以官方模型目录和 SDK 源码核对。

## 首选：Seedance 2.5 的首尾帧短片

官方 API 支持 `first_frame` 与 `last_frame`，明确允许首尾使用同一张图片；该模式和全模态参考模式互斥。全模态模式可用提示词指定首尾图，但官方建议需要严格首尾一致时用前者。因此第一轮适合用现有人物原画同时约束两端，只要求一次眨眼、轻微呼吸、少量发丝摆动；这是一项待验证的实验设计，不能据此保证中间帧脸型始终一致或循环速度连续。[创建任务 API](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh)

当前规格为 4–30 秒，480p／720p／1080p；首尾帧任务的 `ratio` 必须是 `adaptive`，跟随首帧宽高比。1080p 产物使用 10-bit HEVC，后续需验证本项目解码或转成兼容格式。官方还提供先生成 480p Draft、再由样片任务生成成片的流程。首轮建议 6–8 秒、720p 或 Draft，看身份、动作和衔接，通过后才提高画质。[Seedance 2.5 教程](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=zh)

参考图能承载外观与风格信息，但不等于几何锁定。固定镜头应写入提示词并检查背景是否漂移；不要把旧版 `camera_fixed` 当作 2.5 的保证：API 文档将它限定于 1.0 pro／pro fast，且明确实际效果不保证。[参数限制](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh)

可经方舟创建异步任务，需要账户开通和 API 凭据；当前会话没有已连接的 Seedance 生成工具。资料证明接口存在，不证明该账户已有调用资格。[调用教程](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=zh)

## 接入候选：Runway；替代模型：Gen-4.5

Runway 官方 API 模型目录也列出 `seedance2_5`，其官方 SDK 支持首／尾帧字段。因此“Seedance 模型＋Runway 通道”是可核实的组合；不能据此断言某个聊天插件暴露了同样的模型和参数。[模型目录](https://docs.dev.runwayml.com/guides/models/)、[官方 SDK](https://github.com/runwayml/sdk-node/blob/main/src/resources/image-to-video.ts)

另一个对照候选是 `gen4.5`：官方 SDK 列出 2–10 秒、1280×720 等画幅，图像位置只接受 `first`，未提供该模型的尾帧字段。它适合对照小动作画质，但首尾闭环约束弱于上述方案。Gen-4 Image References 用于先生成保持角色特征的新图片，再送入视频模型；不能把图像 References 功能说成视频全过程的身份保证。[官方 SDK](https://github.com/runwayml/sdk-node/blob/main/src/resources/image-to-video.ts)、[References 指南](https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References)

Runway 的官方固定镜头指南也承认静止镜头可能难以实现，建议明确主体运动、强化镜头静止描述，必要时后期稳定。人物脸型、肩颈、手部和画风仍需逐帧筛选。[镜头指南](https://help.runwayml.com/hc/en-us/articles/47313504791059-Camera-Terms-Prompts-Examples)

本轮插件发现结果显示 Runway 尚未安装；没有进行生成调用。官方存在媒体生成 MCP，也存在负责账户、任务和文档的 Dev MCP，两者不同。API 另需 Runway Dev 账户及凭据；插件连接、账户额度、具体模型曝光范围均待确认。[MCP 区别](https://docs.dev.runwayml.com/guides/mcp/)、[API 入门](https://docs.dev.runwayml.com/guides/using-the-api/)

## 本地 Wan：保留研究，不作为当前首选

Wan2.2 TI2V-5B 官方方案提供 720p／24fps，带卸载的示例仍要求至少 24GB 显存；官方基础 I2V 示例只有一张输入图。明确的首尾帧入口在 Wan2.1 FLF2V-14B-720P。不能把这两个模型的能力和显存要求混为一谈，也不能以能运行低显存量化版推断画质达标。[Wan2.2](https://github.com/Wan-Video/Wan2.2)、[Wan2.1 首尾帧](https://github.com/Wan-Video/Wan2.1#run-first-last-frame-to-video-generation)

对于此前讨论的 8GiB 级设备和既有本地视频失败记录，不建议默认恢复已清理的环境、继续大动作试错。云端短片的小动作与首尾约束，是新实验与旧方案的关键差别；新方案仍须拿实际片段证明有效。Wan2.2 后续已核对到 Comfy 原生 FLF2V 与 PAI Fun InP 路线，不能以基础单图示例推断所有 Wan2.2 路线都没有尾帧控制，具体见上面的本地方案。

## 制作顺序与判断边界

先保留完整原画构图，制作一条闭口待机循环；每次只增加一种动作。先审原始生成片段，再处理循环切点和少量重叠，最后才考虑放大和插帧。Topaz 插帧通过运动估计合成中间帧，官方也记录了复杂运动的伪影限制；因此 4K／60fps 是输出规格，无法证明脸型、人体比例和身份已经正确。[Topaz 插帧说明](https://docs.topazlabs.com/video-ai/filters/frame-interpolation)

小样验收应同时检查中间帧和接缝：眼距、下颌、颈肩与衣领不能漂移，背景不能缓慢推拉；连续播放至少十轮，观察首尾停顿、反向运动、重影及突然变亮。首尾图相同只能约束端点，不能代替这些检查。

这条路线有望复现参考壁纸的动态观感，但不提供任意角度实时转头，也不会自动随任意新语音精确改口型。下一步应交付一条由自己的原画生成、连续循环可检查的小样，用户认可后再扩展动作库；本轮结论不等于已经达到参考作品质量。
