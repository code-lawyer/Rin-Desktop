const TYPES = new Map([
  ['item/commandExecution/requestApproval', 'command'],
  ['item/fileChange/requestApproval', 'files'],
  ['item/permissions/requestApproval', 'permissions'],
  ['item/tool/requestUserInput', 'questions'],
]);

export function approvalView(request) {
  const kind = TYPES.get(request.method); if (!kind) return null;
  const p = request.params ?? {};
  return { id: String(request.id), kind, reason: p.reason ?? '', command: p.command ?? '', cwd: p.cwd ?? '',
    details: kind === 'permissions' ? JSON.stringify(p.permissions, null, 2) : kind === 'files' ? (p.grantRoot ?? 'Codex 请求文件修改权限') : kind === 'command' && p.networkApprovalContext ? JSON.stringify(p.networkApprovalContext, null, 2) : '',
    questions: kind === 'questions' ? (p.questions ?? []).map(q => ({ id: q.id, header: q.header, question: q.question, options: q.options ?? [], secret: !!q.isSecret })) : [] };
}

// No policy amendments. Extra permissions expire with the turn; file-root scope is displayed explicitly.
export function approvalResult(request, answer) {
  const kind = TYPES.get(request.method);
  if (kind === 'command' || kind === 'files') {
    if (!['accept', 'decline', 'cancel'].includes(answer?.decision)) throw new Error('请选择允许、拒绝或停止。');
    return { decision: answer.decision };
  }
  if (kind === 'permissions') {
    if (typeof answer?.allow !== 'boolean') throw new Error('请选择是否允许本次权限请求。');
    return { permissions: answer.allow ? structuredClone(request.params.permissions) : {}, scope: 'turn' };
  }
  if (kind === 'questions') {
    const answers = {};
    for (const question of request.params.questions ?? []) {
      const text = answer?.answers?.[question.id];
      if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw new Error('请填写每个问题的回答。');
      answers[question.id] = { answers: [text.trim()] };
    }
    return { answers };
  }
  throw new Error('不支持的交互请求。');
}
