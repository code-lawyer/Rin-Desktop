# Olivia Lin：书信陪伴与角色记忆路线核查

核查日期：2026-10-24。关联 EXP-01，并与 ART-09 的人物表现目标比较，作为用户提出的另一条技术路线探索。本文通过 GitHub 一手源码、完整文件树、发布记录和构建配置核查；**没有下载或运行上游 EXE，没有安装依赖、调用模型账户、录音或进行人物美术验收。** 本文不改变当前五姿态壁纸、Agent、用户数据或交付方向。

**结论：`1Dreamer666/olivia-lin` 值得参考的是“用人设、往来记忆与慢节奏交互建立角色感”的方法。它没有提供 Rin 当前所缺的同一人物连续动作、固定家具、人物分层、实时口型或语音链。可以研究一个独立的角色陪伴层；不能据此认定五姿态画面一致性已解决，也不能把研究自动转成替换现有 Agent。**

## 固定版本与项目身份

主要证据固定于默认分支 `main` 的 [`9fb603e292e7b13d48ea84e0a07c0f0b4cf07004`](https://github.com/1Dreamer666/olivia-lin/commit/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004)，提交时间为 2026-10-17。源码在 `BSide_Olivia_Lin/`，根目录没有 README。为补足可维护的 TypeScript 源文件，另查开发分支 `feature/toy-web-ts` 的 [`a4dc308afd9c0be76695c18360f7a33a47be84da`](https://github.com/1Dreamer666/olivia-lin/tree/a4dc308afd9c0be76695c18360f7a33a47be84da)。两个固定版本的 `app/server.py`、`app/static/js/app.js`、`skill/model_client.py`、`skill/memory_bank.py` 的 Git blob SHA 一致，本文描述这些文件时以 main 永久链接为准。[main 完整树](https://api.github.com/repos/1Dreamer666/olivia-lin/git/trees/907afeb4df73bb2b5a26461b7264def92103620b?recursive=1)、[开发分支完整树](https://api.github.com/repos/1Dreamer666/olivia-lin/git/trees/a4dc308afd9c0be76695c18360f7a33a47be84da?recursive=1)。

上游自称《BSide: Olivia Lin》的个人纪念性书信陪伴复刻，交互是写信、等待、读回信及保存往来。README 对原作所属、停运日期等历史信息的叙述是上游作者的声明，本轮没有独立核实原作历史，也不把该仓库当作原作官方源码。[README](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/README.md)。

## 实际运行链

| 层 | 源码中的实现 | 对 Rin 的含义 |
| --- | --- | --- |
| 桌面入口 | Python 标准库 `ThreadingHTTPServer` 提供静态文件和 JSON API；PyInstaller 包装后启动服务、打开默认浏览器。[服务入口](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/server.py#L464-L498)、[打包清单](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/build/olivia_onefile.spec) | 没有显示出必须替换 Electron 的架构优势；EXE 存在不代表有原生桌面壁纸宿主。 |
| 纯网页入口 | 静态 HTML/CSS/JS 可独立运行，内嵌 TypeScript 编译后的 `AppCore`；UI 先尝试 `/api/*`，失败则回到浏览器内核。[前端入口与回退](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/js/app.js#L1972-L2054) | 可借鉴浏览器内离线演示，但两套存储与运行路径需要明确归属。 |
| 在线回信 | 把人物档案、设定记忆、书信写法、few-shot 示例和用户往来摘要组装成 system prompt，再调用 OpenAI 兼容、Anthropic 或 Gemini 协议。[组装器](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/loader.py)、[客户端](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/model_client.py#L122-L348) | 这是模型调用前的人设与记忆组织方式，不是操作电脑或执行任务的 Agent。 |
| 离线回信 | 用中文词表识别主题、情绪与告别，挑选预写句段、引用来信短句、加一条往事回声，组合出信件。[分析词表](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/local_engine.py#L16-L75)、[合成函数](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/local_engine.py#L287-L352) | 离线时“有回信”有实现依据，但其理解范围由词表和模板限定。 |
| 视觉与声音 | 信纸、印章、信封、打字机效果；Canvas 画雨；WebAudio 合成敲字、低音敲击与和弦。[雨与音效](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/js/app.js#L1667-L1784) | 是界面氛围效果，不能据此称为人物动画、语音合成或实时钢琴演奏系统。 |

检查上述两个版本的完整树与运行入口，没有找到 Live2D、VRM、骨骼模型、视频动作库、ASR、TTS、录音或声音驱动口型的实现。仓库中的 `poster.jpg` 也不是绑定人物资产。这里的否定只覆盖已核查版本，不推断作者未公开的工程。[完整树](https://api.github.com/repos/1Dreamer666/olivia-lin/git/trees/907afeb4df73bb2b5a26461b7264def92103620b?recursive=1)、[页面入口](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/index.html)。

## “人格蒸馏”与“记忆沉淀”分别做了什么

**人格蒸馏在这个项目中是人工整理的提示词与示例设计。** `persona/olivia_lin.md` 把身份、性格、语言和行为规则写成 Markdown；`loader.py` 直接读取这些文本和示例信，拼到模型上下文。`distill/CORPUS_TEMPLATE.md` 明确说当前 few-shot 是重建样本，建议收集真实回信后替换 4–6 封示例、再用验收题检查。已核查树中没有学生模型权重、LoRA、训练脚本或训练评测产物，不能据项目用词认定它进行了模型训练意义上的蒸馏。[人物档案](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/persona/olivia_lin.md)、[语料模板](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/distill/CORPUS_TEMPLATE.md)、[组装器](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/loader.py)。

**三级记忆是可解释的轻量结构，没有发现向量数据库或语义检索模型。** L1 是当前来信与回信；L2 将完整原文、回复、时间、关键词主题、天气/心情、来源引擎和状态写成 episode；L3 每次从有效 episode 统计前三主题、最近五次心情、首次往来和少数事件。注入模型的近期记忆只取最近五条，用户摘要是正文压平后前 40 个字符；完整回复虽保存，并不因此全部进入上下文。离线“记得上次”主要根据最近一条可用主题选预写句，不是检索并复述原文事实。[episode 与存储](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/memory_bank.py#L22-L158)、[画像、上下文与回声](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/memory_bank.py#L453-L575)。

因此，它能展示“以前聊过工作”这种连续感；尚不能据源码承诺精确记住姓名、偏好变更、长期事件因果，或正确处理否定、撤回与相互矛盾的陈述。这个能力边界是对词表、截断和最近条目策略的工程推论，未做真实模型效果评测。

**信件沉淀是数据导入与去重，不是再次训练。** `distill_letters` 按 id 优先、完整来信文本兜底判重；跳过已删除记录，补齐主题/时间等元数据，然后入库。这个幂等导入思想适合借鉴，但它不能从任意长历史自动提炼经过验证的事实记忆。[导入实现](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/memory_bank.py#L198-L309)。

## README 与实现之间的重要边界

| 声明或表面印象 | 源码核查结果 |
| --- | --- |
| 分级记忆，最近 30 条 | `MAX_EPISODES=30` 的注释/常量存在，但实际写入以整个 `episodes` 数组最多 200 条裁剪；上下文只取最近五条。不能照文案设计 Rin 的保留策略。[实际裁剪](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/memory_bank.py#L126-L147) |
| 删除绝不物理破坏、随时恢复 | 删除操作确实标记 `DELETED`，模型上下文过滤它；但超过 200 条时直接截去最旧条目，所以它不是无限保留的归档系统。[容量逻辑](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/memory_bank.py#L126-L135)、[软删除](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/memory_bank.py#L327-L419) |
| 大模型流式输出 | 客户端读 SSE 后拼成完整文本；Python 回给页面的是一份 JSON，UI 等完整回信再做打字机动画。上游流式传输不等同于用户看到逐 token 回复。[客户端汇总](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/model_client.py#L150-L189)、[UI 等待及展示](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/js/app.js#L2022-L2110) |
| 每天三封、慢节奏 | 配置有三封限制与最低 3200ms 等待；页面默认勾选“不限量（演示）”，所以三封并非默认强制上限。[页面开关](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/index.html#L29-L35)、[发送条件](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/js/app.js#L1988-L1991) |
| 模型可用 | Python `model_available` 仅检查 TCP 连接；纯前端只检查 endpoint 以 http 开头。均不证明鉴权、配额、指定模型或协议已经可用。[TCP 探测](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/model_client.py#L111-L117)、[前端状态](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/js/app.js#L1382-L1399) |
| 零额外依赖与完全离线 | 标准库 HTTP/REST 和规则回信确实能独立运行；但 Gemini SDK 是可选分支，CI 打包安装 `google-generativeai` 与 PyInstaller；HTML 还请求 Google Fonts。不能把“规则回信离线可用”扩张为所有资源和模型均离线。[可选 SDK](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/model_client.py#L36-L45)、[CI](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/.github/workflows/release.yml)、[字体引用](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/index.html#L9-L12) |

## 两个运行路径不能直接视作同一契约

本地 Python 路径将模型配置和记忆放在 JSON 文件；纯网页路径将配置、API Key、记忆与管理密码保存在浏览器 LocalStorage。信件存档还使用独立的 `linli.history`，最多保留 60 封；它与最多 200 条的记忆库不是同一个数据集合。没有看到跨设备同步服务或两套存储自动合并机制。[配置落盘](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/skill/config.py#L100-L124)、[浏览器配置](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/js/app.js#L1319-L1368)、[信件存档](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/js/app.js#L2094-L2102)。

纯网页由浏览器直接请求模型端点，代码覆盖三种协议的请求形状，但仍受端点 CORS、浏览器网络策略及实际服务兼容性约束，本轮没有用真实 Key 验证。Python 的 `force=model` 失败返回 503；纯网页 `AppCore.sendLetter(..., 'model')` 失败仍回到模板。外层 UI 又会在本地 API 失败时进入纯网页路径，因此“用户指定模型”不构成贯穿两层的硬保证。[Python 强制模式](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/server.py#L179-L225)、[网页协议调用](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/js/app.js#L1141-L1317)、[网页降级](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/static/js/app.js#L1442-L1498)。

另有一个直接影响移植选择的边界：上游默认监听 `0.0.0.0`，响应允许任意 CORS Origin；`GET /api/config` 返回完整配置（其中含 API Key、管理密码），配置和活动记忆接口没有统一鉴权。这是可见源码行为，不是已执行的攻击验证。Rin 若参考角色逻辑，应沿用自身受控的数据与凭据边界，不能将该服务原样嵌入或暴露。[默认配置](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/config.json)、[响应与读取接口](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/app/server.py#L257-L328)。

## 资源、许可与成熟度

根 [LICENSE](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/LICENSE) 是 GNU AGPL v3 文本，但开发分支 [package.json](https://github.com/1Dreamer666/olivia-lin/blob/a4dc308afd9c0be76695c18360f7a33a47be84da/BSide_Olivia_Lin/package.json) 的 `license` 写 `Apache-2.0`；README 另声明林离是第三方虚构角色 IP，并将项目定位为个人非商业纪念。这三层信息不能合并成“所有代码、名字、文本和图片都可自由商用”的结论。直接复制代码或角色资源前需厘清许可范围和声明冲突；本轮建议只研究机制，并为 Rin 独立编写原创人设、文本与数据契约，不把许可证元数据冲突替作者作解释。

截至核查日可见最新发布为 [v0.2.2](https://github.com/1Dreamer666/olivia-lin/releases/tag/v0.2.2)，包含源码 ZIP、Windows 目录包和单文件 EXE；对应 [GitHub Actions 运行](https://github.com/1Dreamer666/olivia-lin/actions/runs/39035586596) 报告成功，head SHA 与本次 main 固定版本一致。这支持“有可分发构建”，不证明安装、模型连接、记忆质量、角色还原或长期运行已经通过验收。

已核查 main 与开发分支完整树未见自动化测试套件。`samples/eval_testcases.md` 提供十个供人手工打勾的风格场景；开发分支 `package.json` 只有 esbuild 打包命令；发布 CI 执行打包与上传，没有列出测试步骤。因此成熟度更适合描述为**有源码与发布包的陪伴应用原型，可用于拆解体验和结构**，不能直接作为 Rin 生产数据层或任务执行层的成熟替代品。[手工评测表](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/BSide_Olivia_Lin/samples/eval_testcases.md)、[构建脚本](https://github.com/1Dreamer666/olivia-lin/blob/a4dc308afd9c0be76695c18360f7a33a47be84da/BSide_Olivia_Lin/package.json)、[发布工作流](https://github.com/1Dreamer666/olivia-lin/blob/9fb603e292e7b13d48ea84e0a07c0f0b4cf07004/.github/workflows/release.yml)。

## 对 Rin 的可选实验方向

当前五姿态、美术失败与连续性要求仍以[五姿态连续性方案](five-pose-continuity-plan-2026-10-23.md)和[固定三维场景证据](character-continuity-sources-2026-10-23.md)为准。Olivia Lin 增加的是另一个问题的参考：人物画面之外，怎样让回复具有稳定性格，并在用户允许时记住往来。

建议的工程推论是把“角色陪伴”作为可选、独立的语义层：原创角色档案决定措辞和交往边界；专属会话与可查看、可删除的事实记忆保存被允许的往来；少量明确事件驱动等待、读信、回信等表现。角色文案不能改写工具结果、审批要求、任务状态或草稿，也不能把随机闲置姿态当作人物有真实记忆的证据。它不要求替换现有 Electron、语音服务或 Agent 任务流程。

本地源码对照后的具体边界如下；右列是候选设计，不是本轮已实现能力：

| 当前 Rin 模块 | 已有行为 | 角色路线的增量 |
| --- | --- | --- |
| [character-profiles.cjs](../../prototypes/live2d-codex/backend/character-profiles.cjs) | 人物资源、声线及朗读语气 | 增加独立原创人设和示例，不把声线配置当作人格记忆。 |
| [still-policy.mjs](../../prototypes/live2d-codex/renderer/still-policy.mjs) | 工作、等待、采音、朗读及闲置决定五态 | 角色事件只提供受控的表现意图，继续遵守采音、暂停和当前任务优先级。 |
| [wallpaper-renderer.js](../../prototypes/live2d-codex/renderer/wallpaper-renderer.js)、[wallpaper-choice.cjs](../../prototypes/live2d-codex/backend/wallpaper-choice.cjs) | 正式入口只启动静态人物并接受 artwork 类型 | 文本小样不需要新渲染器；动画素材、五姿态一致性仍独立验收。 |
| [当前架构](architecture.md)、[workspace-store.mjs](../../prototypes/live2d-codex/backend/workspace-store.mjs) | 单个活动后端、选中会话及按目标保存的草稿 | 为陪伴模式明确专属会话和记忆归属；不能假定可以后台并行运行第二任务。 |

建议的小样数据分开保存角色规则、来往原文和事实记忆；每条事实带来源、时间和有效状态，更新或删除可以追溯。模型生成的角色故事不自动成为用户事实。先验证明确的偏好、否定、更正、删除和无依据问题，再考虑更复杂的语义检索。技术接入可沿用已有的语音输出能力，但真实模型必须按明确选择的后端和账户边界接入；本轮没有新增服务或变更计费。

后续若用户选择继续，可先做与主应用数据隔离的文本小样：使用虚构往来测试角色一致性、前后矛盾修正、删除后不再引用、引擎失败来源提示和历史容量边界；先用固定响应验证契约，再决定接哪个真实模型。视觉小样仍单独检查人物身份、五种动作、家具轮廓、接触与过渡。两项实验各自通过才讨论整合，不能用文本风格通过代替美术、语音或硬件验收。

本轮未确认的事项：真实模型三协议及 CORS 兼容性、实际流式超时效果、模板与模型的人格表现、长期记忆准确性、并发写入及故障恢复、发布包启动/退出与资源使用、第三方角色及资产授权。源码可见、CI 成功和 README 宣称均不替代这些验收。

## 本仓库验证记录

本轮只增加研究文档、入口和台账，不涉及前端源码或构建产物。`npm run project:docs` 已生成 73 项任务的进度页；`npm run check:project`、`npm run check:public` 的工作区审计均通过，六项 `node --test tests/project-catalog.test.mjs` 文档/台账契约测试通过。公共审计未检查 index，也不构成发布验收。

全量根命令 `npm test` 在默认沙箱临时目录遇到文件重命名权限错误；改用工作区专用临时目录后，桌面套件 277 项中 275 项通过，两项 Windows junction 创建报 `EPERM`，因此后续根测试未被该命令执行。没有为了通过测试修改权限相关用例，也不把这次全量回归记为成功。前端未变更，未执行构建；本轮没有硬件或真实 Agent 验收。
