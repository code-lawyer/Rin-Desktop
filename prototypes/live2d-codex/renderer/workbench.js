import { renderReply } from './reply-document.mjs';
import { isTaskBusy } from '../backend/task-state.mjs';
const api = window.companion, $ = id => document.getElementById(id);
let workspace = { projects: [], settings: {} }, current, projectId, selected, threads = [], listCursor, historyCursor, listVersion = 0, historyVersion = 0, noticeTimer, searchTimer, settingsDirty = false, ready = false;
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
function notice(text) { clearTimeout(noticeTimer); $('notice').textContent = text; $('notice').hidden = !text; if (text) noticeTimer = setTimeout(() => $('notice').hidden = true, 10000); }
async function run(promise) { try { const r = await promise; if (!r?.ok) throw new Error(r?.error || '操作未完成。'); return r.value; } catch (e) { notice(e.message); throw e; } }
const act = action => event => { Promise.resolve().then(() => action(event)).catch(() => {}); };
// A completed unload event may arrive before the older IPC save response.
// Never replace a newer snapshot with that stale response.
function acceptWorkspace(value) { if ((value.version ?? 0) < (workspace.version ?? 0)) return false; workspace = value; return true; }
const busy = () => isTaskBusy(current);
const available = () => current?.connection === 'ready' && current?.provider === 'codex';
function updateActivity() {
  $('connection').textContent = current?.provider === 'dots' ? '请在气泡设置中切回 Codex' : current?.connection === 'ready' ? 'Codex CLI · 本机工作区' : current?.error || '正在连接 Codex…';
  $('new-thread').disabled = busy() || !available() || !projectId;
  $('resume').disabled = busy() || !available() || !selected;
  $('busy-note').hidden = !busy(); $('model').disabled = busy() || !available(); $('effort').disabled = busy() || !available();
}
function renderProjects() {
  const host = $('projects'); host.replaceChildren();
  for (const p of workspace.projects) {
    const b = node('button', undefined, 'project-row'); b.setAttribute('aria-pressed', String(p.id === projectId && $('settings').hidden)); b.title = p.cwd;
    b.append(node('strong', p.name), node('small', p.cwd)); b.addEventListener('click', act(() => selectProject(p.id))); host.append(b);
  }
  if (!workspace.projects.length) host.append(node('p', '添加一个本地文件夹，开始工作。', 'empty-list'));
}
async function selectProject(id, { preservePage = false } = {}) {
  const p = workspace.projects.find(v => v.id === id); if (!p) return;
  projectId = id; selected = null; historyVersion++; $('search').value = ''; $('detail').hidden = true; $('empty-detail').hidden = false;
  if (!preservePage) { $('settings').hidden = true; $('conversations').hidden = false; $('settings-tab').setAttribute('aria-pressed','false'); }
  $('project-title').textContent = p.name; $('project-path').textContent = p.cwd; $('project-path').title = p.cwd;
  $('remove-project').disabled = p.cwd.toLowerCase() === current?.cwd?.toLowerCase(); renderProjects(); updateActivity(); await refreshThreads();
}
async function refreshThreads(append = false) {
  if (!available() || !projectId) return;
  const version = ++listVersion, id = projectId;
  if (!append) { threads = []; $('threads').replaceChildren(node('p', '正在读取本地对话…', 'empty-list')); }
  try {
    const result = await run(api.listThreads(id, append ? listCursor : null, $('search').value));
    if (version !== listVersion || id !== projectId) return;
    threads = append ? [...threads, ...result.data.filter(v => !threads.some(t => t.id === v.id))] : result.data;
    listCursor = result.nextCursor; renderThreads();
  } catch { if (version === listVersion && !append) $('threads').replaceChildren(node('p', '暂时无法读取。连接恢复后点击「刷新」。', 'empty-list')); }
}
function renderThreads() {
  $('threads').replaceChildren();
  for (const t of threads) {
    const b = node('button', undefined, 'thread-row'); b.setAttribute('aria-pressed', String(t.id === selected?.id)); b.title = t.name;
    const date = new Date(t.updatedAt * 1000); b.append(node('strong', t.name), node('small', `${t.id === current?.threadId ? '当前 · ' : ''}${Number.isNaN(+date) ? '' : date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`));
    b.addEventListener('click', act(() => selectThread(t))); $('threads').append(b);
  }
  if (!threads.length) $('threads').append(node('p', $('search').value ? '没有匹配的对话。' : '这个项目还没有对话。点击「新对话」开始。', 'empty-list'));
  $('more-threads').hidden = !listCursor;
}
async function selectThread(t) {
  selected = t; renderThreads(); $('detail').hidden = false; $('empty-detail').hidden = true; $('thread-title').value = t.name; $('thread-info').textContent = `本地会话 · ${t.id.slice(-8)}`; updateActivity();
  $('history').replaceChildren(node('p', '正在读取历史…', 'hint')); historyCursor = null; $('more-history').hidden = true; await loadHistory();
}
async function loadHistory(older = false) {
  if (!selected) return; const id = selected.id, version = ++historyVersion;
  try {
    const result = await run(api.history(id, older ? historyCursor : null));
    if (version !== historyVersion || selected?.id !== id) return;
    if (!older) $('history').replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const turn of result.turns) for (const item of turn.items ?? []) {
      if (!['userMessage','agentMessage'].includes(item.type)) continue;
      const text = item.type === 'agentMessage' ? item.text : (item.content ?? []).filter(v => v.type === 'text').map(v => v.text).join('\n');
      if (!text) continue;
      const article = node('article', undefined, 'history-message'); article.append(node('p', item.type === 'userMessage' ? '你' : item.phase === 'commentary' ? 'Codex · 进度' : 'Codex', 'role'));
      const body = node('div'); renderReply(body, text, href => run(api.openLink(href)).catch(() => {})); article.append(body); fragment.append(article);
    }
    older ? $('history').prepend(fragment) : $('history').append(fragment);
    if (!$('history').children.length) $('history').append(node('p', '还没有可显示的文字消息。', 'hint'));
    historyCursor = result.nextCursor; $('more-history').hidden = !historyCursor;
  } catch { if (version === historyVersion && !older) $('history').replaceChildren(node('p', '历史暂时无法读取，可以刷新后重试。', 'hint')); }
}
function fillModels() {
  const select = $('model'); select.replaceChildren(); for (const m of current?.models ?? []) { const o = node('option', m.name); o.value = m.model; select.append(o); } select.value = current?.model ?? ''; fillEfforts();
}
function fillEfforts() {
  $('effort').replaceChildren(); const o = node('option', '沿用会话 / CLI 设置'); o.value = ''; $('effort').append(o);
  const labels = {minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'很高',max:'最高',ultra:'极高',none:'无'};
  for (const e of current?.models?.find(m => m.model === current.model)?.efforts ?? []) { const v = node('option', labels[e.reasoningEffort] ?? e.reasoningEffort); v.value = e.reasoningEffort; $('effort').append(v); } $('effort').value = current?.effort ?? '';
}
function keyFields(id, values) {
  const host = $(id); host.replaceChildren();
  for (const [action, definition] of Object.entries(inputActions.INPUT_ACTIONS)) {
    const label = node('label',definition.label), field = node('input'); field.readOnly = true; field.value = values?.[action] ?? ''; field.dataset.action = action; field.placeholder = '未设置'; field.setAttribute('aria-label',definition.label + '按键');
    field.addEventListener('focus',() => api.learnKey(true)); field.addEventListener('blur',() => api.learnKey(false));
    field.addEventListener('keydown', event => {
      if (event.key === 'Tab') return; event.preventDefault(); event.stopPropagation();
      if (event.repeat) return;
      if (event.key === 'Escape') { field.blur(); return; } if (event.key === 'Backspace' || event.key === 'Delete') { field.value = ''; settingsDirty = true; return; }
      if (['Control','Shift','Alt','Meta'].includes(event.key)) return;
      const mediaKeys = {AudioVolumeUp:'VolumeUp',AudioVolumeDown:'VolumeDown',AudioVolumeMute:'VolumeMute',MediaTrackNext:'MediaNextTrack',MediaTrackPrevious:'MediaPreviousTrack',MediaPlayPause:'MediaPlayPause',MediaStop:'MediaStop'};
      const name = event.code === 'Space' ? 'Space' : mediaKeys[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key.replace('Arrow',''));
      if (id !== 'remote-keys' && !event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d{1,2}$/.test(name)) { notice('日常快捷键请使用组合键或 F1–F24；遥控器单键请填在下方的可选映射中。'); return; }
      field.value = [...(event.ctrlKey?['Control']:[]),...(event.altKey?['Alt']:[]),...(event.shiftKey?['Shift']:[]),...(event.metaKey?['Super']:[]),name].join('+'); settingsDirty = true; field.blur();
    }); label.append(field); host.append(label);
  }
}
function fillSettings() {
  // Replacing a focused input does not reliably emit blur. Preserve the key
  // learner through backend updates until the user explicitly leaves it.
  if (document.activeElement?.matches('#shortcuts input,#remote-keys input')) { updateSpeechStatus(); return; }
  const s = workspace.settings; $('auto-speak').checked = s.autoSpeak; $('voice').value = String(s.voice); $('speed').value = String(s.speed); $('remote-enabled').checked = s.remoteEnabled;
  if (!$('voice').value) { const o = node('option',`女声 ${s.voice}`); o.value = s.voice; $('voice').append(o); $('voice').value = s.voice; }
  keyFields('shortcuts',s.shortcuts); keyFields('remote-keys',s.remoteKeys); fillModels();
  $('tts-engine').value = s.ttsEngine || 'qwen'; $('qwen-voice').value = s.qwenVoice || 'Serena';
  updateSpeechStatus();
  refreshDevices().catch(() => {}); settingsDirty = false;
}
function updateSpeechStatus() {
  updateResourceStatus();
  $('shortcut-errors').hidden = !workspace.shortcutErrors?.length; $('shortcut-errors').textContent = workspace.shortcutErrors?.join(' ') || '';
  const speech = workspace.speech ?? {}, phase = speech.phase ?? 'unloaded', qwen = $('tts-engine').value === 'qwen';
  $('completion-sound').checked = workspace.settings.completionSound !== false;
  $('tts-resident').checked = workspace.settings.ttsResident === true;
  $('tts-phase').textContent = ({unloaded:'未加载',loading:'加载中…',ready:'已常驻 · 可朗读',generating:'正在合成',stopping:'正在停止合成…',unloading:'正在释放…',error:'加载需要处理'})[phase] || '未加载';
  $('tts-phase').dataset.phase = phase;
  $('tts-error').hidden = !speech.error; $('tts-error').textContent = speech.error || '';
  $('retry-tts').hidden = phase !== 'error' || !workspace.settings.ttsResident;
  $('preview-voice').disabled = phase !== 'ready';
  $('auto-speak').disabled = !workspace.settings.ttsResident;
  $('prepare-speech').checked = workspace.settings.prepareSpeech === true;
  $('prepare-speech').disabled = !workspace.settings.ttsResident;
  $('qwen-voice-field').hidden = !qwen; $('qwen-resources').hidden = !qwen; $('kokoro-fields').hidden = qwen;
  $('tts-footprint').textContent = qwen ? '参考实测：常驻后约 2 GB 内存、4.5–5.3 GB 显存。文字合成仍需等待，实际速度与硬件、回复长度有关。' : 'CPU 轻量模型；常驻期间保留模型，声音以试听为准。';
  $('qwen-resource-status').textContent = speech.engines?.qwen ? '已找到本机 Qwen 资源 · 不重复下载' : '可在上方下载 Qwen，或指定已有资源目录';
  $('model-status').textContent = speech.asr ? '听写模型可用 · 空闲约 3 分钟后释放' : '听写模型缺失';
}
function updateResourceStatus() {
  const resource = workspace.resources, speech = workspace.speech ?? {}, host = $('resource-packs');
  if (!resource) return;
  const active = ['downloading','verifying','installing'].includes(resource.phase);
  const format = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${Math.ceil(bytes / 1024 ** 2)} MiB`;
  for (const pack of resource.packs) {
    let row = [...host.children].find(row => row.dataset.resource === pack.id);
    if (!row) {
      row = node('div', undefined, 'setting-row'); row.dataset.resource = pack.id;
      row.append(node('span', undefined, 'hint'), node('button'));
      row.lastChild.onclick = act(async () => { acceptWorkspace(await run(api.downloadResource(pack.id))); updateResourceStatus(); }); host.append(row);
    }
    const installed = pack.installed || (pack.id === 'asr' ? speech.asr : speech.engines?.[pack.id]);
    row.firstChild.textContent = `${pack.label} · ${installed ? '本机已有' : `下载 ${format(pack.bytes)} · 解包 ${format(pack.unpackedBytes)}`}`;
    row.lastChild.textContent = installed ? '已就绪' : active && resource.id === pack.id ? '正在处理…' : '下载';
    row.lastChild.disabled = installed || active;
  }
  const phases = {downloading:'正在下载',verifying:'正在校验',installing:'正在安装资源，请稍候',ready:'资源已就绪，可启用听写或常驻播报'};
  $('resource-progress').hidden = resource.phase === 'idle';
  $('resource-progress').textContent = resource.error || `${phases[resource.phase] || ''}${resource.phase === 'downloading' ? ` · ${format(resource.received)} / ${format(resource.total)}` : ''}`;
  $('resource-meter').hidden = !active; $('resource-meter').value = resource.total ? resource.received / resource.total : 0;
  $('cancel-resource').hidden = !resource.cancelable;
}
async function saveSpeechChoice(patch) {
  acceptWorkspace(await run(api.saveSettings(patch))); updateSpeechStatus();
}
async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices(); const selectedDevice = settingsDirty ? $('microphone').value : workspace.settings.microphone;
  $('microphone').replaceChildren(Object.assign(node('option','系统默认麦克风'),{value:''}));
  for (const d of devices.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default')) { const o = node('option',d.label || '麦克风（听写后显示名称）'); o.value = d.deviceId; $('microphone').append(o); }
  if (selectedDevice && ![...$('microphone').options].some(o => o.value === selectedDevice)) { const o = node('option','已选设备（当前不可用）'); o.value = selectedDevice; $('microphone').append(o); }
  $('microphone').value = selectedDevice || '';
}
async function saveSettings() {
  const values = id => Object.fromEntries([...$(id).querySelectorAll('input')].map(f => [f.dataset.action,f.value]));
  acceptWorkspace(await run(api.saveSettings({autoSpeak:$('auto-speak').checked,ttsEngine:$('tts-engine').value,qwenVoice:$('qwen-voice').value,voice:Number($('voice').value),speed:Number($('speed').value),microphone:$('microphone').value,remoteEnabled:$('remote-enabled').checked,shortcuts:values('shortcuts'),remoteKeys:values('remote-keys')}))); settingsDirty = false;
  notice(workspace.shortcutErrors?.join(' ') || '设置已保存。');
}
async function refreshWorkspace() {
  acceptWorkspace(await run(api.workspace()));
  if (!projectId || !workspace.projects.some(p => p.id === projectId)) { const p = workspace.projects.find(p => p.cwd.toLowerCase() === current?.cwd?.toLowerCase()) ?? workspace.projects[0]; if (p) await selectProject(p.id, { preservePage: true }); }
  renderProjects(); if (!settingsDirty) fillSettings(); updateActivity();
}
$('add-project').onclick = act(async () => { const p = await run(api.addProject()); if (p) { await refreshWorkspace(); await selectProject(p.id); } });
$('remove-project').onclick = act(async () => { await run(api.removeProject(projectId)); projectId = null; await refreshWorkspace(); });
$('new-thread').onclick = act(async () => { await run(api.newThread(projectId)); await refreshThreads(); });
$('resume').onclick = act(async () => { if (selected) await run(api.resumeThread(projectId,selected.id)); });
$('rename').onclick = act(async () => { if (!selected) return; await run(api.renameThread(selected.id,$('thread-title').value)); selected.name = $('thread-title').value.trim(); const t = threads.find(t => t.id === selected.id); if (t) t.name = selected.name; renderThreads(); notice('对话已重命名。'); });
$('refresh').onclick = act(() => refreshThreads()); $('more-threads').onclick = act(() => refreshThreads(true)); $('more-history').onclick = act(() => loadHistory(true));
$('search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshThreads(),250); };
function showSettings() { $('settings').hidden = false; $('conversations').hidden = true; $('settings-tab').setAttribute('aria-pressed','true'); renderProjects(); if (!settingsDirty) fillSettings(); }
$('settings-tab').onclick = showSettings;
$('tts-resident').onchange = act(async () => { const enabled = $('tts-resident').checked; try { await saveSpeechChoice({ttsResident:enabled}); } finally { updateSpeechStatus(); } });
$('cancel-resource').onclick = act(async () => { await run(api.cancelDownload()); });
$('tts-engine').onchange = act(() => saveSpeechChoice({ttsEngine:$('tts-engine').value}));
$('qwen-voice').onchange = act(() => saveSpeechChoice({qwenVoice:$('qwen-voice').value}));
$('auto-speak').onchange = act(() => saveSpeechChoice({autoSpeak:$('auto-speak').checked}));
$('prepare-speech').onchange = act(() => saveSpeechChoice({prepareSpeech:$('prepare-speech').checked}));
$('completion-sound').onchange = act(() => saveSpeechChoice({completionSound:$('completion-sound').checked}));
$('preview-completion-sound').onclick = act(() => run(api.previewCompletionSound()));
$('retry-tts').onclick = act(() => saveSpeechChoice({ttsResident:true}));
$('choose-qwen').onclick = act(async () => { acceptWorkspace(await run(api.chooseQwen())); updateSpeechStatus(); });
$('use-existing-data').onclick = act(() => run(api.useData()));
$('save-settings').onclick = act(saveSettings); $('preview-voice').onclick = act(async () => { await saveSettings(); await run(api.previewVoice()); }); $('refresh-microphones').onclick = act(refreshDevices);
$('settings').addEventListener('change',event => { if (!['model','effort','tts-resident','tts-engine','qwen-voice','auto-speak','prepare-speech','completion-sound'].includes(event.target.id)) settingsDirty = true; });
$('model').onchange = act(async () => { await run(api.chooseModel($('model').value)); }); $('effort').onchange = act(async () => { await run(api.chooseEffort($('effort').value)); });
$('close').onclick = () => api.windowAction('hide-workbench'); $('back-chat').onclick = () => api.windowAction('show-chat');
window.addEventListener('blur', () => { if (document.activeElement?.matches('#shortcuts input,#remote-keys input')) document.activeElement.blur(); });
document.addEventListener('keydown',e => {
  if (e.isComposing) return;
  if (e.key === 'Escape') { if (!$('settings').hidden && projectId) selectProject(projectId).catch(() => {}); else api.windowAction('hide-workbench'); }
  if (['ArrowDown','ArrowUp'].includes(e.key) && e.target.matches('.thread-row,.project-row')) { e.preventDefault(); const siblings = [...e.target.parentElement.querySelectorAll('button')]; const i = siblings.indexOf(e.target); siblings[(i+(e.key==='ArrowDown'?1:-1)+siblings.length)%siblings.length]?.focus(); }
});
api.onState(state => { const wasReady = available(), changedModel = current?.model !== state.model || current?.effort !== state.effort; current = state; updateActivity(); if (changedModel) fillModels(); if (ready && !wasReady && available()) refreshWorkspace().then(() => refreshThreads()).catch(() => {}); });
api.onWorkspace(value => { const settingsChanged = JSON.stringify(value.settings) !== JSON.stringify(workspace.settings); if (!acceptWorkspace(value) || !ready) return; renderProjects(); if (!projectId) refreshWorkspace().catch(() => {}); if (settingsChanged && !settingsDirty) fillSettings(); else updateSpeechStatus(); });
api.onWorkbenchRefresh(page => { refreshWorkspace().then(() => { if (page === 'speech') { showSettings(); $('voice-downloads').scrollIntoView({block:'start'}); } else if ($('settings').hidden) return refreshThreads(); }).catch(() => {}); });
try { current = await run(api.snapshot()); await refreshWorkspace(); ready = true; } catch { ready = true; }
import inputActions from '../backend/input-actions.cjs';
