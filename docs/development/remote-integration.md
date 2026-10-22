# RC003 主应用接入

更新于 2026-10-22。本页描述 0.5.0 的 RC003 实验能力；0.4.0 安装包不包含这些新功能。REM-02/03/04、UI-01 的产品代码已接入；REM-05 的真实设备矩阵及 REM-06 的安装验收由后续实测补证据。新一轮操作与界面整理见[遥控草稿与语音操作](remote-controls-ui.md)。

## 用户流程

1. 启动当前源码，打开「工作台 → 壁纸与设置 → 遥控器」，或托盘菜单「连接与设置遥控器」。
2. 唤醒已配对的 RC003；首次使用先按设备说明进入配对状态。点击「搜索遥控器」，选择结果中的「连接」或「配对并连接」。需要系统确认时按 Windows 提示完成。
3. 连接成功后可以设置下次自动连接、断开或清除应用连接记录。连接过程中也可取消；更换设备时先断开再搜索。清除记录保留 Windows 配对，不删除草稿或其他设置。
4. 在「自定义按钮功能」直接选择要执行的操作，立即保存；不用学习键码或打开映射工具。主页默认呼出对话，菜单默认打开工作台。草稿框中确认发送、左键清空、右键朗读或撤销清空；其他控件保留方向导航和确认执行。
5. 在语音模型区域准备听写模型后，按住遥控器语音键说话，松开识别，文字进入按下时选中对话的草稿。检查后再发送；语音不会直接下发任务。电脑听写仍使用原有听写按钮。

上下键可移动到项目、会话、模型、发送及停止等可见控件；下拉列表和音量滑块用左右键选择。普通确认不会代替审批，审批区需先选择明确操作，再确认两次。语音键可选按住说话或停用；音量加减已增加 Consumer Control 接收与应用播报增益通路，真实物理键仍待验证。电源保留设备行为。初次配对、目录选择和复杂文本编辑允许键鼠。

## 实现边界

| 层 | 位置 | 职责 |
| --- | --- | --- |
| Windows 设备服务 | [rc003-helper.cs](../../prototypes/live2d-codex/native/rc003-helper.cs) | 隐藏进程；发现、系统配对、GATT 通知/写入、Raw Input；设备容器与 VID/PID 双重来源过滤 |
| 进程协议 | [remote-native.mjs](../../prototypes/live2d-codex/backend/remote-native.mjs) | 源码模式按内容哈希编译；有界 JSON 行协议、请求超时、自有进程退出 |
| 设备/录音状态 | [remote-controller.mjs](../../prototypes/live2d-codex/backend/remote-controller.mjs) | 单连接、代际、按下/松开去重、按住说话、取消、断线和休眠恢复 |
| 音频 | [remote-audio.mjs](../../prototypes/live2d-codex/backend/remote-audio.mjs) | ATVV 能力确认、16 kHz IMA ADPCM 解码、同步与 60 秒上限 |
| 按钮配置和输入共存 | [remote-config.mjs](../../prototypes/live2d-codex/backend/remote-config.mjs)、[remote-input.cjs](../../prototypes/live2d-codex/backend/remote-input.cjs) | 用户可读的按钮/功能目录；本进程 UI 线程依据 Raw Input 来源屏蔽遥控重复路径，普通键盘原始消息保持不变 |
| 设置及导航 | [remote-ui.mjs](../../prototypes/live2d-codex/renderer/remote-ui.mjs) | 连接状态、设备选择、按钮设置、焦点和显式审批 |
| 应用协调 | [main.cjs](../../prototypes/live2d-codex/main.cjs) | 受信 IPC、ASR、捕获目标互斥、持久草稿、休眠和退出 |

