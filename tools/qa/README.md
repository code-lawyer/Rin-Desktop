# 验证工具

普通回归运行 `npm test`，不连接真实账户或硬件。下表标有 `--run` 的入口默认帮助，需要显式运行；其余验证命令会直接执行，数据恢复命令则默认只预览。输出统一写入新的 `work/qa` 子目录，不覆盖既有运行。先按 [构建说明](../../docs/build.md) 准备所需资源。视觉检查同时验证紧凑审批中的操作与目录可见性、前文展开和恢复；扩展模式还检查窄工作台的导航开关、焦点恢复和宽窗口恢复。

| 命令 | 范围与条件 |
| --- | --- |
| `npm run qa:inventory -- --run` | 只读文件元数据与目录占用，不跟随目录联接；不自动删除 |
| `npm run qa:known-issues` | 合成数据/协议复现已知业务边界 |
| `npm run qa:interface` | 隔离 Electron 界面与工作台，无账户或硬件 |
| `npm run qa:puppet-package -- --run --package="<测试包目录>"` | 实际包的主进程、设置 IPC、自定义 Agent 添加/编辑/重连/删除与数据保留；启动本地合成 ACP 子进程，随后检查壁纸切换、退出及重启恢复。不连接真实账户或硬件，不改系统剪贴板 |
| `npm run qa:visual -- --run [--extended]` | 隔离页面、布局、长内容、缩放与完整姿态截图；扩展模式增加最小窗口的 125%–200% 页面缩放、控件可达性与 Chromium 无障碍名称检查。页面缩放不代表系统 DPI，无障碍树检查不代替读屏实测 |
| `npm run qa:shutdown -- --run` | 隔离桌面退出与子进程清理 |
| `npm run qa:stills -- --character-switch` | 生产 renderer/preload + 合成后端，验证失败重试、切换与重启恢复 |
| `npm run qa:motion -- --run` | 当前正式动态媒体播放；不等于实机长时间或美术验收 |
| `npm run qa:remote-component` | 编译 RC003 组件、管道与输入绑定加载，不扫描或连接设备 |
| `npm run qa:data-agent` | 立即执行合成协议与数据契约检查，创建报告目录 |
| `npm run qa:installer -- -Run -Setup "<测试 Setup>" -PreviousSetup "<旧测试 Setup>" -Lifecycle` | 标准用户下提取、注册、升级、卸载；仅当同 AppId/快捷方式不存在时运行注册检查。安装目录在本次 QA 输出内，不启动账户或硬件 |
| `npm run qa:upgrade-data -- --run --setup="<测试 Setup>" --previous-setup="<旧正式 Setup>" --source="<已关闭的真实数据副本>"` | 在隔离路径实际运行旧包、升级包和回退包，核对项目、会话入口、设置及草稿；运行副本关闭模型、遥控器和环境音 |
| `npm run qa:data-copy -- --run --package="<测试包目录>" --source="<已关闭的应用数据>"` | 完整副本逐文件哈希、数据目录验证、损坏副本恢复与包内工作台启动；源应用必须完全退出。原目录不写入，运行副本禁用 RC003 自动连接 |
| `npm run qa:release-soak -- --run --package="<测试包目录>" --seconds=1800` | 实际包连续渲染，切姿态/风格、暂停恢复、WebGL 和堆内存检查；隐藏窗口不等于桌面挂载、系统 DPI 或整夜稳定性 |
| `npm run qa:agent-desktop -- --run --package="<测试包目录>" --provider=codex --turns=20` | 使用现有真实认证完成固定任务、流式中断、历史与重启草稿恢复；provider 可选 grok。会产生模型用量和原生 CLI 测试会话 |
| `npm run qa:agent-interactions -- --run --package="<测试包目录>" --provider=codex` | 真实 UI 审批、问题卡、仅本测试拥有的 CLI 断线与重连、未确认记录恢复；问题工具能否触发取决于原生 CLI/模式。未确认记录为明确标注的故障注入，不宣称观察到真实丢回执 |
| `npm run qa:local-speech -- --run --package="<测试包目录>" --models="<已有模型目录>"` | 包内 CPU 语音依赖真实合成和识别固定语句，不录音、不播放、不下载。可加 `--qwen-port=<调试端口>` 使用空闲应用中已就绪的 Qwen，并等待该请求结束；不改变设置或全局停止用户任务 |
| `npm run qa:prerequisites -- --run --package="<测试包目录>"` | 缺 CLI/模型、仅本机代理故障下的下载取消/失败、WebGL 上下文丢失/重试失败；可加 `--qwen-root="<已有运行环境>"` 隐藏该子进程的 CUDA。属于故障注入，不代替无 GPU 新机器验收 |
| `npm run data:recover -- --source="<副本>" --out="<新目录>"` | 默认预览，增加 `--run` 才复制恢复；拒绝覆盖 |

真实窗口操作入口见 [GUI 说明](gui/README.md)，真实 CLI 探针见 [探针说明](../probes/cli-agents/README.md)。硬件、模型、账户、安装与卸载须按 [验收清单](../release/TEST-ACCEPTANCE.md) 单独执行。普通测试、组件自检或截图均不能替代这些验收。

包内 QA 为每次启动分配独立数据目录和调试端口；退出按 PID、创建时间与父子关系核对该应用拥有的进程，超时只清理这棵进程树。原始数据副本和推理诊断可能含私人信息，只保留在忽略的 `work/qa`，不要作为公开发布附件。

美术诊断、半身预览和媒体准备命令保留在根 package.json；运行前先读命令帮助，不把固定素材的裁剪或像素阈值当成通用规则。原始美术、模型、用户数据与私人 Dots 不属于可清理的测试缓存。旧安装测试副本可以在确认未运行且不被资源目录引用后清理。
