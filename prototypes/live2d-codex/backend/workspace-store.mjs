import { stat, realpath } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import actions from './input-actions.cjs';
import characters from './character-profiles.cjs';
import wallpaperChoices from './wallpaper-choice.cjs';
import stills from './still-settings.cjs';
import catalog from './agent-catalog.cjs';
import { remoteSettings } from './remote-config.mjs';
import { readJson, writeJson, prepareJson } from './durable-json.mjs';
import { pathKey } from './path-identity.mjs';
export { pathKey } from './path-identity.mjs';
const { isCliAgent } = catalog;

export const { DEFAULT_SHORTCUTS, DEFAULT_REMOTE_KEYS } = actions;
const { DEFAULT_CHARACTER, characterProfile, isCharacter, isQwenVoice, isChineseVoice } = characters;
const defaults = () => ({ format: 1, projects: [], drafts: {}, settings: { character: DEFAULT_CHARACTER, wallpaperKind: 'artwork', completionSound: true, ttsResident: false, ttsEngine: 'qwen', qwenVoice: 'Serena', qwenRoot: '', autoSpeak: false, prepareSpeech: false, voice: 3, speed: 1, microphone: '', shortcuts: { ...DEFAULT_SHORTCUTS }, remoteEnabled: false, remoteKeys: { ...DEFAULT_REMOTE_KEYS } } });
export const draftKey = target => {
  if (!target || typeof target.cwd !== 'string') throw new Error('草稿目标无效。');
  const provider = target?.provider ?? 'codex';
  if (!isCliAgent(provider) && provider !== 'dots') throw new Error('草稿来源无效。');
  if (target.threadId != null && (typeof target.threadId !== 'string' || !target.threadId || target.threadId.length > 200)) throw new Error('草稿会话无效。');
  // Keep existing Codex keys unchanged; Dots has no local project directory.
  return provider === 'dots' ? `dots|${target.threadId ?? 'new'}` : `${provider === 'codex' ? '' : provider + '|'}${pathKey(target.cwd)}|${target.threadId ?? 'new'}`;
};

export function validateWorkspace(saved) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(saved) || saved.format !== 1 || !Array.isArray(saved.projects) || !object(saved.settings ?? {})) throw new Error('工作台数据格式不支持。');
  const ids = new Set();
  for (const p of saved.projects) {
    if (!object(p) || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.cwd !== 'string' || !p.cwd.trim()) throw new Error('项目记录无效。');
    ids.add(p.id);
  }
  if (!object(saved.drafts ?? {})) throw new Error('草稿记录无效。');
  for (const d of Object.values(saved.drafts ?? {})) if (!object(d) || typeof d.text !== 'string' || d.dictationIds !== undefined && (!Array.isArray(d.dictationIds) || d.dictationIds.some(id => typeof id !== 'string'))) throw new Error('草稿记录无效。');
  if (!object(saved.submissions ?? {})) throw new Error('发送记录无效。');
  for (const [provider, s] of Object.entries(saved.submissions ?? {})) {
    if (!isCliAgent(provider) || !object(s) || typeof s.id !== 'string' || typeof s.text !== 'string' || s.target?.provider !== provider || !['pending','unknown','confirmed','released','not-sent'].includes(s.status)) throw new Error('发送记录无效。');
    draftKey(s.target);
  }
  return saved;
}

function canonicalDrafts(drafts = {}) {
  const result = {};
  for (const [oldKey, draft] of Object.entries(drafts)) {
    const parts = oldKey.split('|');
    const provider = isCliAgent(parts[0]) ? parts.shift() : 'codex';
    const key = parts[0] === 'dots' || parts.length < 2 ? oldKey : `${provider === 'codex' ? '' : provider + '|'}${pathKey(parts.shift())}|${parts.join('|')}`;
    const existing = result[key];
    // Aliases may contain independently edited drafts. Show all distinct text
    // instead of choosing a winner and silently discarding the other version.
    result[key] = !existing ? draft : { ...existing, text: existing.text === draft.text ? draft.text : [existing.text, draft.text].filter(Boolean).join('\n\n'), dictationIds: [...new Set([...(existing.dictationIds ?? []), ...(draft.dictationIds ?? [])])] };
  }
  return result;
}

