# 验证工具

普通回归运行 `npm test`，不连接真实账户或硬件。下表标有 `--run` 的入口默认帮助，需要显式运行；其余验证命令会直接执行，数据恢复命令则默认只预览。输出统一写入新的 `work/qa` 子目录，不覆盖既有运行。先按 [构建说明](../../docs/build.md) 准备所需资源。

| 命令 | 范围与条件 |
| --- | --- |
| `npm run qa:inventory -- --run` | 只读文件元数据与目录占用，不跟随目录联接；不自动删除 |
| `npm run qa:known-issues` | 合成数据/协议复现已知业务边界 |
| `npm run qa:interface` | 隔离 Electron 界面与工作台，无账户或硬件 |
| `npm run qa:visual -- --run` | 隔离页面、布局、长内容、缩放与截图；页面缩放不代表系统 DPI |
| `npm run qa:shutdown -- --run` | 隔离桌面退出与子进程清理 |
| `npm run qa:stills -- --character-switch` | 生产 renderer/preload + 合成后端，验证失败重试、切换与重启恢复 |
| `npm run qa:motion -- --run` | 当前正式动态媒体播放；不等于实机长时间或美术验收 |
| `npm run qa:remote-component` | 编译 RC003 组件、管道与输入绑定加载，不扫描或连接设备 |
| `npm run qa:data-agent` | 立即执行合成协议与数据契约检查，创建报告目录 |
| `npm run data:recover -- --source="<副本>" --out="<新目录>"` | 默认预览，增加 `--run` 才复制恢复；拒绝覆盖 |

真实窗口操作入口见 [GUI 说明](gui/README.md)，真实 CLI 探针见 [探针说明](../probes/cli-agents/README.md)。硬件、模型、账户、安装与卸载须按 [验收清单](../release/TEST-ACCEPTANCE.md) 单独执行。普通测试、组件自检或截图均不能替代这些验收。

美术诊断、半身预览和媒体准备命令保留在根 package.json；运行前先读命令帮助，不把固定素材的裁剪或像素阈值当成通用规则。原始美术、模型、用户数据与私人 Dots 不属于可清理的测试缓存。旧安装测试副本可以在确认未运行且不被资源目录引用后清理。
