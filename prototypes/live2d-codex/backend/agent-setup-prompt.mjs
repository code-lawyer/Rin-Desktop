// The settings screen supplies the active data location; public documentation
// uses a placeholder. Never include credentials or existing command arguments.
export function agentSetupPrompt({ file, name = '' }) {
  const target = String(name).trim().slice(0, 80);
  return `请帮我把${target ? '这个 Agent' : '我正在使用的这个 Agent'}接入 Windows 上的 Rin Desktop，完成本机检查、配置和连接验证。
${target ? '目标 Agent 名称：' + JSON.stringify(target) : '如果无法确定我指的是哪个 Agent，只需先问我它的产品或客户端名称。'}
Rin 当前实际读取的配置文件：${JSON.stringify(file || '请从 Rin“壁纸与设置 → Agent → 配置位置”获取实际路径，不要猜测稳定版或测试版的数据目录。')}

请按下面的约定执行：
1. 检查本机已有安装和目标 Agent 的官方文档，确认它能提供 ACP v1（Agent Client Protocol）stdio 接口及正确的启动参数。程序必须是 Windows 可执行文件的绝对路径（.exe）；脚本适配器可以用 node.exe 等解释器启动，脚本路径也用绝对路径。不要把 MCP 服务或普通 HTTP API 当作 ACP 接口。
2. 配置格式为 {"format":1,"agents":[{"id":"custom-my-agent","name":"显示名称","protocol":"acp","command":"可执行文件绝对路径","args":["逐项启动参数"]}]}。示例 ID 请替换为实际的唯一标识；id 在 custom- 后只能有 1–48 个小写字母、数字或连字符，首字符不能为连字符；已有接入保留原 ID，新 Agent 使用新 ID。args 可为空数组，不使用 shell 拼接命令。只有确实需要且对端声明了认证方法时才添加 authMethodId。
3. 写入前用独占创建（Node fs.open 的 wx，或等价 CreateNew）取得“配置文件完整路径 + .lock”的锁；已有锁则等待或报告占用，不删除别人的锁。持锁后读取最新文件并备份，再只合并这一个 Agent，保留其他配置、会话、草稿和发送记录。用同目录临时文件写完并刷新后原子替换配置，在 finally 中关闭并删除自己取得的锁。若发现不遵守锁协议的外部修改，重新读取后合并；文件损坏时保留原件再修复。异常退出的遗留锁只有确认所有写入程序已停止后才清理。不要把 API Key、令牌或密码写入配置、启动参数或回复，认证沿用原生 CLI 或本机环境。
4. 使用独立临时连接检查 initialize 的协议版本和能力、创建会话，并在结束后关闭测试进程。Rin 不提供 ACP 的文件读写、终端执行或交互登录终端服务；对端须能自行执行这些操作。不要为验证连接发送模型任务、改动项目文件或声称已验证模型回复。登录需要我操作时，明确给出下一步；不支持 ACP 且没有可用桥接时，如实说明缺少什么。
5. 完成后告诉我接入名称和验证结果，然后让我回到 Rin“壁纸与设置 → Agent”点击“重新读取”，再点击该 Agent 的“连接”。当前 Agent 的启动配置改动后，需重新连接才会使用新配置。

如果你无法访问本机文件，请给出能够直接填入 Rin 设置界面的名称、程序绝对路径、逐项启动参数和可选认证方法，不要求我手动编辑 JSON。`;
}
