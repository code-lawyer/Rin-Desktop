# 继续开发 Rin Desktop

从[开发手册](docs/development/README.md)开始。任务与进度以 `docs/development/backlog.json` 为准；生成的[施工清单](docs/development/progress.md)包含责任角色、前置任务、代码位置、验收和下一动作。

1. 先查看工作区状态，保留他人/先前未提交改动；选择一个任务 ID，检查依赖和已知限制。
2. 在台账中标为施工中，记录实际责任人时使用真实信息；没有开工的事项保持待施工。
3. 修改对应模块，针对行为与失败路径验证。不要在普通自动测试里调用真实账户、设备或模型。
4. 更新受影响的目标、架构、数据、决策或发布说明；验收结果按[模板](docs/development/templates/verification.md)记录。
5. 更新台账证据并运行 `npm run project:docs`；通过 `npm run check:project`、`npm test`、`npm run build`、`npm run check:public`。
6. 对实际暂存文件执行 index 审计并检查 diff，再按[原仓库同步流程](docs/development/data-and-release.md)提交。源代码同步和应用 Release 分别记录。

`npm run qa:known-issues` 是当前三个问题的合成复现。它返回 1 表示还有已知缺陷，不能通过忽略输出把任务标为完成。对应修复应加入正式回归测试。

源码默认用户数据位置、既有模型、私人 Dots 和 Qwen 旧环境需要保留。移动文件先查引用与忽略/打包规则，确定目标未占用并保存备份；不为整理目录修改业务语义或重建 Git 历史。
