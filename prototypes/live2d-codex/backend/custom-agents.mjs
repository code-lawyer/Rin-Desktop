import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import catalog from './agent-catalog.cjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/[\x00-\x1f]/.test(value);
const fields = new Set(['id', 'name', 'protocol', 'command', 'args', 'authMethodId']);

// A versioned, data-only launch contract. No modules or project configuration
// are evaluated, and arguments are passed directly to spawn with shell:false.
export function parseCustomAgents(document, { platform = process.platform } = {}) {
  if (!object(document) || document.format !== 1 || !Array.isArray(document.agents) || document.agents.length > 32 || Object.keys(document).some(key => !['format', 'agents'].includes(key))) throw new Error('自定义 Agent 配置需要 format: 1 和 agents 数组（最多 32 项）。');
  const ids = new Set();
  return document.agents.map((entry, index) => {
    const fail = reason => { throw new Error(`自定义 Agent 第 ${index + 1} 项：${reason}`); };
    if (!object(entry) || Object.keys(entry).some(key => !fields.has(key))) fail('存在不支持的配置字段。');
    if (!catalog.isCustomAgentId(entry.id) || ids.has(entry.id)) fail('id 必须是唯一的 custom- 前缀标识，后接 1–48 个小写字母、数字或连字符，首字符不能是连字符。');
    if (!text(entry.name, 80)) fail('name 需要 1–80 个字符。');
    if (entry.protocol !== 'acp') fail('目前只支持 protocol: "acp"（ACP v1 stdio）。');
    if (!text(entry.command, 4096) || !isAbsolute(entry.command) || platform === 'win32' && !entry.command.toLowerCase().endsWith('.exe')) fail('command 必须是可执行文件的绝对路径，Windows 下必须为 .exe。');
    if (!Array.isArray(entry.args) || entry.args.length > 64 || entry.args.some(arg => typeof arg !== 'string' || arg.length > 8192 || /[\x00-\x1f]/.test(arg))) fail('args 必须是最多 64 项的字符串数组。');
    if (entry.authMethodId !== undefined && !text(entry.authMethodId, 200)) fail('authMethodId 必须是非空认证方法标识。');
    ids.add(entry.id);
    return Object.freeze({ id: entry.id, name: entry.name.trim(), protocol: 'acp', command: entry.command, args: Object.freeze([...entry.args]), ...(entry.authMethodId ? { authMethodId: entry.authMethodId } : {}) });
  });
}

export async function loadCustomAgents(storageDir, { env = process.env } = {}) {
  const override = env.VIBE_AGENT_CONFIG;
  const file = override || join(storageDir, 'custom-agents.json');
  if (override && !isAbsolute(override)) throw new Error('VIBE_AGENT_CONFIG 必须是配置文件的绝对路径。');
  let source;
  try { source = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT' && !override) return [];
    throw new Error('无法读取自定义 Agent 配置，请检查 custom-agents.json 或 VIBE_AGENT_CONFIG。');
  }
  return decode(source);
}

function decode(source) {
  if (Buffer.byteLength(source, 'utf8') > 65536) throw new Error('自定义 Agent 配置不能超过 64 KiB。');
  let document;
  // JSON parser errors can contain configuration text. Never forward it to UI.
  try { document = JSON.parse(source.replace(/^\uFEFF/, '')); }
  catch { throw new Error('自定义 Agent 配置不是有效 JSON，请检查引号和逗号。'); }
  return parseCustomAgents(document);
}

const revisionOf = source => source === undefined ? 'missing' : createHash('sha256').update(source).digest('hex');
const conflict = () => new Error('配置已被其他操作修改，请点击“重新读取”后再保存；你的输入已保留。');

