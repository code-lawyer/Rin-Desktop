import { readFile, writeFile, mkdir, rename, stat, realpath } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import actions from './input-actions.cjs';

export const { DEFAULT_SHORTCUTS, DEFAULT_REMOTE_KEYS } = actions;
const defaults = () => ({ format: 1, projects: [], drafts: {}, settings: { completionSound: true, ttsResident: false, ttsEngine: 'qwen', qwenVoice: 'Serena', qwenRoot: '', autoSpeak: false, prepareSpeech: false, voice: 3, speed: 1, microphone: '', shortcuts: { ...DEFAULT_SHORTCUTS }, remoteEnabled: false, remoteKeys: { ...DEFAULT_REMOTE_KEYS } } });
export const pathKey = value => resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase('en-US');
export const draftKey = target => {
  if (!target || typeof target.cwd !== 'string') throw new Error('草稿目标无效。');
  const provider = target?.provider ?? 'codex';
  if (!['codex', 'dots'].includes(provider)) throw new Error('草稿来源无效。');
  if (target.threadId != null && (typeof target.threadId !== 'string' || !target.threadId || target.threadId.length > 200)) throw new Error('草稿会话无效。');
  // Keep existing Codex keys unchanged; Dots has no local project directory.
  return provider === 'dots' ? `dots|${target.threadId ?? 'new'}` : `${pathKey(target.cwd)}|${target.threadId ?? 'new'}`;
};

export class WorkspaceStore {
  constructor(directory) { this.file = join(directory, 'workspaces.json'); this.data = defaults(); this.queue = Promise.resolve(); }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (saved.format !== 1 || !Array.isArray(saved.projects)) throw new Error('工作台数据格式不支持。');
      this.data = { ...defaults(), ...saved, settings: { ...defaults().settings, ...saved.settings, shortcuts: { ...DEFAULT_SHORTCUTS, ...saved.settings?.shortcuts }, remoteKeys: { ...DEFAULT_REMOTE_KEYS, ...saved.settings?.remoteKeys } } };
    } catch (error) { if (error.code !== 'ENOENT') throw new Error(`工作台记录未能读取，原文件已保留：${error.message}`); }
    return this.snapshot();
  }
  snapshot() { return structuredClone({ projects: this.data.projects, settings: this.data.settings }); }
  async save() {
    const content = JSON.stringify(this.data, null, 2) + '\n';
    this.queue = this.queue.catch(() => {}).then(async () => { await mkdir(resolve(this.file, '..'), { recursive: true }); await writeFile(this.file + '.tmp', content); await rename(this.file + '.tmp', this.file); });
    return this.queue;
  }
  async add(cwd) {
    if (typeof cwd !== 'string' || !cwd.trim()) throw new Error('请选择项目文件夹。');
    const canonical = await realpath(resolve(cwd));
    if (!(await stat(canonical)).isDirectory()) throw new Error('项目路径必须是文件夹。');
    let project = this.data.projects.find(p => pathKey(p.cwd) === pathKey(canonical));
    if (!project) { project = { id: randomUUID(), cwd: canonical, name: basename(canonical) || canonical, lastThreadId: null, updatedAt: Date.now() }; this.data.projects.push(project); await this.save(); }
    return structuredClone(project);
  }
  project(id) { const p = this.data.projects.find(p => p.id === id); if (!p) throw new Error('项目不在工作台列表中，请重新选择。'); return structuredClone(p); }
  async remember(state) {
    let p = this.data.projects.find(p => pathKey(p.cwd) === pathKey(state.cwd));
    if (!p) { try { p = await this.add(state.cwd); } catch { return; } p = this.data.projects.find(v => v.id === p.id); }
    if (p.lastThreadId !== state.threadId) { p.lastThreadId = state.threadId; p.updatedAt = Date.now(); await this.save(); }
  }
  async remove(id, activeCwd) {
    const p = this.project(id);
    if (pathKey(p.cwd) === pathKey(activeCwd)) throw new Error('请先切换到其他项目，再移除此入口。');
    this.data.projects = this.data.projects.filter(p => p.id !== id); await this.save();
  }
  draft(target) { return this.data.drafts[draftKey(target)]?.text ?? ''; }
  async saveDraft(target, text) {
    const key = draftKey(target);
    if (target.provider !== 'dots' && (typeof target.cwd !== 'string' || !this.data.projects.some(p => pathKey(p.cwd) === pathKey(target.cwd)))) throw new Error('草稿的项目不存在。');
    if (typeof text !== 'string' || text.length > 64000 || (target.threadId !== null && target.threadId !== undefined && (typeof target.threadId !== 'string' || target.threadId.length > 200))) throw new Error('草稿内容无效。');
    if (text) this.data.drafts[key] = { text, updatedAt: Date.now() }; else delete this.data.drafts[key];
    const entries = Object.entries(this.data.drafts).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    this.data.drafts = Object.fromEntries(entries.slice(0, 100)); await this.save();
  }
  async updateSettings(patch) {
    const next = structuredClone(this.data.settings);
    if ('completionSound' in patch) { if (typeof patch.completionSound !== 'boolean') throw new Error('提示音开关无效。'); next.completionSound = patch.completionSound; }
    if ('ttsResident' in patch) { if (typeof patch.ttsResident !== 'boolean') throw new Error('常驻开关无效。'); next.ttsResident = patch.ttsResident; }
    if ('ttsEngine' in patch) { if (!['qwen','kokoro'].includes(patch.ttsEngine)) throw new Error('请选择已支持的语音引擎。'); next.ttsEngine = patch.ttsEngine; }
    if ('qwenVoice' in patch) { if (!['Serena','Vivian'].includes(patch.qwenVoice)) throw new Error('请选择 Qwen 女声。'); next.qwenVoice = patch.qwenVoice; }
    if ('qwenRoot' in patch) { if (typeof patch.qwenRoot !== 'string' || patch.qwenRoot.length > 2000 || /[\r\n\0]/.test(patch.qwenRoot)) throw new Error('Qwen 资源目录无效。'); next.qwenRoot = patch.qwenRoot; }
    if ('autoSpeak' in patch) next.autoSpeak = patch.autoSpeak === true;
    if ('prepareSpeech' in patch) { if (typeof patch.prepareSpeech !== 'boolean') throw new Error('提前准备语音开关无效。'); next.prepareSpeech = patch.prepareSpeech; }
    if ('voice' in patch) { if (!Number.isInteger(patch.voice) || patch.voice < 3 || patch.voice > 57) throw new Error('请选择中文女声音色。'); next.voice = patch.voice; }
    if ('speed' in patch) { if (!Number.isFinite(patch.speed) || patch.speed < .75 || patch.speed > 1.25) throw new Error('语速应在 0.75–1.25 之间。'); next.speed = patch.speed; }
    if ('microphone' in patch) { if (typeof patch.microphone !== 'string' || patch.microphone.length > 500) throw new Error('麦克风选项无效。'); next.microphone = patch.microphone; }
    if ('remoteEnabled' in patch) next.remoteEnabled = patch.remoteEnabled === true;
    for (const group of ['shortcuts', 'remoteKeys']) if (patch[group]) {
      for (const key of Object.keys(next[group])) if (key in patch[group]) {
        const v = patch[group][key]; if (typeof v !== 'string' || v.length > 80 || /[\r\n]/.test(v)) throw new Error('按键映射无效。'); next[group][key] = v;
      }
    }
    this.data.settings = next; await this.save(); return this.snapshot();
  }
}
