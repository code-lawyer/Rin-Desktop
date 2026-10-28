# 本地制作人物视频：16GB 显存与 32GB 内存方案

> 路线变更（2026-10-22）：用户已明确放弃视频片段方案，当前方向为 [4K 静态壁纸与环境音](static-wallpaper-plan.md)。下文是此前研究/试用的历史记录，后续视频制作与验收计划已停止；已有代码和素材保留，主应用视频入口已由 ART-09 退出，当前实现见[原画恢复与第一阶段小样](static-wallpaper-preview.md)。

调研日期：2026-10-22。对应 ART-07 的 A 工作、B 望窗、C 注视用户三张候选帧，以及三条循环、六条有向过渡。用户给出的设备条件是 RTX 5060 Ti 16GB、32GB 系统内存；该设备并非当前执行机器。按用户要求，本轮只提供方案，没有安装、下载权重、探测设备或生成视频。以下是基于作者模型卡、官方工作流和实现源码的实验方案，不是硬件验收结果。

## 补充 H3 后的选型修订

前一轮没有充分纳入 MiniMax H3，不能把 Wan 5B 的轻量方案理解为画质优胜结论。补充核查后，按用户重视真人质感和自然动作的目标，**把 H3-Base-FL2VA 的低显存路线列为第一组画质验证，Wan2.2-Fun-5B-InP 保留作资源成本对照和备选**。这是实验优先级，不是尚未进行的同镜头质量排名。下面 Wan 部分仍是可执行的独立备选方案。