export class WorkspaceStore {
  constructor(directory, { io } = {}) { this.file = join(directory, 'workspaces.json'); this.io = io; this.data = defaults(); this.queue = Promise.resolve(); }
  async load() {
    try {
      const saved = await readJson(this.file, validateWorkspace, this.io);
      if (!saved) return this.snapshot();
      this.data = { ...defaults(), ...saved, settings: { ...defaults().settings, ...saved.settings, shortcuts: { ...DEFAULT_SHORTCUTS, ...saved.settings?.shortcuts }, remoteKeys: { ...DEFAULT_REMOTE_KEYS, ...saved.settings?.remoteKeys } } };
      this.data.drafts = canonicalDrafts(saved.drafts);
      this.data.submissions ??= {};
      for (const submission of Object.values(this.data.submissions)) if (submission.status === 'pending') submission.status = 'unknown';
      const profile = characterProfile(saved.settings?.character);
      this.data.settings.character = profile.id;
      // Retired video selections migrate without changing the person or custom voices.
      this.data.settings.wallpaperKind = 'artwork';
      Object.assign(this.data.settings, stills.stillSettings(saved.settings));
      this.data.settings.rc003 = remoteSettings(saved.settings?.rc003);
      if (!isQwenVoice(saved.settings?.qwenVoice)) this.data.settings.qwenVoice = profile.qwenVoice;
      if (!isChineseVoice(saved.settings?.voice)) this.data.settings.voice = profile.voice;
    } catch (error) { if (error.code !== 'ENOENT') throw new Error(`工作台记录未能读取，原文件已保留：${error.message}`); }
    return this.snapshot();
  }
  snapshot() { return structuredClone({ projects: this.data.projects, settings: this.data.settings }); }
  transaction(change) {
    this.queue = this.queue.catch(() => {}).then(async () => {
      const next = structuredClone(this.data);
      const result = await change(next);
      await writeJson(this.file, next, this.io);
      this.data = next;
      return structuredClone(result);
    });
    return this.queue;
  }
  async add(cwd) {
    if (typeof cwd !== 'string' || !cwd.trim()) throw new Error('请选择项目文件夹。');
    const canonical = await realpath(resolve(cwd));
    if (!(await stat(canonical)).isDirectory()) throw new Error('项目路径必须是文件夹。');
    const existing = this.data.projects.find(p => pathKey(p.cwd) === pathKey(canonical));
    if (existing) return structuredClone(existing);
    return this.transaction(data => {
      let project = data.projects.find(p => pathKey(p.cwd) === pathKey(canonical));
      if (!project) { project = { id: randomUUID(), cwd: canonical, name: basename(canonical) || canonical, lastThreadId: null, updatedAt: Date.now() }; data.projects.push(project); }
      return project;
    });
  }
  project(id) { const p = this.data.projects.find(p => p.id === id); if (!p) throw new Error('项目不在工作台列表中，请重新选择。'); return structuredClone(p); }
  async remember(state) {
    let p = this.data.projects.find(p => pathKey(p.cwd) === pathKey(state.cwd));
    if (!p) { try { p = await this.add(state.cwd); } catch { return; } p = this.data.projects.find(v => v.id === p.id); }
    const provider = state.provider ?? 'codex';
    if (!isCliAgent(provider)) return;
    if (p.lastThreads?.[provider] !== state.threadId || provider === 'codex' && p.lastThreadId !== state.threadId) return this.transaction(data => {
      p = data.projects.find(v => v.id === p.id);
      if (!p) return;
      p.lastThreads ??= {};
      p.lastThreads[provider] = state.threadId;
      if (provider === 'codex') p.lastThreadId = state.threadId;
      p.updatedAt = Date.now();
    });
  }
  async remove(id, activeCwd) {
    const p = this.project(id);
    if (pathKey(p.cwd) === pathKey(activeCwd)) throw new Error('请先切换到其他项目，再移除此入口。');
    await this.transaction(data => {
      // The receipt can belong to another provider or to a newly assigned
      // thread. Keep both project identities reachable until it is resolved.
      const pending = Object.values(data.submissions ?? {}).some(record =>
        ['pending', 'unknown'].includes(record.status) &&
        [record.target, record.originalTarget].some(target => typeof target?.cwd === 'string' && pathKey(target.cwd) === pathKey(p.cwd)));
      if (pending) throw new Error('此项目还有发送结果未确定，请先核查并处理原稿，再移除此入口。');
      data.projects = data.projects.filter(p => p.id !== id);
    });
  }
  draft(target) { return this.data.drafts[draftKey(target)]?.text ?? ''; }
  draftSnapshot(target) {
    const draft=this.data.drafts[draftKey(target)];
    return {text:draft?.text ?? '',dictationIds:[...(draft?.dictationIds ?? [])]};
  }
  async appendDictation(target, text, id) {
    return this.transaction(data => {
      const draft=data.drafts[draftKey(target)];
      if(draft?.dictationIds?.includes(id))return;
      const current=draft?.text ?? '';
      this.setDraft(data,target,current+(current && !/\s$/.test(current)?' ':'')+text,id);
    });
  }
  setDraft(data, target, text, dictationId) {
    const key = draftKey(target);
    if (target.provider !== 'dots' && (typeof target.cwd !== 'string' || !data.projects.some(p => pathKey(p.cwd) === pathKey(target.cwd)))) throw new Error('草稿的项目不存在。');
    if (typeof text !== 'string' || text.length > 64000 || (target.threadId !== null && target.threadId !== undefined && (typeof target.threadId !== 'string' || target.threadId.length > 200))) throw new Error('草稿内容无效。');
    const dictationIds=[...(data.drafts[key]?.dictationIds ?? []),...(dictationId?[dictationId]:[])].slice(-32);
    if (text) data.drafts[key] = { text, updatedAt: Date.now(), ...(dictationIds.length?{dictationIds}:{}) }; else delete data.drafts[key];
    // Unsent input is user data, not a bounded/reconstructible history cache.
    // Only an explicit empty save removes the selected draft.
  }
  saveDraft(target, text, dictationId) { return this.transaction(data => this.setDraft(data, target, text, dictationId)); }
  async updateSettings(patch) {
    await this.transaction(data => this.applySettings(data, patch));
    return this.snapshot();
  }
  prepareSettings(patch) {
    const ready = Promise.withResolvers();
    this.queue = this.queue.catch(() => {}).then(async () => {
      const next = structuredClone(this.data);
      this.applySettings(next, patch);
      const staged = await prepareJson(this.file, next, this.io);
      const finished = Promise.withResolvers(); let settled = false;
      const cancel = () => { if (!settled) { settled = true; finished.resolve(false); } };
      ready.resolve({ cancel, commit: () => {
        if (settled) throw new Error('人物切换已取消，请重试。');
        try { staged.commit(); this.data = next; settled = true; finished.resolve(true); }
        catch (error) { cancel(); throw error; }
      } });
      if (!await finished.promise) await staged.discard();
    });
    this.queue.catch(ready.reject);
    return ready.promise;
  }
  applySettings(data, patch) {
    const next = data.settings;
    Object.assign(next, stills.validateStillPatch(patch));
    if ('wallpaperKind' in patch) {
      if (!wallpaperChoices.isWallpaperKind(patch.wallpaperKind)) throw new Error('壁纸类型无效。');
      next.wallpaperKind = patch.wallpaperKind;
    } else if ('character' in patch && patch.character !== next.character) next.wallpaperKind = 'artwork';
    if ('rc003' in patch) next.rc003 = remoteSettings(patch.rc003);
    if ('character' in patch) {
      if (!isCharacter(patch.character)) throw new Error('请选择已支持的壁纸人物。');
      if (patch.character !== next.character) {
        const profile = characterProfile(patch.character);
        next.character = profile.id; next.qwenVoice = profile.qwenVoice; next.voice = profile.voice;
      }
    }
    if ('completionSound' in patch) { if (typeof patch.completionSound !== 'boolean') throw new Error('提示音开关无效。'); next.completionSound = patch.completionSound; }
    if ('playbackVolume' in patch) { if (!Number.isFinite(patch.playbackVolume) || patch.playbackVolume < 0 || patch.playbackVolume > 1) throw new Error('播报音量应在 0–100% 之间。'); next.playbackVolume = patch.playbackVolume; }
    if ('ttsResident' in patch) { if (typeof patch.ttsResident !== 'boolean') throw new Error('常驻开关无效。'); next.ttsResident = patch.ttsResident; }
    if ('ttsEngine' in patch) { if (!['qwen','kokoro'].includes(patch.ttsEngine)) throw new Error('请选择已支持的语音引擎。'); next.ttsEngine = patch.ttsEngine; }
    if ('qwenVoice' in patch) { if (!isQwenVoice(patch.qwenVoice)) throw new Error('请选择已支持的 Qwen 声线。'); next.qwenVoice = patch.qwenVoice; }
    if ('qwenRoot' in patch) { if (typeof patch.qwenRoot !== 'string' || patch.qwenRoot.length > 2000 || /[\r\n\0]/.test(patch.qwenRoot)) throw new Error('Qwen 资源目录无效。'); next.qwenRoot = patch.qwenRoot; }
    if ('autoSpeak' in patch) next.autoSpeak = patch.autoSpeak === true;
    if ('prepareSpeech' in patch) { if (typeof patch.prepareSpeech !== 'boolean') throw new Error('提前准备语音开关无效。'); next.prepareSpeech = patch.prepareSpeech; }
    if ('voice' in patch) { if (!isChineseVoice(patch.voice)) throw new Error('请选择已支持的中文声线。'); next.voice = patch.voice; }
    if ('speed' in patch) { if (!Number.isFinite(patch.speed) || patch.speed < .75 || patch.speed > 1.25) throw new Error('语速应在 0.75–1.25 之间。'); next.speed = patch.speed; }
    if ('microphone' in patch) { if (typeof patch.microphone !== 'string' || patch.microphone.length > 500) throw new Error('麦克风选项无效。'); next.microphone = patch.microphone; }
    if ('remoteEnabled' in patch) next.remoteEnabled = patch.remoteEnabled === true;
    for (const group of ['shortcuts', 'remoteKeys']) if (patch[group]) {
      for (const key of Object.keys(next[group])) if (key in patch[group]) {
        const v = patch[group][key]; if (typeof v !== 'string' || v.length > 80 || /[\r\n]/.test(v)) throw new Error('按键映射无效。'); next[group][key] = v;
      }
    }
  }
}
