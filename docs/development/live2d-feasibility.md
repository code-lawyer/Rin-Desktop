# 人物壁纸精细 Live2D 升级可行性

调研日期：2026-10-21。对应任务：ART-01（本次调研）、FUT-02（后续模型制作）。本轮范围是源码核实、已有模型离线参数采样、已有制作工具的只读 CLI 检查及公开一手资料调研；没有安装新工具、下载模型权重、上传角色原图、生成新模型或做 GPU/实机验收。下文区分本地已验证与第三方文档能力。

## 结论与当前前提

**值得升级，优先升级角色素材与绑定，保留现有 Cubism 渲染链。** 当前壁纸已通过 `@jannchie/pixi-live2d-display/cubism4` 加载 `.model3.json` 与真实 `.moc3`，并逐帧驱动参数，不能描述成完全没有 Live2D 的 PNG 播放器。现在的效果与精细 VTuber 模型之间，主要差距是可独立运动的部件、遮挡补画、参数造型和动作设计。参考[当前渲染代码](../../prototypes/live2d-codex/renderer/wallpaper.js)。

可以用 AI 和程序化工具完成原画辅助、拆件初稿、网格与参数初稿、动作编排、运行时接入及自动验收。**尚不能承诺把任意一张现有壁纸无损、一键变成专业完整绑定。** 判断成功必须看连续运动、组合参数与导出后的实际渲染，不能只看文件后缀、工具成功返回或演示视频。

## 本地模型实际检查

新增可复现入口 `npm run qa:live2d-models -- --run`，源码为 [模型检查器](../../tools/qa/live2d-model-inspection.mjs)。它用现有 Cubism Core 读取男女两份 MOC3，对每个参数的关键值及范围内采样值计算顶点与透明度变化，同时检查注意姿态的 0、0.5、1 三种上下文。默认只显示帮助，无需账户、音频、GPU 或新依赖。

| 两份模型均观察到 | 结果与含义 |
| --- | --- |
| 2 个 Drawable、24 个参数 | 两个 Drawable 对应 AttentionScene、TypingScene，都是整场景网格；并非眼、嘴、发丝等独立部件。 |
| `ParamAttention` | 只有透明度变化，没有顶点变化：抬头依靠两幅姿态图淡入淡出。 |
| `ParamSceneBreath`、`ParamTypingLeft/Right` | 有顶点变化：呼吸与两手手指使用了实际网格变形。 |
| 其余 20 个参数 | 此采样中没有顶点或透明度变化，包括头部角度、眼睛、嘴、头发。参数列表里有名称，不代表已经有有效绑定。 |
| 模型清单 | 未引用 physics 或 motions 文件；当前四项动作由 renderer 每帧直接驱动。 |

这支持用户对“抬头像换图”的观察，也说明现状不是纯图片播放器。检查范围不包含所有参数联动、像素画质、帧率和 GPU 资源。原始运行结果按次保留在被忽略的 `work/qa/live2d-models`，公共结论可由上述命令重现；不把私人运行目录设为公共文档依赖。

另对已有 PSD2Live 3.4.5 执行 `--help` 与 `targets`，均退出 0；导出目标包含 `moc3`、`cmo3`、`vtube-studio` 等。这验证了本机 CLI 可以调用，尚未验证新的角色自动建模。帮助输出有 Java 用户偏好注册表访问警告，未为此修改权限或注册表；原始输出保留在 `work/qa` 的独立运行目录。

## 工具实际能够做什么

