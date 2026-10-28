# 质量验证入口

`npm run qa:inventory -- --run` 只读盘点仓库文件元数据和目录占用，不读取正文、不跟随目录联接、不删除文件；默认仅帮助。输出到新的`work/qa/project-inventory`目录。清理须另外核实原片/成品与重建依据、限定路径、保存前后校验；盘点不会自动把大型目录判为垃圾。2026-10-28已核实清理的内容见[全面审查](../../docs/development/project-audit-2026-10-28.md)。

`npm run qa:shutdown -- --run` 使用隐藏的隔离Electron窗口、生产HTML/构建/preload、真实WorkspaceStore与生产退出协调，检查尚未自动保存的输入在退出前落盘；模拟存储失败应取消退出并保留编辑，恢复后才允许退出，父进程读回草稿确认。默认只显示帮助，不调用账户、声音或硬件，不操作日用数据。它补足界面fixture使用合成preload、不能验证真实退出握手的边界；输出进入`work/qa/shutdown-desktop`。

`npm run qa:video-seam -- --run --input=<local-mp4> --at=<seconds> --output=<new-report-id>` 逐帧复现本批固定机位壁纸的切口突变，将整帧、窗景、窗框、灯及沙发与附近实际运动帧比较；显著跨区域突变时非零退出，并导出前后帧和两秒最小复现。`--sources=<work-idle-demo-id>` 核对输入哈希及返回工作接点，比较同帧的原始720p、裁剪、4K和最终编码，帮助区分生成素材、后期和播放问题。默认只显示帮助，不连接账户或改写源片；固定区域和阈值仅用于本批画面诊断，不能自动放行其他场景的美术。当前23.20秒反馈可稳定复现，未标记为已修复，见[原因记录](../../docs/development/work-idle-loop-pilot-2026-10-27.md)。

`npm run qa:idle-loop -- --run --input=<local-720p-mp4> --kit=<idle-kit-id> --output=<new-report-id>` 检查工作循环的片内变化、自身首尾和既有工作/用户转场接点。`--align-existing` 仅在对照分析中使用已检查的恒定中心裁剪；该参数来自本批素材的构图偏差，不是通用修复规则。可选 `idle-loop-registration.py --run --reference=<image> --candidate=<image> --output=<new-report>` 仅诊断固定雨窗区域的缩放与位移，需要已有NumPy/Pillow，不输出编辑后的图像。[工作循环试片](../../docs/development/work-idle-loop-pilot-2026-10-27.md)记录单条生成、免费超分、顺向循环与新旧素材仍未消除的差异。分析/合成默认只显示帮助，不连接账户；普通测试不执行GPU处理。

`npm run qa:transition-trim -- --run --id=<local-bundle>` 为三态连续样片检查末尾1.5秒/开头0.5秒的帧配对、片内变化和裁剪候选，默认仅显示帮助。报告及候选图保存至新的 `work/qa/transition-trim` 子目录，不修改视频或调用账户。当前排除开头0.05秒/结尾0.15秒的候选规则来自本批素材实测，不是所有视频通用的最佳裁剪策略；必须查看动作和停留姿态。[诊断与裁剪样片](../../docs/development/three-state-continuous-demo-2026-10-27.md)说明数值与视觉验收的边界。

`npm run test:transitions` 离线验证三状态有向转场的单次播放、末帧停留、快速改选、暂停/隐藏、失败保图与重试，以及预览服务范围读取。`npm run qa:transitions -- --run --id=<local-bundle>` 对已经准备的本地4K六段素材逐帧解码、核对尺寸/时长，导出首尾帧、联系表和12种衔接对照；报告写入 `work/qa/transition-media` 下的独立目录。默认只显示帮助，不连接账户或触发生成。`npm run preview:transitions -- --run --id=<local-bundle>` 启动独立三状态预览；不修改主应用设置。数值、抽帧和离线逻辑检查不能代替用户美术验收。

