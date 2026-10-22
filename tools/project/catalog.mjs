import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

export const root = resolve(import.meta.dirname, '../..');
export const statuses = { verified: '已验证限定范围', implemented: '已实现待验收', in_progress: '施工中', planned: '待施工', deferred: '后置' };
export const dispositions = { covered: '已有覆盖', partial: '部分覆盖', pending: '待落实', superseded: '路线已替代', deferred: '后置' };
export function readCatalog(directory = root) {
  const read = name => JSON.parse(readFileSync(resolve(directory, 'docs/development', name), 'utf8'));
  return { ledger: read('backlog.json'), legacy: read('legacy-mapping.json') };
}

export function validateCatalog({ ledger, legacy }) {
  const problems = [], ids = new Set(), visiting = new Set(), visited = new Set();
  if (ledger.schemaVersion !== 1 || legacy.schemaVersion !== 1) problems.push('Unsupported catalog schema');
  for (const task of ledger.tasks) {
    if (!/^[A-Z]+-\d{2}$/.test(task.id) || ids.has(task.id)) problems.push(`Invalid or duplicate task: ${task.id}`);
    ids.add(task.id);
    if (!Object.hasOwn(statuses, task.status)) problems.push(`${task.id}: unknown status`);
    if (!ledger.phases.includes(task.phase)) problems.push(`${task.id}: unknown phase`);
    if (!['P1', 'P2', 'P3'].includes(task.priority)) problems.push(`${task.id}: unknown priority`);
    for (const key of ['title', 'owner', 'nextAction']) if (typeof task[key] !== 'string' || !task[key].trim()) problems.push(`${task.id}: missing ${key}`);
    for (const key of ['paths', 'acceptance']) if (!Array.isArray(task[key]) || !task[key].length) problems.push(`${task.id}: missing ${key}`);
    if (task.status === 'verified' && !task.evidence?.length) problems.push(`${task.id}: verified without evidence`);
    for (const item of task.evidence ?? []) if (!item.ref || !item.summary || !item.kind) problems.push(`${task.id}: incomplete evidence`);
  }
  const byId = new Map(ledger.tasks.map(task => [task.id, task]));
  function visit(id) {
    if (visiting.has(id)) { problems.push(`Dependency cycle at ${id}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (!ids.has(dependency)) problems.push(`${id}: missing dependency ${dependency}`);
      else { if (byId.get(id).status === 'verified' && byId.get(dependency).status !== 'verified') problems.push(`${id}: verified before dependency ${dependency}`); visit(dependency); }
    }
    visiting.delete(id); visited.add(id);
  }
  for (const id of ids) visit(id);
  const oldIds = new Set();
  for (const record of legacy.records) {
    if (oldIds.has(record.legacyId)) problems.push(`Duplicate legacy item ${record.legacyId}`);
    oldIds.add(record.legacyId);
    if (!Object.hasOwn(dispositions, record.disposition) || !record.reason || !record.title) problems.push(`${record.legacyId}: incomplete reconciliation`);
    if (!record.taskIds?.length) problems.push(`${record.legacyId}: no current task`);
    for (const id of record.taskIds ?? []) if (!ids.has(id)) problems.push(`${record.legacyId}: missing current task ${id}`);
  }
  const expectedIds = new Set();
  for (const [prefix, count] of Object.entries(legacy.expected)) for (let n = 1; n <= count; n++) expectedIds.add(`${prefix}-${String(n).padStart(2, '0')}`);
  for (const id of expectedIds) if (!oldIds.has(id)) problems.push(`Unmapped legacy item ${id}`);
  for (const id of oldIds) if (!expectedIds.has(id)) problems.push(`Unexpected legacy item ${id}`);
  return problems;
}

const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const link = path => `[${path}](${relative(resolve(root, 'docs/development'), resolve(root, path)).replaceAll('\\', '/')})`;
export function readyTasks(ledger) {
  const verified = new Set(ledger.tasks.filter(task => task.status === 'verified').map(task => task.id));
  return ledger.tasks.filter(task => task.status === 'planned' && task.dependsOn.every(id => verified.has(id)))
    .sort((left, right) => left.priority.localeCompare(right.priority));
}
export function renderProgress({ ledger, legacy }) {
  const counts = Object.fromEntries(Object.keys(statuses).map(status => [status, ledger.tasks.filter(task => task.status === status).length]));
  const active = ledger.tasks.filter(task => task.status === 'in_progress').map(task => task.id).join('、') || '无';
  const ready = readyTasks(ledger).map(task => task.id).join('、') || '无，先完成前置验收或更新台账';
  const rows = ledger.tasks.map(task => `| ${task.id} | ${cell(task.title)} | ${statuses[task.status]} | ${task.priority} | ${task.dependsOn.join('、') || '无'} | ${task.owner} |`);
  const detail = ledger.tasks.map(task => {
    const old = legacy.records.filter(item => item.taskIds.includes(task.id)).map(item => item.legacyId).join('、');
    return `## ${task.id} ${task.title}\n\n状态：${statuses[task.status]}；阶段：${task.phase}；责任角色：${task.owner}。\n\n实现位置：${task.paths.map(link).join('、')}。\n\n依赖：${task.dependsOn.join('、') || '无'}。原编号：${old || '新增工作'}。\n\n验收条件：\n\n${task.acceptance.map(value => '- ' + value).join('\n')}\n\n下一动作：${task.nextAction}\n\n证据：${task.evidence.length ? task.evidence.map(item => `${link(item.ref)} — ${item.summary}（${item.kind}）`).join('；') : '尚无完成验收记录，不能标为完成。'}\n`;
  });
  return `# 开发进度与统一施工清单\n\n由 backlog.json 与 legacy-mapping.json 生成，更新日期 ${ledger.updatedAt}。修改 JSON 后运行 \`npm run project:docs\`；不要直接编辑本页。\n\n${Object.entries(counts).map(([key, value]) => `${statuses[key]} ${value} 项`).join('；')}。这些数量不是产品完成百分比；已验证项仅对任务写明的范围有效。\n\n施工中：${active}。\n\n可开始的待施工项（前置已验收，按优先级排列）：${ready}。阶段顺序和源码同步安排见[开发计划](roadmap.md)。\n\n| ID | 工作 | 状态 | 优先级 | 前置任务 | 责任角色 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n${detail.join('\n')}`;
}

export function renderLegacy({ legacy }) {
  return `# 历史事项逐条归并\n\n由 legacy-mapping.json 生成，日期 ${legacy.updatedAt}。共 ${legacy.records.length} 项；覆盖旧目标 G、需求 R、工作包 B、测试 T、验证门槛 S、决策 D 和风险 K。\n\n本页保留原事项摘要、当前去向和差异说明，可独立阅读。历史全文属于本地档案，不是公共开发的前置依赖。已有覆盖仅指表中限定范围，不将源码存在折算成旧验收全部通过。\n\n| 原编号 | 原事项 | 处置 | 当前任务 | 判断与差异 |\n| --- | --- | --- | --- | --- |\n${legacy.records.map(item => `| ${item.legacyId} | ${cell(item.title)} | ${dispositions[item.disposition]} | ${item.taskIds.join('、')} | ${cell(item.reason)} |`).join('\n')}\n`;
}

export function generatedDocuments(data) {
  return new Map([['docs/development/progress.md', renderProgress(data)], ['docs/development/legacy-reconciliation.md', renderLegacy(data)]]);
}
