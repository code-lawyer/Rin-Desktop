# 测试、验收与证据规范

## 自动检查入口

在项目根目录执行：

```powershell
npm run check:project
npm test
npm run build
npm run check:public
```

`check:project` 校验施工台账、依赖、历史编号、文件引用、文档链接和生成页。`npm test` 运行桌面与根目录 Node 测试；本机包含 7 项私人 Dots 测试，公共 checkout 的计数以实际输出为准。构建和这些测试不要求模型、真实 CLI 账户或 RC003。

`npm run check:public` 检查当前已跟踪和未忽略文件的内容；提交前另用 `node tools/release/audit-public.mjs --staged` 检查 index。两者不证明所有漏洞都不存在，但可阻止既知私人路径、大文件和密钥模式进入公共源文件。

## 专项命令与副作用

| 命令/入口 | 作用 | 是否需要真实环境 |
| --- | --- | --- |
| `npm start -- --check` | 只读源码启动条件 | Windows、已准备的 Electron/视觉资源；不开应用 |
| `npm run status` | Git 与源码/资源关系 | 本地 Git；不联网刷新 |
| `npm run qa:known-issues` | 三处已知缺陷的合成复现 | 无真实 Agent/模型/GUI；退出 1 表示仍有问题 |
| `npm run qa:data-agent` | 数据写入/迁移/恢复与各家协议矩阵 | 无真实账户/Agent CLI/设备；Windows junction 需允许临时目录联接 |
| `npm run qa:shutdown -- --run` | 生产preload的退出草稿握手、失败取消、恢复及磁盘读回 | 隐藏隔离Electron、真实存储、合成Agent状态；无账户/硬件 |
| `npm run qa:inventory -- --run` | 只读目录占用和文件元数据，不跟随链接或删除 | 本地工作区；不读取文件正文 |
| `npm run data:recover -- --source="<源>" --out="<新目录>"` | 验证并预览工作台恢复副本 | 默认不写；`--run` 复制到新目录，先关闭使用该数据的应用 |
| `npm run qa:remote-component` | RC003 Windows 组件编译/管道/退出及输入 API 绑定 | Windows；不注册输入、不发现设备、不配对、不录音 |
| `node --test tests/remote-buttons.test.mjs` | 设备按键归一化 | 无设备 |
| `work/runtime/rc003-probe/Scripts/python.exe tests/remote-atvv-test.py` | ATVV 解码逻辑 | 已准备的独立 Python；无设备、无采音 |
| `npm run remote:diagnose` | RC003 原始按键/音频诊断 | 真实设备、BLE 环境、已下载 ASR；会采集固定测试短语 |
| `node tools/qa/gui/run.mjs --case=character-switch --run` | 人物资源失败恢复与切换 | Playwright、视觉资源、真实 Electron；不发送 Agent 任务 |
| `tools/probes/cli-agents` 的 `--run` 命令 | SDK/ACP 账户与协议检查 | 原生 CLI、账户和额度；会发固定任务及执行受限 fixture 操作 |

准备方法分别见[构建](../build.md)、[设备诊断](../../tools/remote-diagnostics/README.md)、[CLI 探针](../../tools/probes/cli-agents/README.md)和[质量工具](../../tools/qa/README.md)。旧check工具已经分流为维护入口或归档说明，详见[GUI工具清单](../../tools/qa/gui/README.md)。默认帮助不会启动真实CLI/GUI；显式运行的报告均使用新的work/qa目录。归档原文仍可能包含真实任务或旧固定端口，不应批量运行。

## 验收层次

1. **静态与文档**：文件引用、台账、公开边界、锁文件、源码版本。
2. **单元/契约**：真实状态逻辑，替换受控协议或 worker；覆盖正常、取消、超时、旧事件、进程退出和失败清理。
3. **原生界面**：真实 Electron、独立数据目录，检查页面错误、渲染恢复、焦点与 DPI；合成回复不能算真实 Agent 成功。
4. **真实 CLI**：记录后端/CLI/SDK/模型及账户类型，逐项验创建、流式、审批拒绝、提问、中断、恢复、草稿隔离和朗读。
5. **真实硬件**：设备、适配器、固件、连接路径、录音、延迟、键盘共存、断线/睡眠、100 次矩阵。
6. **安装与回滚**：新的独立安装候选、文件哈希、旧数据导入、升级/卸载/回退；不使用日用数据目录做破坏性测试。

## 最低发布场景

| 场景 | 通过条件 | 任务 |
| --- | --- | --- |
| 语音载入失败、关闭过程中连接返回 | 不残留 loading、不复活后端、不产生未处理异常 | FIX-01/02 |
| 多段文本和工具回复 | 可见最终回复与播报条件一致，中断不播报 | FIX-03 |
| 回执丢失、断连、崩溃恢复 | 不重发、不静默换会话、保留草稿并能核查 | DATA-01 |
| 切换项目/后端时识别完成 | 原目标收到草稿，相同 ID/同名项目不混淆 | DATA-02、AGT-06 |
| 普通按键、遥控连发与审批 | 来源正确；同毫秒同扫描码的键盘与遥控并发、中文输入法及裸键快捷键共存；一次确认仅一次提交；普通确认不批准权限 | REM-02/04、UI-01 |
| 超长、静音、丢释放、睡眠重连 | 有上限和可理解提示；旧事件不重放 | REM-03/05 |
| CLI 缺失、登录失效、版本变化 | 明确报错/降级，不自动换计费来源或伪造能力 | AGT-02 至 AGT-05、DEC-01 |
| 安装、升级、卸载、回滚 | 项目/账户/草稿保留；只处理应用拥有的组件 | REL-01、REM-06 |

任何已知误投递、非预期重复提交、错误审批、凭据泄露或隐藏云识别回退都阻止相应版本发布。历史已发布版本的报告只证明当时范围；新源码必须形成自己的候选报告。

## 如何保存证据

使用[验收模板](templates/verification.md)。每项至少记录任务 ID、日期、源码 commit 与工作区是否有改动、版本/机器范围、步骤、预期、实际、结果、限制。失败和未测也记录。

原始运行文件写入 `work/qa/<模块>/<独立运行目录>`，硬件既有入口继续使用它声明的 `work/runtime` 目录。公共报告仅写脱敏摘要和可复现方法，不附私人会话 ID、设备标识、账号、真实需求正文、录音或本机绝对路径。台账中的公共 evidence.ref 指向仓库内可读摘要/测试，私人证据位置仅作为本机附加记录。