`npm run qa:still-scene -- --run` 检查独立的固定场景返修小样：五姿态中9处沙发/桌面/窗框等固定区域的像素一致性，并保存原尺寸画面。默认仅帮助，不启动GUI或写文件；使用隔离数据，不调用账户、声音或设备。此检查不等同于人物边缘或4K美术验收，见[场景一致性返修](../../docs/development/still-scene-consistency-2026-10-23.md)。

`npm run qa:visual -- --run` 集中检查实际 Electron 页面：标准/紧凑/极限尺寸气泡、长内容和审批、六类设置、125%/150% 页面缩放、男女姿态及 3840×2400 截图。检查不可滚达的控件裁切，并实际滚动验证受限高度下的审批、听写和发送操作。默认只显示帮助；使用隔离数据和合成 preload，不访问账户、硬件或声音，输出位于 `work/qa/visual`。需先构建并准备已有本地人物资源。页面缩放不等于系统 DPI 验收，截图仍需人工检查；见[视觉终验记录](../../docs/development/visual-final-check-2026-10-22.md)。

`npm run qa:remote-focus` 在构建后的真实 Electron 页面中创建可见的合成测试窗口，检查鼠标操作后通过 IPC 导航仍有焦点轮廓、折叠字段不进入导航、六类设置、列表刷新、草稿与人物卡片，以及原生鼠标/键盘切回。历史 fixture 中带 video 名称的输入只用于旧设置兼容；当前两态动态播放另由`qa:motion`验证。不会控制用户应用、连接账户或设备；截图与报告进入 `work/qa/remote-focus`。可选 `-- --baseline` 只关闭新增遥控轮廓样式，用于复现原问题，预期退出码为 1；正常验证不加此参数。先运行 `npm run build`。

`npm run test:stills` 检查原图直接切换的失败保图、重试、最新目标、暂停与关闭，录音加载/取消/重试、环境音优先级、音源完整性、旧视频入口退出和预览服务范围。`npm run preview:stills` 打开原图直切与实录小雨/轻敲小样，需原本地美术资源；声音默认关闭，听写/朗读按钮只模拟状态。界面操作与截图记录进入 `work/qa`，不代表正式 4K 美术、实际听感或真实语音/遥控硬件验收。见[小样记录](../../docs/development/static-wallpaper-preview.md)。

当前主应用已经接入[原创两态动态壁纸](../../docs/development/two-state-app-integration-2026-10-27.md)，使用`qa:motion`验证。更早的案例视频桌面路线已退役：`prepare-video-desktop.mjs`和`video-desktop.mjs`仅说明替代入口并停止，不再构建不支持的`--wallpaper=video`试用包；旧fixture独占的视频分支也已移除。原源码与哈希在本轮忽略的审查记录中保留，历史[桌面试用](../../docs/development/video-desktop-trial.md)和[独立样例](../../docs/development/video-companion-preview.md)不改写为当前产品能力。`prototypes/video-companion`的VideoDeck仍被当前动态播放器复用，其他部分支持独立历史预览，不能整目录删除。`npm run test:video`验证播放器离线契约，`test:video-desktop`保留历史模块与旧设置迁移兼容检查。

`npm run qa:interface` 使用实际构建的 Electron renderer 与合成 preload 验证草稿遥控操作、播报控件和工作台分类，并截图标准/紧凑窗口。先运行 `npm run build`。不连接 Agent、设备，不启用录音或输出声音；使用独立临时 Electron 数据目录，运行结果写入忽略的 `work/qa/interface-*`。它证明界面和离线交互，不证明真实设备收音或账户行为。

`npm run qa:halfbody -- --run` 检查已启动的女生半身预览：243 组模型参数、转头/眨眼、真实本地样例音频驱动、停止竞态、坏音频恢复和模型失败重试。需要 `npm run preview:halfbody`、本机样例素材、Playwright 与 Edge；默认只显示帮助，不加载浏览器或声音。运行输出写入 `work/qa/live2d-halfbody`。范围和素材准备见[半身样例说明](../../docs/development/live2d-halfbody-preview.md)。

