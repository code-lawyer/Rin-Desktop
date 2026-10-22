import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { draftKey } from './workspace-store.mjs';

export const unresolvedSubmission = record => ['pending', 'unknown'].includes(record?.status);
const fingerprint = rows => createHash('sha256').update(JSON.stringify(rows.map(row => row.text))).digest('hex');
export function submissionBaseline(rows) {
  return Array.isArray(rows) ? { count: rows.length, digest: fingerprint(rows), ids: rows.map(row => row.id ?? null) } : null;
}
export function matchesSubmission(record, rows) {
  if (!Array.isArray(rows)) return false;
  if (record.userMessageId && rows.some(row => row.id === record.userMessageId && row.text === record.text.trim())) return true;
  const baseline = record.baseline;
  // Absence is never proof of rejection. Only an unchanged full prefix plus
  // one matching new user message can reconcile a lost acknowledgement.
  return !!baseline && rows.length === baseline.count + 1 &&
    fingerprint(rows.slice(0, baseline.count)) === baseline.digest &&
    rows.at(-1).text === record.text.trim() &&
    baseline.ids.every((id, i) => !id || !rows[i].id || rows[i].id === id);
}

// Own the durable receipt separately from process lifetime and display caches.
// No method in this class resends a request during recovery.
export class SubmissionGuard extends EventEmitter {
  constructor(store) { super(); this.store = store; this.active = new Set(); this.bindings = new WeakSet(); this.errors = new Map(); }
  snapshot(provider) {
    const record = this.store.data.submissions?.[provider];
    return record ? { ...structuredClone(record), error: this.errors.get(provider) || null } : null;
  }
  publish(provider) { this.emit('state', { provider, submission: this.snapshot(provider) }); }
  bind(backend, provider) {
    if (this.bindings.has(backend)) return;
    this.bindings.add(backend);
    backend.on('submission', event => {
      this.update(provider, event.id, event).catch(error => {
        this.errors.set(provider, `发送记录未保存，原稿仍保留：${error.message}`); this.publish(provider);
      });
    });
  }
  async update(provider, id, patch) {
    await this.store.transaction(data => {
      const record = data.submissions?.[provider];
      if (record?.id !== id || !unresolvedSubmission(record)) return;
      const { status, target, userMessageId, baseline, checkedAt, checkMessage } = patch;
      if (target) record.target = { ...record.target, ...target, provider };
      Object.assign(record, Object.fromEntries(Object.entries({ status, userMessageId, baseline, checkedAt, checkMessage }).filter(([,value]) => value !== undefined)));
      if (status === 'confirmed') {
        // Never delete later edits, another project's draft, or an alias copy
        // containing extra text. The journal itself retains the submitted text.
        for (const destination of [record.originalTarget, record.target]) {
          const key = draftKey(destination);
          if (data.drafts[key]?.text.trim() === record.text.trim()) delete data.drafts[key];
        }
      }
      if (status === 'released') {
        const current = data.drafts[draftKey(record.target)]?.text ?? '';
        this.store.setDraft(data, record.target, !current || current.trim() === record.text.trim() ? record.text : record.text + '\n\n' + current);
      }
    });
    this.errors.delete(provider); this.publish(provider);
  }
  async send(backend, provider, text, expected) {
    if (this.active.has(provider) || unresolvedSubmission(this.snapshot(provider))) throw new Error('上次发送结果尚未确定，请先核查；原稿已保留。');
    if (backend.busy || backend.closed || backend.state.connection !== 'ready' || backend.state.status === 'error') throw new Error('Agent 尚未就绪，请先完成任务或恢复连接。');
    if (typeof text !== 'string' || !text.trim() || text.length > 64000) throw new Error('请输入 1 至 64000 个字符的任务。');
    const id = randomUUID(), target = { provider, cwd: backend.state.cwd, threadId: backend.state.threadId ?? null };
    if (expected && draftKey(expected) !== draftKey(target)) throw new Error('项目或会话已切换，草稿未发送。');
    this.active.add(provider); this.bind(backend, provider);
    let dispatched = false;
    try {
      await this.store.add(target.cwd);
      await this.store.transaction(data => {
        data.submissions ??= {};
        // Save before invoking any Agent code, even if the renderer has not
        // delivered its debounced draft write yet.
        this.store.setDraft(data, target, text);
        data.submissions[provider] = { id, status: 'pending', text, target, originalTarget: target, createdAt: Date.now() };
      });
      this.publish(provider);
      const result = await backend.send(text, { id, beforeDispatch: async details => {
        let baseline = null;
        try { baseline = submissionBaseline(await backend.readSubmissionHistory?.(details)); } catch { /* Retain unknown if this CLI cannot supply authoritative history. */ }
        await this.update(provider, id, { target: details, userMessageId: details.userMessageId, baseline });
        dispatched = true;
      } });
      if (result?.cancelled || result?.accepted === false) await this.update(provider, id, { status: 'not-sent' });
      else if (!result?.pending) await this.update(provider, id, { status: 'confirmed' });
      await this.store.queue;
      return { ...result, submission: this.snapshot(provider) };
    } catch (error) {
      await this.update(provider, id, { status: dispatched ? 'unknown' : 'not-sent' }).catch(() => {});
      const record = this.snapshot(provider);
      if (record?.id === id && record.status === 'confirmed') return { accepted: true, submission: record };
      throw error;
    } finally { this.active.delete(provider); }
  }
  async reconcile(backend, provider, id) {
    const record = this.snapshot(provider);
    if (record?.id !== id || !unresolvedSubmission(record)) throw new Error('这次发送已处理，请刷新状态。');
    if (this.active.has(provider) || backend.busy) throw new Error('请先等待当前任务结束或停止，再核查发送结果。');
    let rows, message = '尚无法确定是否已送达。请检查会话记录，原稿继续保留；不会自动重发。';
    try { rows = await backend.readSubmissionHistory?.(record.target); }
    catch { message = '会话记录暂时无法读取，请先重连后再次核查。原稿继续保留。'; }
    await this.update(provider, id, { status: matchesSubmission(record, rows) ? 'confirmed' : 'unknown', checkedAt: Date.now(), checkMessage: message });
    return this.snapshot(provider);
  }
  async release(backend, provider, id) {
    const record = this.snapshot(provider);
    if (record?.id !== id || !unresolvedSubmission(record) || !record.checkedAt) throw new Error('请先核查发送结果，再决定如何处理原稿。');
    if (this.active.has(provider) || backend.busy) throw new Error('请先停止当前任务。');
    await this.update(provider, id, { status: 'released' });
    return this.snapshot(provider);
  }
}
