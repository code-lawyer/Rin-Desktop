# 从源码构建

Windows x64，Node.js 24 或更高，npm，Inno Setup 6.7.3。安装器构建使用官方 Inno Setup 编译器；通过 `INNO_ISCC` 指定 `ISCC.exe` 的绝对路径。

```powershell
npm ci
npm --prefix prototypes/live2d-codex ci
npm test
npm run build
```

单元测试和前端构建不需要语音模型。原生程序需要用户自行安装的 Windows Codex CLI。应用的 Node 运行时、壁纸与 Cubism Core 从锁定的基础安装包获取，大文件不放进 Git 历史。

```powershell
npm run resources
```

这条命令按 `tools/release/resource-manifest.json` 下载基础安装包，校验 SHA-256 后以不注册安装项的方式解包到 `work/release-resources/版本号`。不下载语音模型或 CLI。源码树缺失的资源目录会连接到解包目录，已有目录不覆盖。请先阅读第三方许可。

```powershell
$env:VIBE_RESOURCE_APP = (Resolve-Path 'work/release-resources/0.3.0/resources/app').Path
$env:INNO_ISCC = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
npm run package
```

打包始终写入新的版本目录，已有目录会被拒绝。输出独立基础安装器和锁定哈希清单，不将模型或 CLI 加入应用。运行源码可执行 `npm --prefix prototypes/live2d-codex start`；语音仍在应用内按需下载。

语音资源清单为 `prototypes/live2d-codex/voice-resources.json`。重建资源包时，可通过 `VIBE_ASR_RESOURCES`、`VIBE_KOKORO_RESOURCES`、`VIBE_QWEN_RESOURCES` 指向已解包的对应组件目录（前两个指向含模型文件的内层目录），运行 `node tools/release/build-voice-packs.mjs`，再重建基础包，使锁定哈希一致。Qwen Python 以相对目录找到标准库和依赖；`prepare-qwen.mjs` 只是维护者创建新独立环境的辅助工具，不是用户安装前提。

发布前运行源码扫描、单元测试、原生界面测试、独立目录安装与卸载测试。核对许可和对应源码包；每个 Release 资产必须小于 GitHub 的单文件限制。请勿使用 `git add .` 代替公开文件清单审计。
