# 质量验证入口

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