| 工具 | 本轮确认的能力与调用入口 | 对本项目的意义和边界 |
| --- | --- | --- |
| Live2D Cubism Editor | 官方提供半自动面部变形器/XY 动作生成；先要求准备对应部件与变形器，且针对正脸。 | 作为建模与最终检查工具可靠；它没有消除拆图、遮挡补画和美术调整。官方[面部自动生成说明](https://docs.live2d.com/en/cubism-editor-manual/face-auto-edit/)明确列出前置条件。 |
| PSD2Live | 从分层 PSD 生成网格、变形器、参数、物理和动作，导出 `.cmo3`、`.moc3` 文件族；有 CLI、本地 MCP 与可编辑工程。查询时最新发布是 2026-10-20 的 v3.6.0。 | 最值得做小范围技术验证的开源制作工具，能沿用现有 Cubism 播放端。项目自己明确要求在目标 Editor/runtime 检查导出差异，不能把其演示当作本项目验收。[项目](https://github.com/tsunehimatoi/psd2live)、[发布](https://github.com/tsunehimatoi/psd2live/releases/tag/v3.6.0)、[导出边界](https://github.com/tsunehimatoi/psd2live/blob/master/docs/zh/spec/RUNTIME_EXPORT_ARCHITECTURE_AND_GAPS.md)。 |
| See-through | SIGGRAPH 2026 项目；已开放代码、模型和 `inference_psd.py`，可把动漫人物分成最多 23 类透明部件并补全遮挡，输出 PSD；有作者提供的 HF/ModelScope 演示。 | 比通用背景分离更接近角色拆件，适合做初稿。作者明确说明尚不是完整 Image-to-Live2D：精细拆件和绑定仍需后续工作。[作者仓库与限制](https://github.com/shitagaki-lab/see-through)。 |
| Qwen-Image-Layered | 已发布权重；`QwenImageLayeredPipeline` 接收图像、层数等参数，输出 RGBA 图层，项目 UI 可导出 PSD。 | 可分人物、背景和配件；提示词不能直接精确指定每层语义，仍须人工检查是否把睫毛、眼白、瞳孔等拆对。不是 `.moc3` 生成器。[代码及使用说明](https://github.com/QwenLM/Qwen-Image-Layered)、[模型卡](https://huggingface.co/Qwen/Qwen-Image-Layered)。 |
| Inochi2D / Inochi Creator | 开源参数化网格变形、绑定编辑器与独立模型格式；官方 SDK 提供 C FFI 和 WebAssembly 路线。 | 能做真正连续的 2D 人物动画，但不是 Cubism 模型的直接替换；需要另建播放/资产链。当前已有 Cubism，收益未证明，暂不优先。[编辑器](https://github.com/Inochi2D/inochi-creator)、[SDK](https://github.com/Inochi2D/inochi2d)。 |
| Talking Head Anime 3/4 | 神经网络从符合约束的角色图生成动态形象；第 4 版提供按角色训练的小模型，原始大模型不适合实时。 | 可用于效果实验，但产物不是 Cubism rig。第 4 版需要逐角色训练，官方仓库还未提供其网页演示使用的转换代码；与桌面低负担播放目标不直接吻合。[第 4 版说明](https://github.com/pkhungurn/talking-head-anime-4-demo)。 |
| Auto-live2D-beta | 输入预拆件 PSD，浏览器 WebGL 自动网格、变形、物理、眨眼和口型。 | 是另一套 2.5D 浏览器播放方案；眼口包含差分淡入淡出，文档没有证实可导出 Cubism `.moc3`。不能仅因名称含 Live2D 就视为目标交付格式。[作者说明](https://github.com/lTwTlol/Auto-live2D-beta/blob/main/README.en.md)。 |
| live2d-automation / image2live2d | 前者有 MCP，但 README 明写 mock 中间产物，真实导出需连接外部 Editor 工作流；后者有实验性静态单网格与启发式自动绑定生成，作者不保证商业级完整角色。 | 可以参考接口和验证门槛，暂不作为质量承诺依据。必须检查实际产物是否有有效参数和正确运动。[MCP 项目](https://github.com/J621111/live2d-automation)、[实验生成器](https://github.com/bssm-oss/image2live2d)。 |

另查到 [video2live2d](https://github.com/FMsongX2/video2live2d)：它把视频动作转换成 `.motion3.json`，需要已有绑定模型，适合将来的动作素材制作，不能替代角色建模。上述工具已覆盖最相关的制作链；只输出视频、透明 PNG 或动作曲线的工具不归为完整模型生成器。

[Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) 的语音交互、表情映射和桌面形象，以及 [AIRI](https://github.com/moeru-ai/airi) 的 Live2D 驱动与眨眼/视线机制，可参考运行时组织方式。它们接收和驱动已有模型，不能代替本项目角色的分层与绑定制作。无需为了获取这些能力替换现有 Agent、语音和数据系统。

## Agent 能参与到哪一步

PSD2Live 的 MCP 并非只写在宣传中：有公开[接口契约](https://github.com/tsunehimatoi/psd2live/blob/master/docs/zh/agent/MCP_AUTHORING.md)、[工具注册源码](https://github.com/tsunehimatoi/psd2live/blob/master/src/main/kotlin/io/github/psd2live/agent/AgentToolCatalog.kt)和[命令行代理](https://github.com/tsunehimatoi/psd2live/blob/master/mcp_proxy.py)。可以在完成本机版本和接口核实后，让 Agent 读取图层、参数、变形器与当前姿态，修改关键形、动作和物理，保存工程并导出；也能先试运行一组编辑再提交。

仓库已有 `tools/psd2live-3.4.5` 第三方制作工具，其启动配置指定 `io.github.psd2live.MainKt`，无需因本调研先行安装新版。固定版本[命令行文档](https://github.com/tsunehimatoi/psd2live/blob/v3.4.5/docs/zh/guide/DEVELOPMENT.md)及[入口源码](https://github.com/tsunehimatoi/psd2live/blob/v3.4.5/src/main/kotlin/io/github/psd2live/Main.kt)区分无参数 GUI、`--help`、`targets` 和 `--input/--output` 批量导出。该版本 MCP 随 GUI 工作区启动，未确认独立无 GUI MCP 服务模式；其 `mcp_proxy.py` 也没有最新主线新增的单次 `call` 命令。实际使用须按固定版本发现 schema，不能把上游最新说明直接当成本机能力。

这意味着存在“AI 辅助真正建模”的可行入口，但连接了 MCP 不等于审美与建模可靠。上游自己的[实测记录](https://github.com/tsunehimatoi/psd2live/blob/master/docs/zh/STATUS.md)中，参数调整效果较好，表情动作仅少量验证；头发拆分与遮挡补全有失败样本。不能推断一套接口能稳定完成所有角色。

我可以负责运行时参数驱动、TTS 音频到口型的映射、状态与动作规则、模型加载/失败恢复、素材检查和验证脚本；也可以辅助生成原画、修补部件，并编排上述制作工具。美术仍需逐部件检查，关键是原图没有画出的眼球、口腔、脖颈和头发背面，以及镜框、发丝、领口的遮挡关系。现有男角色的眼镜尤其应独立检查转头时的穿插。

合理的拆件要求是：背景与人物分开；眼白、瞳孔、上下眼睑、眉毛可独立控制；嘴内、牙齿和舌头有足够绘制内容；前后发和衣领保留运动余量；角色需要的左右部件分别绑定。这些不是增加图层数量就自动解决的。PSD2Live 的[素材规范](https://github.com/tsunehimatoi/psd2live/blob/master/docs/zh/spec/PSD_LAYER_SPEC.md)也明确提醒，闭口原图不能靠几何变形恢复不存在的口腔。

当前会话的插件目录查询没有返回专门的 Live2D/Cubism 插件；这不是对外界工具的否定。本机 CLI 已验证可访问，MCP 仍需按所用版本连接并发现接口；本次没有连接新的 MCP。See-through、Qwen 的公开代码/推理入口可以作为制作流水线候选，本次未对现有角色执行推理，不能保证分层质量或本机显存适配。

## 接入现有项目的改动边界

现有 [PixiJS 8 封装](https://github.com/Jannchie/pixi-live2d-display)已提供模型参数、动作和交互基础，官方 [Cubism Web Framework](https://github.com/Live2D/CubismWebFramework)也有眨眼、动作、物理和口型支持。优先保持本项目锁定的依赖，先检查新模型导出目标是否兼容；上游支持某个新特性不等于本项目当前组合支持。

- 制作端：保留可编辑分层工程，重新制作角色网格/变形器和动作，导出 MOC3、模型清单、纹理与需要的 physics/expressions/motions 文件。
- 渲染端：在现有 `wallpaper.js` 分开背景、角色和必要的前景遮挡；扩充参数映射及动作优先级。人物转身后气泡锚点仍需正确。
- 语音端：[speech-ui.js](../../prototypes/live2d-codex/renderer/speech-ui.js)已有 PCM 与 AudioContext 播放链；可从实际播放的音频提取音量包络驱动嘴巴，而非按合成开始时间猜测。暂停、中断、换角色、结束必须归零。音量驱动开合有[官方 Web 示例](https://docs.live2d.com/en/cubism-sdk-tutorials/native-lipsync-from-wav-web/)；更精细的口形还需要相应的美术绑定与算法。
- 状态端：沿用当前人物确认、声线默认值、失败保留与明确重试的协议；Windows 桌面承载、Agent、数据和模型下载不因换美术模型而重做。

## 建议实施顺序与验收

1. **保留当前两人物，建立一个独立半身制作样例。** 先把一名角色的脸、眼、嘴、前后发、脖颈和肩膀做好；现有整场景图需要先分出并补全干净背景，雨窗、桌面和笔记本电脑按前后遮挡组织。素材形式应为可编辑 PSD/分层原图，保留角色身份和画风。
2. **对比自动初稿与精修结果。** 以 See-through 或现有分层工程作为起点，PSD2Live 生成基础绑定，再用其编辑能力或 Cubism 修正。AI 推理放在制作阶段，日常壁纸播放只加载完成的模型，不把扩散模型塞进安装包。
3. **先实现可见改进的基础参数。** 目标包括连续眼睛开合、瞳孔跟随、嘴巴开合/形状、头部 XY/Z、身体轻摆、呼吸和头发物理。待机、倾听、思考、说话和错误提示是组合这些参数的行为，不需要为每个状态重画整张人像。
4. **在真实目标运行环境检验。** 检查中立姿态、每个参数端点、组合角、慢速过渡、纹理边缘/遮罩/露底；检验口型与实际播报、动作优先级、切换失败保持原模型与声线、显式重试、保存重开及独立安装。记录 1080p/4K 下帧率、CPU/GPU/显存与空闲耗电，不能从示例数字推断本机表现。

最小样例通过后再决定两名角色是否全面重做。此时才有依据估算精修时间和艺术成本；本轮没有用“几天必成”或演示视频替代效果验收。

## 许可与待验证事项

- Cubism Framework 的可见源码不代表 Core 开源，Core 仍按专有条款使用。官方允许在其条款范围内使用 AI 辅助素材制作；独立模型素材也有自己的权利边界。[官方 AI 使用说明](https://help.live2d.com/en/other/other_33/)、[SDK 发布条件](https://www.live2d.com/en/sdk/license/)。
- 本项目现有发布范围是固定两个人物。若未来允许导入不限数量的自定义模型，应在发布前重新核对官方 Expandable Application 分类；该分类的许可要求也适用于通常获豁免的个人/小企业。此处是依据官方条件提出的接入约束，不是已取得许可的结论。[官方扩展应用说明](https://www.live2d.com/en/sdk/license/expandable/)。
- PSD2Live 的编辑器、引擎与 Cubism 导出模块是 GPL-3.0，部分格式框架与独立运行时是 MIT。工具源码、工具分发、模型素材和最终应用 SDK 是不同层面的许可，采用前按实际模块确认；本轮未把第三方代码合并到应用。[上游许可划分](https://github.com/tsunehimatoi/psd2live#许可)。
- See-through 代码为 Apache-2.0，但模型卡说明权重还继承 SDXL、Animagine 和 LayerDiffuse 的 OpenRAIL 条件，不能把全部权重概括为无限制 Apache。Qwen-Image-Layered 模型卡标注 Apache-2.0。模型权重条款和输入原画权利仍需分别记录。[See-through 模型条款](https://huggingface.co/layerdifforg/seethroughv0.0.2_layerdiff3d)、[Qwen 模型条款](https://huggingface.co/Qwen/Qwen-Image-Layered)。
- Inochi2D 的默认软件许可为 BSD-2-Clause；模型作者仍自行决定素材许可。[官方许可说明](https://github.com/Inochi2D/inochi2d/wiki/Legal-Info)。
- 尚未证明：现有母图在任何拆图模型中的品质、当前本机工具版本具备全部上游 MCP 能力、完整导出在本项目固定 Cubism 版本中的兼容性、两角色精修效果与实机性能。公开文档和模型下载页可访问，不等于已完成 API 调用、GPU 推理或成品制作。

本调研只支持“继续做精细模型样例具有可行性”，不改变原有发布/安装验收结论，也不代表 FUT-02 的完整美术交付已经完成。

## 本轮维护检查

`npm run project:docs` 已由台账生成进度；`npm run check:project` 与 `npm run check:public` 通过，后者检查工作区而非 Git 索引。`npm test` 在独立临时目录通过本地 228 项应用测试与 51 项根目录测试，共 279 项；首次沙箱运行因临时文件原子重命名的 EPERM 失败，保留原日志后在允许写入的独立环境重跑成功。模型检查器的默认帮助与显式执行均通过。此次没有前端实现改动，因此未重新构建前端；这些检查不作为新模型画质、硬件或安装验收证据。