`npm run qa:live2d-models -- --run` 离线读取已有 Cubism Core 与两个人物的 MOC3，在不同注意姿态下逐参数采样网格坐标和透明度变化。默认只显示帮助；不启动桌面、连接账户、录音、下载或修改素材。结果逐次保存于 `work/qa/live2d-models`，用于区分模型中的参数名称与实际绑定；不代表画质、所有组合参数或性能验收。见 [Live2D 可行性调研](../../docs/development/live2d-feasibility.md)。

`npm run qa:data-agent` 执行数据保护与 Agent 离线专项，报告按次写入 `work/qa/data-agent-release`。覆盖旧数据采用、写入失败、目录联接、草稿恢复、未知提交、审批/问题、流式/取消和退出；不运行真实 Agent、不使用账户或硬件。测试包内 `Run-Offline-Checks.cmd` 使用同一入口，报告存放于本机应用的 test-reports 目录。

`npm run data:recover -- --source="<已关闭应用的数据目录>" --out="<新的恢复目录>"` 只预览；增加 `--run` 才复制恢复，拒绝覆盖已有目录。完整范围与人工步骤见[本轮交付](../../docs/development/data-agent-validation.md)和[验收清单](../../docs/development/test-acceptance.md)。

`npm run qa:remote-component` 检查 RC003 辅助程序编译、私有管道握手与退出，并将发布所需依赖复制到独立目录，在 Electron 的 Node 模式加载 Windows 输入绑定。不会注册输入监听、搜索/配对设备、录音或连接 Agent。输出保存于 `work/qa/remote-component`；源码接入和实机验收边界见[RC003 接入说明](../../docs/development/remote-integration.md)。

`npm run qa:known-issues` 使用真实业务模块和合成进程/语音接口复现三个已知问题：Kokoro 加载失败清理、Codex 连接中关闭、新 Agent 完成回复与朗读文本不一致。不会启动真实 Agent、GUI、模型、麦克风或网络服务。

结果按次保存于 `work/qa/known-issues`。退出码 1 表示至少一项仍未修复；这是问题复现，不是普通测试通过的替代。修复对应任务时，将失败路径加入正式回归测试，并让此命令返回 0。旧审查目录的入口只转发到这里，原有审查结果不被覆盖。

真实界面检查统一使用 [GUI 入口](gui/README.md)：五个维护用例默认帮助、显式 `--run`、独立输出和数据目录。15 个旧 `check-*.mjs` 的原文已带哈希归档：4 个转发维护用例，11 个已退出维护目录；人物切换旧路径也转发维护实现。无执行逻辑的历史提示桩也已归档，详见[全项目质量审查](../../docs/development/quality-audit.md)。

`npm run qa:release-package -- --package="<构建或安装目录>" --baseline="<旧包目录>"` 只读核对全部清单文件大小/哈希、应用版本、随包源码与当前源码、未登记文件，以及没有模型/凭据/Agent CLI 混入。可选 baseline 检查场景与 CPU 语音组件保持不变；报告进入独立的 `work/qa/release-package`。不会启动应用或访问账户/设备。

`pwsh -NoProfile -File tools/qa/installer-check.ps1 -Run -PreviousSetup "<旧安装器>"` 使用当前正式安装器，在全新中文/空格路径解包，并在另一隔离目录覆盖旧版本后逐文件验证。使用安装器的 PORTABLE 模式，不注册卸载项、创建快捷方式或启动应用；因此它不代替完整安装注册/卸载验收。默认无 `-Run` 时仅显示帮助。

`run-output.mjs` 为维护工具提供唯一运行目录与禁止覆盖的报告写入。普通回归会验证默认帮助不会加载 Playwright/SDK、连接 CLI 或创建 fixture。参见[统一测试规范](../../docs/development/testing.md)和[施工清单](../../docs/development/progress.md)。