H3-Base-FL2VA 原生接受首图、尾图或两图，匹配 A→B、A→C 等任务。另一套 Ref2VA 用于多模态参考；当前三张关键帧的转场可先用 FL2VA。H3 官方说明的完整系统还包括托管的 Context-IR 和尚未开放的 Regenerate-2K；本地公开 Base 与官方完整 2K 服务不能当作同一个成片流程。[H3 官方模型及模块说明](https://github.com/MiniMax-AI/MiniMax-H3)

首轮建议两模型使用同一对 A→C 图片、相同构图、接近的时长，各自采用自己的原生采样基线；串行生成少量候选，记录质量、成功率和耗时。H3 可从 768×480、模板的约 5 秒档开始，模板换算为 124 帧、24fps；其帧数网格是 `17k+5`，不能套用 Wan 的 `4n+1`。H3 先用 20 步基线，再单独比较适配 FL2VA 的 Turbo；不把首轮所有加速都叠在一起，避免无法判断肤质和动作损失来源。这些是本项目建议，不是目标机实测参数。[Comfy 原生约束与采样基线](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)

H3 的提示词应按官方关键帧指南改写，注明两图对应的开始和结束位置，描述中间动作路径，保持单镜头、闭口和固定机位。输出可以不保留音轨，但仍按所用工作流准备必要的音视频组件，不假定静音导出就能省掉生成时的音频分支。[H3 官方提示词指南](https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/references/base-en.txt)

产品发布还有独立的许可差异：H3 使用自定义社区协议，包含地域、商业使用和输出相关条款，不能按 Wan 5B 模型卡的 Apache-2.0 标签同等处理。具体部署和成片分发范围需按当时授权核对；本轮不据此推断用户没有授权，也不把它当作此前未比较 H3 的理由。[H3 原始许可证](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)

## Wan 路线的选择

**在 Wan 系列内，先试 ComfyUI 的 Wan2.2-Fun-5B-InP 原生首尾帧工作流，使用 Q8 GGUF；显存仍紧张时改 Q5。** 它的规模适合先筛选动作，且具备本项目需要的两端图像条件。画质未通过时，再用 Wan2.2-Fun-A14B-InP Q4 做相同镜头对照；Wan2.1-FLF2V-14B Q4 是单模型的另一条备选。这个顺序是对硬件、两端控制和部署复杂度的综合判断，不是已测得的质量排名。

| 路线 | 两端控制的依据 | 本项目中的位置 |
| --- | --- | --- |
| Wan2.2-Fun-5B-InP | Alibaba PAI 模型卡明确支持首尾图预测；训练规格为 121 帧、24fps；ComfyOrg 已提供完整 5B Inpaint 模板 | 首轮首选，先验证工作→注视用户 |
| Wan2.2-Fun-A14B-InP | PAI 专门提供的首尾图模型，使用高噪声、低噪声两套专家；有 Comfy 官方原生模板 | 质量对照，内存压力较高 |
| Wan2.2 I2V-A14B + FLF2V 工作流 | Comfy 原生 FLF2V 模板复用普通 I2V 两专家权重，通过条件节点输入首尾图 | 可用的另一种首尾方案；不能将普通单图 I2V 模板直接当作首尾模板 |
| Wan2.1-FLF2V-14B-720P | Wan 团队独立发布的 FLF2V 权重，官方以 720P 为目标 | 单模型备选，量化后仍比 5B 重 |

来源：[PAI 5B 模型卡](https://huggingface.co/alibaba-pai/Wan2.2-Fun-5B-InP)、[PAI A14B 模型卡](https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-InP)、[Comfy Wan2.2 FLF2V 文档](https://docs.comfy.org/tutorials/video/wan/wan2_2)、[Wan2.1 官方仓库](https://github.com/Wan-Video/Wan2.1)。

这里有三层来源，不能混称：Wan/PAI 提供原始模型；ComfyOrg 提供原生节点、模板及重打包权重；QuantStack、city96 提供社区量化权重和 GGUF 加载器。首尾图是生成条件，**不保证生成视频两端逐像素等于输入图，也不保证循环自动无缝**。

## 首选工作流及准确文件

以 [ComfyOrg 的 5B Fun Inpaint 模板 JSON](https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_fun_inpaint.json)为基础。它已经包含两个 `LoadImage`、`WanFunInpaintToVideo`、文本编码、采样与视频输出节点，无需自行发明首尾帧拼接算法。当前源码中 `WanFunInpaintToVideo` 调用 `WanFirstLastFrameToVideo`，后者按 VAE 的通道和压缩尺度构造首尾条件。[节点实现](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_wan.py)

模板原本使用约 10GB 的 `wan2.2_fun_inpaint_5B_bf16.safetensors`。针对目标机，把它的 `UNETLoader` 替换成 city96 的 `Unet Loader (GGUF)`，接回同一条模型连线，其余条件和采样链保持一致。量化发布者明确说明此模型可用该节点；**这条量化替换路径有发布者支持依据，但本项目尚未实际执行**。[量化模型卡](https://huggingface.co/QuantStack/Wan2.2-Fun-5B-InP-GGUF)、[GGUF 加载器作者说明](https://github.com/city96/ComfyUI-GGUF)

| 文件 | 用途和放置位置 | 核查的下载大小 |
| --- | --- | --- |
| `Wan2.2-Fun-5B-InP-Q8_0.gguf` | 首选主模型，放 `ComfyUI/models/unet/` | 5.41GB |
| `Wan2.2-Fun-5B-InP-Q5_K_M.gguf` | 主模型的更省内存替代，只需二选一 | 3.82GB |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | 文本编码器，放 `ComfyUI/models/text_encoders/` | 6.74GB |
| `wan2.2_vae.safetensors` | **5B 配套的 Wan2.2 VAE**，放 `ComfyUI/models/vae/` | 1.41GB |

大小按下载站十进制 GB 计；Q8 这套约 13.56GB，Q5 约 11.97GB，不含软件、缓存和输出。文件来源：[5B GGUF 文件目录](https://huggingface.co/QuantStack/Wan2.2-Fun-5B-InP-GGUF/tree/main)、[ComfyOrg 文本编码器](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/tree/main/split_files/text_encoders)、[ComfyOrg VAE](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files/vae)。只下载选定文件，不下载包含所有量化等级的整个仓库。

这一首轮不需要 Kijai Wrapper、人物 LoRA、姿态控制网络、CLIP Vision 或额外提示词大模型。先保留一个小而可复现的工作流；安装环境及 RTX 50 系运行时需要另行核对，不能照抄旧教程的 CUDA/PyTorch 组合。

## 首轮具体参数

三张源图为 1586×992，接近 16:10。等比缩放到目标画布，极小的比例差使用补边解决，不拉伸人物；A/B/C 必须共用同一预处理。Comfy 的条件节点内部会中心缩放/裁切，所以应先明确准备好的输入画布，不能依赖默认值随意裁切。

| 项目 | 第一次运行 | 正式筛选候选 |
| --- | --- | --- |
| 镜头 | `06_work_to_user_A-C` | 同一镜头通过后做 `01_A-A`、`03_C-C`，最后补其余六条 |
| 画布 | 768×480；内存不足时降到 512×320 | 先保持 768×480；获选镜头再尝试 1024×640 |
| 帧数 / 输出帧率 | 81 帧 / 24fps，约 3.4 秒 | 过渡 97 帧约 4 秒；循环先 121 帧约 5 秒 |
| batch | 1 | 1，候选按队列串行生成 |
| steps / CFG | 20 / 6 | 先保持，只有发现具体问题才做单变量对照 |
| sampler / scheduler / shift | `uni_pc` / `simple` / 8 | 先保持模板值 |
| seed | 固定并记录 | 同一设置串行试 3 个 seed |
| 加速 LoRA、缓存、编译 | 不启用 | 基线通过后再逐项比较 |

采样值来自原生模板；模板画布默认 640×640，改成接近源图比例的尺寸、分批试 seed 是本项目实验选择。5B 模型卡给出 121 帧/24fps 的训练规格，而官方模板用 81 帧/24fps 作较短示例。节点帧长按 `4n+1` 选择；尺寸采用 32 的倍数，覆盖 5B 的空间压缩与 patch 对齐。不要把“提示词写 6 秒”当作时长控制：时长由实际帧数和输出 fps 决定。原制作单的 6 秒循环可先用 5 秒验证，145 帧/24fps 的更长版本留到基线通过后试验。[原生模板](https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_5B_fun_inpaint.json)、[5B 配置](https://github.com/aigc-apps/VideoX-Fun/blob/main/config/wan2.2/wan_civitai_5b.yaml)

使用[现有九段提示词](character-video-keyframes.md)描述动作，时长描述随工作流一致调整。首轮把动作收敛到“视线离开电脑、轻抬头、注视用户、嘴唇闭合、双手留在键盘”。打字先只做极小幅度手指动作；不要同时要求大幅敲键盘、转身、撩发和表情变化。

模板的通用负面词含“静态”“静止”“静止不动的画面”，与本项目固定镜头、轻微动作的意图存在冲突，应删除这些词，保留脸部畸变、肢体变形、额外手指、字幕等排除项。正面明确固定机位和具体微动，负面约束镜头移动，不要一边要求安静坐姿一边排斥所有静止元素。

所有循环把同一张图接入首尾两个位置。即使 A→A 的端点相近，眨眼、头发、雨滴、呼吸的速度仍可能不连续。不能用整段倒放来补返回镜头；返回动作按独立的 C→A、B→A 等条件生成。

## 16GB 显存、32GB 内存的边界

**模型文件大小不等于峰值显存或系统内存。** 采样还要容纳激活、注意力计算、临时反量化张量；首尾编码和最终 VAE 解码也有自己的峰值。CPU 卸载只是把部分负担转到 RAM 和 CPU↔GPU 传输，不会消灭内存需求。32GB RAM 因而是选择单个 5B 模型先行的重要理由。

建议让文本编码、视频采样、VAE 解码分阶段驻留，避免将编码器固定常驻 GPU；保留自动卸载。内存吃紧时先减画布、减帧数，解码阶段再用分块 VAE，最后考虑更低量化。一次只运行一个生成任务，并关闭同时占用 GPU 的大模型。磁盘先预留 **60–80GB SSD 空间**作为软件、选定权重、缓存和候选片的工作预算；这是项目预算，不是模型作者的最低运行保证。系统分页文件可以防止提交内存耗尽，但不能把大量换页视为正常生产速度。

若改用双 14B 专家，风险更明显：Fun InP 的 Q4_K_M 两个文件各约 9.66GB，Q5_K_M 各约 10.8GB；再加 6.74GB 文本编码器、VAE、运行时及加载过程，32GB RAM 余量很小。不能把两套权重简单全驻留。需要顺序加载/释放专家、确认实际 RAM 峰值；如果持续换页，应退回 5B 或单模型路线，是否升级 64GB 内存取决于实测。[Fun A14B 量化发布者](https://huggingface.co/QuantStack/Wan2.2-Fun-A14B-InP-GGUF)

FP8 也不等于“16GB 随便跑”：Comfy 官方 Fun InP 测试在 4090D 24GB 上生成 640×640、81 帧时，普通 FP8 使用约 83% 显存，4 步 LoRA 版本约 89%。这些数据只能说明该工作流有明显内存成本，不能换算成 5060 Ti 的速度或保证。官方同时提醒加速 LoRA 会损失动态，不能只比较出片秒数。[Comfy 官方测试](https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-inp)

Kijai 的 `WanVideoBlockSwap` 能把 transformer block 换到 CPU；源码显示 14B 为 40 blocks、5B 为 30 blocks，非阻塞传输和预取会额外增加内存。它适合在确有显存问题后调优，不能照抄“swap 20”就认定任何片段都能跑。Wrapper 也支持 GGUF，但不要混接原生 Comfy 模型对象与 Wrapper 采样器；采用其中一套完整示例。[Wrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper)、[block swap 参数源码](https://github.com/kijai/ComfyUI-WanVideoWrapper/blob/main/nodes_model_loading.py)

## 画质不够时的受控升级

第一对照是 **Wan2.2-Fun-A14B-InP Q4_K_M**。基于 [Comfy 14B Fun Inpaint 模板](https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/video_wan2_2_14B_fun_inpaint.json)，选择不带加速 LoRA 的分支，再替换两套加载器。必须使用同系列高、低噪声配对权重，以及 `wan_2.1_vae.safetensors`；不要沿用 5B 的 Wan2.2 VAE。

- `HighNoise/Wan2.2-Fun-A14B-InP_HighNoise-Q4_K_M.gguf`
- `LowNoise/Wan2.2-Fun-A14B-InP_LowNoise-Q4_K_M.gguf`

文件名和大小可从发布者的[高噪声目录](https://huggingface.co/QuantStack/Wan2.2-Fun-A14B-InP-GGUF/tree/main/HighNoise)、[低噪声目录](https://huggingface.co/QuantStack/Wan2.2-Fun-A14B-InP-GGUF/tree/main/LowNoise)核对。首轮缩到 512×320、65 帧、16fps；只比较同一个 A→C 镜头的人脸、动作和手部。保留模板的两阶段调度，不把 5B 的单模型采样参数复制过去。

另一条是 **Wan2.1-FLF2V-14B-720P Q4_K_M**，文件 `wan2.1-flf2v-14b-720p-Q4_K_M.gguf` 约 11.3GB，Q5_K_M 约 12.7GB。它只有一套主模型，RAM 管理更简单，但仍需卸载/较低分辨率起步。官方发布目标是 720P；降低分辨率属于目标机试验，不能当作与官方样例等价的画质承诺。[官方模型卡](https://huggingface.co/Wan-AI/Wan2.1-FLF2V-14B-720P)、[city96 量化文件](https://huggingface.co/city96/Wan2.1-FLF2V-14B-720P-gguf/tree/main)

截至调研日也核对了后继项目：Wan-Animate-2 需要人物参考图和驱动视频，官方默认环境是多张 A800；Wan-Dancer 面向音乐驱动长舞蹈。它们的任务和官方资源条件都不是这次三张静帧、小幅动作实验的首选。是否有未来更合适的新权重应另行验证，不能因版本号更高就替换已经可控的首尾流程。[Wan-Animate-2](https://github.com/Wan-Video/Wan-Animate-2)、[Wan-Dancer](https://github.com/Wan-Video/Wan-Dancer)

## 第一条片的验收与后处理

1. 记录模型文件及哈希、Comfy/节点版本、完整工作流 JSON、seed、分辨率、帧数和采样设置。
2. 分别记录首次加载和第二次运行的耗时、峰值 VRAM、峰值 RAM；采样成功且解码成功才算跑通。不借用其他显卡的时间估算这台机器。
3. 原速、慢速查看全片：脸型/身份稳定，颈肩自然，双手和键盘不融化，视线确实抵达 C，背景不漂移。
4. 检查第一帧、最后一帧和各自邻近帧，确认可以接 A、C 循环；循环重复播放至少十遍。端点相似度仅辅助定位，美术验收必须看运动。
5. 通过后再做放大和补帧；它们改善分辨率或流畅度，不能修好变形的脸和手。整段采用一致处理，不能逐帧随机“修脸”。先保留原始生成文件，再统一输出应用需要的格式。
6. 若重复端帧导致连接处停顿，可在实际解码后去掉多余的重复端帧；若接缝明显则重新生成或挑选安全衔接区间，不用强行短叠化制造双脸。

最后仍然将合格的预生成短片交给现有独立播放器。生成工具只用于制作素材，不进入产品运行依赖，不依赖 Wallpaper Engine；这也不构成任意语音的实时口型同步。

## 其他路线与运行环境

**LTX 有首尾帧能力，但本轮先不增加第二套环境。** Comfy 的 LTX-2.3 原生 FLF2V 模板使用 distilled FP8 与 Gemma FP4；Unsloth 也提供约 13GB 的 Q4_K_S 变体。它还需要文本编码器及 VAE，不能因为主模型文件小于 16GB 就认定整条流程可全驻显存。它可作为后续动作/速度对照，但当前没有这台 5060 Ti 的完整运行记录。[Comfy LTX-2.3 首尾工作流](https://docs.comfy.org/tutorials/video/ltx/ltx-2-3)、[量化发布者](https://huggingface.co/unsloth/LTX-2.3-GGUF)

截至核查日，LTX 官方已提供 2.5、单阶段首尾模板、INT8 ConvRot 配套文件及面向 Blackwell 的 NVFP4 transformer。常规 Comfy 指南列的是 32GB+ 显存；官方 Desktop 推荐 24GB+，同时允许更低配置尝试。它们证明存在低显存优化方向，不是本项目 16GB+32GB 全链路成功的依据，不能直接按最大画质模板起步。[LTX Comfy 指南](https://docs.ltx.io/open-source-model/integration-tools/comfy-ui/)、[官方 Desktop 要求](https://github.com/Lightricks/LTX-Desktop#system-requirements)

**FramePack 不作为这次首选。** 作者声明最低 6GB 显存即可进行长视频生成，但“能在低显存运行”不是首尾姿态可靠衔接或本项目人物画质的证明。该仓库给出的 4090 单帧速度也不能用于估算 5060 Ti；其 README 的旧 Windows 一键包采用 CUDA 12.6/PyTorch 2.6，更不适合直接拿来配置 RTX 50 系。[FramePack 作者说明](https://github.com/lllyasviel/FramePack)

运行环境按 Windows 规划，选择当前 Comfy 官方 NVIDIA 发行包及匹配依赖，或独立 Python 环境，避免与壁纸应用的语音环境混装。PyTorch 从带 CUDA 12.8 的 2.7 版本开始支持 Blackwell；当前 Comfy 官方文档推荐 NVIDIA 使用 CUDA 13.0 版本的 PyTorch。应遵循当时 Comfy 与节点支持的组合，不能仅升级一个组件或照搬旧教程。初次采用原生 PyTorch attention，确认完整流程后才评估额外编译内核。[PyTorch Blackwell 支持](https://discuss.pytorch.org/t/request-for-sm-120-rtx-50xx-cuda-12-8-support-in-pytorch/222207/2)、[Comfy 当前系统要求](https://docs.comfy.org/installation/system_requirements)

无需先训练人物 LoRA；本轮先用已有三张参考图验证图像条件。如果多个候选仍持续出现身份漂移，再决定补中间姿态、增加控制条件或另做人物训练。后两者属于新增实验，不把未经测试的叠加节点当成确定修复。

下一步执行时只做一条 A→C 基准片，记录耗时和两种内存峰值，再决定是否扩大到全部九段。没有目标机实测前，不给出“几分钟必出一条”或“保证达到参考壁纸质量”的结论。当前交付仅为方案。

## MiniMax H3 在目标硬件上的可行性补充

**不能仅凭 16GB 显存、32GB 内存排除 H3。** MiniMax-AI 组织托管的集成目录列出了 12–16GB 路线：约 10.64GiB 的 pruned Q4 GGUF 或约 11.67GiB 的 pruned NVFP4 主模型，配合更小的文本编码器和量化 VAE。但该目录自称由社区维护，量化文件也是社区转换，不能解读为 MiniMax 对原始权重、Windows 或任意 32GB 内存机器的运行保证。[集成目录及硬件表](https://github.com/MiniMax-AI/awesome-minimax-h3-integration)

目前至少有三种真实存在的量化入口。W4A8 作者说明最新 ComfyUI 与 comfy-kitchen 已可原生加载，并展示了 4070 Ti 示例；当前 FL2VA 文件是 `minimax_h3_fl2va_pruned_w4a8_mixed.safetensors`，约 12.5GB，不能照旧索引猜文件名。NVFP4 发布者将该格式定位于 Blackwell，5060 Ti 的架构符合这一方向，但模型卡的硬件建议并不是这台机器的完整生成测试。Unsloth 提供 `minimax_h3_fl2va_pruned-Q4_K.gguf`，约 10.64GiB，并给出匹配的 stable-diffusion.cpp 路径；它的文本编码器也需要数 GB 至十余 GiB。三种文件应分别使用支持其量化方式的加载器与配套组件，不能混用文件就视为同一工作流。[W4A8 作者与当前文件](https://huggingface.co/AX1Y2JP/MiniMax-H3-W4A8-ConvRot/tree/main)、[NVFP4 发布者说明](https://huggingface.co/Abiray/Minimax-H3-nvfp4-INT4-INT8-Convrot)、[GGUF 发布者与运行示例](https://huggingface.co/unsloth/MiniMax-H3-GGUF)

**32GB 内存已有积极的一手运行报告，但条件需要逐项对照。** Tomiigo 在实际 RTX 5070 Ti 上，用辅助进程把可用显存限制到 8188MiB，并以 Linux 内核参数限制 32GB RAM；其 Ref2VA 工作流生成 640×384、226 帧，报告四种变体显存峰值约 7130–7669MiB、未使用 swap。仓库公开工作流和输入素材，没有公开生成视频，属于作者实测报告及复现材料。作者明确表示没有在 Windows 跑过；此例的显卡、系统、参考视频任务均不同于我们的 5060 Ti、Windows、两张首尾静帧任务。因此它说明 32GB RAM 存在可行路径，不能直接当作本项目的性能或画质验收。[作者的配置、测量与限制说明](https://github.com/Tomiigo/minimax-h3-16gb)

下载体积、加载峰值、采样峰值和 VAE 解码峰值必须分开记录。主模型小于 16GB，并不表示文本编码器、激活、缓存及解码可以同时留在显存；CPU 卸载也会把压力转移到系统 RAM。另一个量化发布者 DmitryDB 明确区分了权重文件大小与完整流程峰值，并注明其 RTX 50 系建议基于架构，未在 RTX 5090 完成整段生成验证；展示的 RTX 4090 数据属于加载器/内核测试。不能用这些数字推导“16GB 必然成功”，也不能反向断言必须先升到 64GB 内存。[量化作者的实测范围与内存说明](https://huggingface.co/DmitryDB/MiniMax-H3-ComfyUI-Quants)

针对本项目，应把 H3 FL2VA 量化列入第一组画质验证，以同一组 A→C 图片和固定镜头要求生成短片，再用 Wan 5B 做资源成本对照。采用 H3 自己的原生模板、合法帧数和采样基线，先确认加载、采样、解码全部成功，再比较脸型、手部、微动作与端点衔接。首轮失败时先定位哪个阶段超限，分别调整卸载、分辨率或量化方式；是否值得升级内存等目标机证据出来后再决定。此前选择 Wan 5B 的理由是轻量和流程可控，不能据此宣称它的画质强于 H3。当前仍仅交付方案，未下载模型或执行目标机测试。[H3 官方 Comfy 工作流与参数约束](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)