// Own only the user's registration file. Sessions, receipts and drafts are
// deliberately outside this store, including when a registration is deleted.
export class CustomAgentStore {
  constructor(storageDir, { env = process.env, io = fs } = {}) {
    this.io = io; this.entries = []; this.revision = null; this.error = ''; this.queue = Promise.resolve();
    this.external = !!env.VIBE_AGENT_CONFIG;
    this.file = env.VIBE_AGENT_CONFIG || join(storageDir, 'custom-agents.json');
    if (!isAbsolute(this.file)) { this.file = ''; this.error = 'VIBE_AGENT_CONFIG 必须是配置文件的绝对路径。'; }
  }
  snapshot() { return { entries: structuredClone(this.entries), revision: this.revision, file: this.file, external: this.external, error: this.error }; }
  async source() {
    if (!this.file) throw new Error(this.error);
    try { return await this.io.readFile(this.file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw new Error('无法读取自定义 Agent 配置，请检查文件权限后重新读取。'); }
  }
  serialize(operation) {
    const pending = this.queue.catch(() => {}).then(operation);
    this.queue = pending;
    return pending;
  }
  reload({ guard = () => {} } = {}) {
    return this.serialize(async () => {
      let entries, source;
      try { source = await this.source(); entries = source === undefined ? [] : decode(source); }
      catch (error) { this.error = error.message; return this.snapshot(); }
      await guard(entries);
      this.entries = entries; this.revision = revisionOf(source); this.error = '';
      return this.snapshot();
    });
  }
  save(entry, revision, { creating = false } = {}) {
    return this.mutate(revision, entries => {
      const normalized = parseCustomAgents({ format: 1, agents: [entry] })[0];
      const index = entries.findIndex(item => item.id === normalized.id);
      if (creating && index !== -1) throw new Error('该 Agent 标识已存在，请换一个标识或编辑原配置。');
      if (!creating && index === -1) throw new Error('该 Agent 已被删除，请重新读取后添加。');
      if (creating) entries.push(normalized); else entries[index] = normalized;
      return entries;
    });
  }
  remove(id, revision) {
    return this.mutate(revision, entries => {
      if (!entries.some(entry => entry.id === id)) throw new Error('该 Agent 已被删除，请重新读取。');
      return entries.filter(entry => entry.id !== id);
    });
  }
  mutate(revision, change) {
    return this.serialize(async () => {
      if (this.error) throw new Error(this.error + ' 原文件已保留，请修复后重新读取。');
      if (!revision || revision !== this.revision) throw conflict();
      return this.withWriteLock(async () => {
        const previous = await this.source();
        if (revisionOf(previous) !== revision) throw conflict();
        const entries = parseCustomAgents({ format: 1, agents: change(structuredClone(this.entries)) });
        const source = JSON.stringify({ format: 1, agents: entries }, null, 2) + '\n';
        decode(source); // Enforce the same document size limit on UI writes.
        await this.write(source, previous, revision);
        this.entries = entries; this.revision = revisionOf(source); this.error = '';
        return this.snapshot();
      });
    });
  }
  async withWriteLock(operation) {
    // The same VIBE_AGENT_CONFIG may be shared by different Rin processes.
    // Cooperating external writers use this exact exclusive-create contract.
    const lock = this.file + '.lock';
    await this.io.mkdir(dirname(this.file), { recursive: true });
    let handle;
    try { handle = await this.io.open(lock, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Agent 配置正在被其他操作写入，请稍后重试。若程序异常退出遗留 .lock 文件，请让 Agent 确认所有写入程序已停止后清理；当前输入与配置已保留。');
      throw error;
    }
    try {
      await handle.writeFile(JSON.stringify({ format: 1, pid: process.pid, owner: 'rin-desktop', createdAt: new Date().toISOString() }), 'utf8');
      await handle.sync();
      return await operation();
    } finally {
      try { await handle.close(); }
      finally { await this.io.unlink(lock); }
    }
  }
  async write(source, previous, revision) {
    const temporary = this.file + '.' + randomUUID() + '.tmp', backup = temporary + '.bak';
    const stage = async (file, text) => {
      const handle = await this.io.open(file, 'wx');
      try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
    };
    try {
      await this.io.mkdir(dirname(this.file), { recursive: true });
      await stage(temporary, source);
      if (previous !== undefined) await stage(backup, previous);
      if (revisionOf(await this.source()) !== revision) throw conflict();
      if (previous !== undefined) await this.io.rename(backup, this.file + '.bak');
      if (revisionOf(await this.source()) !== revision) throw conflict();
      await this.io.rename(temporary, this.file);
    } finally {
      for (const file of [temporary, backup]) await this.io.unlink(file).catch(() => {});
    }
  }
}