`npm run qa:character-video` 默认只显示帮助；增加 `-- --run --root="<本地参考壁纸目录>"` 后，将目录中的字面量素材清单与三档素材之一交给本机 FFprobe/FFmpeg 离线分析。工具不执行下载的 JavaScript，不联网、不修改素材；结果和四帧联系表写入独立的 `work/qa/character-video-analysis`。它测量循环边界及正反向时序差异，不判定画质、人物身份或生成模型优劣。`npm run test:character-video` 用合成像素检查测量与默认帮助契约，不需要 FFmpeg 或第三方素材。研究结论见[原角色视频制作路线](../../docs/development/character-video-reproduction.md)。

`npm run qa:stills` 使用生产 HTML、构建和 preload 加隔离数据、合成后端，检查女生五张完整帧与目标图逐像素一致、缩略图选择与状态、失败保图/重试、人物声线提交、听写静音回执、真实朗读界面的降音及暂停/恢复。不会访问账户、麦克风或遥控器；结果和截图写入 `work/qa/still-desktop-*`。`npm start -- --background --show=wallpaper` 才启动真实主应用。见[第二版集成记录](../../docs/development/still-set-v2-implementation.md)。

`npm run qa:stills -- --pose-recovery` 单独检查同人物的某张姿态图失败后，选择另一张有效图时工作台能否恢复真实姿态和清除错误；同时验证保图、声线保持和显式重试。原[五姿态审查](../../docs/development/still-set-v2-review-2026-10-23.md)的失败复现已在[两态接入](../../docs/development/two-state-app-integration-2026-10-27.md)中修复并通过。

`npm run qa:motion -- --run` 使用本地合成的四段小型视频与生产页面验证循环、双向切换、暂停、失败重试、人物声线提交、听写与朗读的环境音配合。默认只显示帮助，输出仅在 `work/qa`，不调用账户、模型或设备，也不代替正式人物视频及4K性能验收。

增加 `--media=prototypes/live2d-codex/assets/motion/female` 后，工具先校验并复制六个正式运行文件，再使用正常GPU路径播放4K视频，记录系统实际分配的视口、解码尺寸、预热后的循环间隔、丢帧计数及截图。Windows可能限制窗口尺寸，不能把请求的窗口大小当作实际4K显示验收。工具仍使用隔离数据及合成语音接口，不证明真实账户、语音听感、遥控器硬件或用户美术验收。

`npm run qa:motion-live -- --run --port=<本地主应用调试端口>` 只对已启动的本项目页面读取动态解码和桌面挂载状态；可选 `--enable-preview` 通过现有设置接口选择女生动态自动模式并核对声线保持，`--quit` 正常退出临时调试启动。默认帮助；不发送对话、录音、下载或主动加载语音模型。正常交付启动不开调试端口。

安装器检查的可选 `-Lifecycle` 仅在普通Rin Desktop尚未注册安装、用户与公共开始菜单中也没有Rin Desktop组时执行。它在独立工作目录安装，验证新建的默认开始菜单组，之后通过同目录卸载器清理注册/快捷方式并检查外部合成数据保留；提供旧安装器时再以便携方式回装并逐文件核验。安装器隐藏目录选择页时会忽略`/GROUP`，因此不依赖该参数隔离，见[Inno命令行文档](https://jrsoftware.org/ishelp/topic_setupcmdline.htm)。此证据不等于旧版本已读取真实用户的新数据。

`node tools/qa/motion-master-analysis.mjs --run --input=<工作区内母片> --id=<新编号>` 检查本批固定机位素材的相邻帧与两个循环候选；候选时间范围专用于本次两态母片。输出包含原片哈希、帧时间、区域差异和候选画面，不能用数值替代视觉审核。默认仅帮助。
