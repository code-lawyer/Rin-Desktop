# Dreamina Canvas CLI 安装与授权验证

日期：2026-10-24。关联 ART-09。用户提供 Dreamina 官方安装命令，要求安装 CLI 与 Skill，并完成 CLI、登录及授权验证。本次不生成视频，不消耗生成积分。

## 安装与实际结果

- 使用用户提供的 Windows PowerShell 命令：`irm https://dreamina.capcut.com/canvas-cli/install.ps1 | iex`。执行前已读取安装脚本并检查目标目录；使用用户级安装，没有改为管理员安装。
- 安装版本为 **1.1.1**，commit `a5ca7c8`，public/global 发行版。可执行文件位于用户个人 `bin` 目录，Skill 位于个人 `.agents/skills/dreamina-canvas-cli`；用户 PATH 已加入安装目录。
- 已读取安装后的 `SKILL.md` 与认证说明，并实际执行 `version` 和 `schema`，两项成功。后续命令、模式及参数以这个安装版本的 schema 和实时模型目录为准。
- 用户在官方页面完成登录和授权；同一登录流程的等待结果为 `logged_in`，凭据由 CLI 保存到系统 `keyring`。没有导出、迁移或写入仓库。
- 在具备网络和系统凭据访问权限的执行环境中，`auth status`、服务端 `auth account` 与 `model list --type video` 均成功。目录返回 Seedance 2.0、Seedance 2.0 Mini、Seedance 2.5；目录可读不等同于会员资格、积分额度或生成授权通过。

没有创建云端画布、上传图片、提交生成任务或改变主应用。三张参考图及六条提示词继续使用[三状态素材包](three-state-video-kit-2026-10-24.md)。下一阶段先核查实时首尾帧能力、画幅、分辨率和报价，再按实际授权推进工作与用户之间的往返试片。

## 本机后续验证方式

当前已完成登录，无需重新运行 `auth login`。新终端加载用户 PATH 后可直接使用 `dreamina-canvas`；尚未刷新环境的终端或 Agent 使用完整路径：

```powershell
$dreaminaCli = Join-Path $env:USERPROFILE 'bin\dreamina-canvas.exe'
& $dreaminaCli --format json version
& $dreaminaCli --format json --profile default auth status
& $dreaminaCli --format json --profile default auth account
```

本次发现：受限 Agent 沙箱读取系统凭据时会返回 `credential_store_permission_denied`；通过宿主正常授权的执行环境读取同一 profile 则成功。这是访问权限边界，不是登录丢失。后续遇到这一错误，应申请该命令所需的凭据/网络访问，不重复登录、不清空凭据、不把凭据转存到工作区，也不全局关闭沙箱。

安装和登录验证不代表三状态视频已经生成，亦不代替后续接缝、美术、原功能或设备验收。本文不保存账户标识、授权码、认证链接、凭据或账户余额。