原生服务使用 Windows 的[配对 API](https://learn.microsoft.com/en-us/uwp/api/windows.devices.enumeration.deviceinformationpairing.pairasync)和[设备容器属性](https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/device-information-properties)。连接持有使用 [GattSession.MaintainConnection](https://learn.microsoft.com/en-us/uwp/api/windows.devices.bluetooth.genericattributeprofile.gattsession.maintainconnection)。设备服务把所选容器验证过的完整设备路径交给主进程；主进程自行读取 Raw Input 的来源，不跨进程比较句柄。

输入组件通过 Koffi 调用本进程 UI 线程限定的 [WH_GETMESSAGE](https://learn.microsoft.com/en-us/windows/win32/winmsg/getmsgproc)，在 Windows 翻译按键前识别重复路径。按消息时间、扫描码、扩展位、按下/松开以及同组事件顺序核对来源；普通键盘保留原始消息，包括输入法的 `VK_PROCESSKEY`。来源不明的候选键不会作为普通 Enter 放行，而是停止连接并提示重连。没有毫秒超时放行、普通按键重放、全局键盘钩子、驱动或常驻系统服务。断开时解除自有注册并恢复先前的应用输入注册。

若旧全局快捷键包含 RC003 使用的按键，连接期间暂停这些冲突绑定并在快捷键状态显示原因，断开后恢复；包括裸 Enter/F5 及 Ctrl+Alt+Enter 等组合，避免电脑修饰键和遥控键一起触发另一条功能。其他快捷键及应用内普通键盘输入继续保留。其他应用在前台时仍可能收到遥控器原有系统按键，本组件不拦截其他进程。Windows 不承诺所有设备/输入法的消息序列都相同，必须实测同毫秒多设备、中文输入法和热插拔；离线测试仅验证上述处理逻辑。

录音在主进程持有 `{provider,cwd,threadId}`，开始听写后禁止切换目标或发送。数据经自有管道进入内存解码，交给现有 SenseVoice，不默认写 WAV、不新增云识别。5 秒无音频、无有效声音、超时、错误包、断线和主动取消均结束本次采集；旧代际和取消后的识别结果不能回填。识别先保存原目标草稿，再通知界面合并未保存的键入内容。每次听写有独立 ID，草稿保留最近 32 个已应用 ID，窗口重新读取时据此去重，不因用户输入了相同文字而丢掉一次有效听写。收到新会话或其他 provider 的事件不会写入当前输入框。未知任务提交及一般磁盘故障仍属于 DATA-01/02 的独立验收范围。

配置保存在已有 `workspaces.json` 的 `settings.rc003`，包含本机设备记录、自动连接与按钮功能，不改原格式版本，不搬迁项目或草稿。原 `remoteEnabled/remoteKeys` 保留在「兼容其他按键设备」折叠区。设备标识仅在本机配置和私有 IPC 中使用，不进入公开报告。

## 构建与后续维护

源码模式首次使用设备功能时，用 Windows 自带的 .NET Framework 编译器和 WinMetadata 准备辅助程序，按源码哈希缓存到应用数据目录。无需安装 Python、bleak 或 Windows SDK。安装包构建调用同一编译函数，把成品放在应用 `runtime/rc003-helper.exe`；安装用户不需要在本机编译。输入层使用锁定的 Koffi 3.3.3 及其 Windows x64 预编译包，npm 安装及打包脚本一并带入，保留 MIT 许可证。打包在独立目录加载这些依赖并执行组件自检，缺少组件或原生依赖时停止。

旧 `tools/remote-diagnostics` 保留为显式硬件诊断，不在用户启动链中。维护代码必须放在应用目录；不要把诊断窗口、固定测试短语、私人设备 ID 或现场录音打入产品。

```powershell
npm test
npm run build
npm run qa:remote-component
npm run check:project
npm run check:public
```

`qa:remote-component` 只编译、握手、关闭自有进程和加载 Windows API 绑定，并在独立目录复制发布依赖、以 Electron 的 Node 模式检查原生模块加载。不注册输入、不发现设备、不配对、不录音。输出位于忽略的 `work/qa/remote-component`。逻辑回归见 [remote-integration.test.mjs](../../prototypes/live2d-codex/tests/remote-integration.test.mjs)，覆盖配置、按键重复、能力与解码、录音到草稿、取消/断线晚到结果、双释放和输入来源处理；[界面回归](../../prototypes/live2d-codex/tests/remote-ui.test.mjs)另检查连接取消和审批二次确认。

## 本轮复核与证据

2026-10-21 使用施工前源码快照作边界，沿代码质量和用户需求两条线复核。已修复连接取消后复活、扫描占住麦克风命令队列、扫描名称延迟更新遗漏、同文听写误去重、电脑听写快捷键干扰遥控状态，以及按键时间窗、注入事件、冲突全局快捷键和组件清理问题。两条线已报告的问题均已关闭；未将模拟结果写成硬件通过。

初次接入时的 `npm test`、前端构建、`check:project` 和 `check:public` 均通过。Windows 辅助程序编译、管道握手、退出，以及复制后的 Koffi 依赖在 Electron 44.7.2 的加载检查通过。新增组件和现有 Agent 运行时依赖在同一打包链收集，现有 GitHub origin、HEAD 和用户数据目录保持原关系；当时尚未提交或发布；后续 0.5.0 的同步与验证见[发布审查](../release-audit.md)。

本轮完成离线回归、前端构建和 Windows 组件编译/管道握手；未运行真实设备和真实 Agent 任务。硬件验收至少记录首次配对、重启自动连接、按钮自定义、语音录入、断线/休眠、普通键盘与其他应用共存、不同固件及独立安装退出。按 REM-05/06 原门槛更新台账，不能用模拟测试填成真实验收通过。

## 已连接但无法听写：测试反馈与修正

2026-10-21，用户在内部测试版反馈「遥控器已连接但语音听写不可用，录音设备仍显示电脑麦克风」。这是一次未通过的主应用硬件反馈；此前独立诊断器的成功不能覆盖这次失败。原测试版日志没有分阶段收音记录，因此尚不能确认这次现场失败发生在按键、蓝牙音频还是识别阶段。

产品有两条独立输入路径，共用本地 SenseVoice 和捕获目标保护：

- 遥控器语音键 → 所选 RC003 的按键/ATVV 控制通知 → 打开遥控器麦克风 → BLE 音频 → 内存解码 → 本地识别 → 原对话草稿。
- 「电脑听写」按钮/电脑快捷键 → 所选系统麦克风 → 本地识别 → 原对话草稿。

RC003 没有被本应用注册成 Windows 录音端点，所以不应向 `enumerateDevices()` 的列表插入一个不能被 `getUserMedia()` 使用的假设备。遥控器通过专用通道收音，不需要用户更换电脑麦克风。工作台现在明确标注「电脑麦克风」，另外显示遥控器麦克风状态；气泡按钮明确为「电脑听写」，连接后显示遥控器按住说话提示。

沿真实模块边界新增失败用例后修正了以下问题：

1. 原来 F5 按下只更新按钮名称，不触发收音，完全依赖另一条 ATVV 请求通知。现在设备来源已确认的语音键与 ATVV 请求均可启动同一采集；连发、双通道重复、停用和取消后迟到请求仍受同一会话去重与松手保护约束。
2. 原来收到流开始确认就显示「正在聆听」，没有音频也会短暂显示「正在识别」。现在分别显示打开麦克风、等待声音、确实收到声音及其时长、结束收音、本地识别；空音频不进入识别阶段。
3. 开始遥控器听写会停止播报，原来的停止播报处理会清掉刚出现的麦克风提示。现在保留正在进行的遥控器听写状态和取消入口。

本机启动日志新增 `[companion:remote]`，只记录连接阶段、按键是否就绪、采集触发途径、音频帧数/时长/峰值及结果状态。不记录音频正文、转写文字、设备地址或普通键盘输入；记录帧统计不等于语义识别通过。工作台和气泡共用 [remote-voice-status.mjs](../../prototypes/live2d-codex/renderer/remote-voice-status.mjs) 解释状态。模型正在准备、已有听写和应用切换分别给出具体提示。

离线证据：`npm test` 的 233 项应用测试和 55 项根目录测试通过。新用例覆盖物理语音键启动、双通道去重、空音频阶段、取消/停用保护和停止播报不清除录音提示。测试包附带 `Run-Remote-Checks.cmd`，仅运行这部分模拟回归，不连接设备或打开麦克风。

下一次实机检查：连接后按住语音键 3–5 秒，确认出现「已收到 … 秒声音」，松开后确认进入识别并写入草稿；在同一次连接中再录一次。若失败，记录最后显示的阶段和提示，并结合本机阶段日志定位。方向键/输入法共存、连续录音、重连/休眠及安装矩阵仍未通过；REM-05 保持施工中，REM-02/03/04 保持已实现待验收。
