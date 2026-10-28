import { renderReply } from './reply-document.mjs';
import { isTaskBusy } from '../backend/task-state.mjs';
import characters from '../backend/character-profiles.cjs';
import stills from '../backend/still-settings.cjs';
import catalog from '../backend/agent-catalog.cjs';
import { populateAgentPicker } from './agent-picker.mjs';
import { installRemoteSettings, installRemoteNavigation } from './remote-ui.mjs';
import { installSettingsNavigation } from './settings-navigation.mjs';
const api = window.companion, $ = id => document.getElementById(id);
installRemoteSettings(api); installRemoteNavigation(api,{notice:text=>notice(text)});
const settingsNavigation = installSettingsNavigation(document);
populateAgentPicker($('agent-select'));
let workspace = { projects: [], settings: {} }, current, projectId, selected, threads = [], listCursor, historyCursor, listVersion = 0, historyVersion = 0, noticeTimer, searchTimer, settingsDirty = false, ready = false;
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
for (const [id, voice] of Object.entries(characters.QWEN_VOICES)) $('qwen-voice').append(Object.assign(node('option', voice.label), { value: id }));
function notice(text) { clearTimeout(noticeTimer); $('notice').textContent = text; $('notice').hidden = !text; if (text) noticeTimer = setTimeout(() => $('notice').hidden = true, 10000); }
async function run(promise) { try { const r = await promise; if (!r?.ok) throw new Error(r?.error || '操作未完成。'); return r.value; } catch (e) { notice(e.message); throw e; } }
const act = action => event => { Promise.resolve().then(() => action(event)).catch(() => {}); };
// A completed unload event may arrive before the older IPC save response.
// Never replace a newer snapshot with that stale response.
function acceptWorkspace(value) { if ((value.version ?? 0) < (workspace.version ?? 0)) return false; workspace = value; return true; }
const busy = () => isTaskBusy(current);
const available = () => current?.connection === 'ready' && catalog.isCliAgent(current?.provider);
function updateActivity() {
  const name = catalog.agentName(current?.provider);
  const connection = current?.connection;
  $('connection').textContent = current?.provider === 'dots' ? '请选择一个 CLI Agent' : connection === 'ready' ? `${name} · 已连接` : connection === 'authentication' ? `${name} · 需要登录` : connection === 'error' ? `${name} · 连接需要处理` : `正在连接 ${name}…`;
  $('connection').title = connection === 'ready' ? `${name} · 本机工作区\n${current?.cwd || ''}` : current?.error || $('connection').textContent;
  $('connection').dataset.state = connection || 'connecting';
  $('agent-select').value = current?.provider ?? 'codex';
  $('agent-select').disabled = busy() || current?.connection === 'connecting';
  $('agent-reconnect').disabled = busy() || current?.connection === 'connecting';
  $('agent-help').textContent = !available() ? [current?.error, current?.loginHelp].filter(Boolean).join('\n\n') : '';
  $('agent-details').hidden = !$('agent-help').textContent;
  $('permission-hint').textContent = current?.permissionHint || '';
  $('new-thread').disabled = busy() || !available() && !current?.canStartNew || !projectId;
  $('resume').disabled = busy() || !available() || !selected;
  $('rename').disabled = !available() || !selected;
  $('busy-note').hidden = !busy(); $('model').disabled = busy() || !available(); $('effort').disabled = busy() || !available() || !(current?.models?.find(m => m.model === current.model)?.efforts?.length);
}
function renderProjects() {
  const host = $('projects'), focusedId = host.contains(document.activeElement) ? document.activeElement.dataset.projectId : undefined;
  host.replaceChildren();
  for (const p of workspace.projects) {
    const b = node('button', undefined, 'project-row'); b.setAttribute('aria-pressed', String(p.id === projectId && $('settings').hidden)); b.title = p.cwd;
    b.dataset.projectId = p.id;
    b.append(node('strong', p.name), node('small', p.cwd)); b.addEventListener('click', act(() => selectProject(p.id))); host.append(b);
    if (p.id === focusedId) b.focus({preventScroll:true});
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
    const result = await run(api.listThreads(id, append ? listCursor : null, $('search').value, current.provider));
    if (version !== listVersion || id !== projectId) return;
    threads = append ? [...threads, ...result.data.filter(v => !threads.some(t => t.id === v.id))] : result.data;
    listCursor = result.nextCursor; renderThreads();
  } catch { if (version === listVersion && !append) $('threads').replaceChildren(node('p', '暂时无法读取。连接恢复后点击「刷新」。', 'empty-list')); }
}
function renderThreads() {
  const host = $('threads'), focusedId = host.contains(document.activeElement) ? document.activeElement.dataset.threadId : undefined;
  host.replaceChildren();
  for (const t of threads) {
    const b = node('button', undefined, 'thread-row'); b.setAttribute('aria-pressed', String(t.id === selected?.id)); b.title = t.name;
    b.dataset.threadId = t.id;
    const date = new Date(t.updatedAt * 1000); b.append(node('strong', t.name), node('small', `${t.id === current?.threadId ? '当前 · ' : ''}${Number.isNaN(+date) ? '' : date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`));
    b.addEventListener('click', act(() => selectThread(t))); host.append(b);
    if (t.id === focusedId) b.focus({preventScroll:true});
  }
  if (!threads.length) $('threads').append(node('p', $('search').value ? '没有匹配的对话。' : '这个项目还没有对话。点击「新对话」开始。', 'empty-list'));
  $('more-threads').hidden = !listCursor;
}
async function selectThread(t) {
  selected = t; renderThreads(); $('detail').hidden = false; $('empty-detail').hidden = true; $('thread-title').value = t.name; $('thread-info').textContent = `${catalog.agentName(current?.provider)} · ${t.id.slice(-8)}${current?.renameLocal ? ' · 名称仅在 Rin 保存' : ''}`; updateActivity();
  $('history').replaceChildren(node('p', '正在读取历史…', 'hint')); historyCursor = null; $('more-history').hidden = true; await loadHistory();
}
async function loadHistory(older = false) {
  if (!selected) return; const id = selected.id, version = ++historyVersion;
  try {
    const result = await run(api.history(id, older ? historyCursor : null, current.provider));
    if (version !== historyVersion || selected?.id !== id) return;
    if (!older) $('history').replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const turn of result.turns) for (const item of turn.items ?? []) {
      if (!['userMessage','agentMessage'].includes(item.type)) continue;
      const text = item.type === 'agentMessage' ? item.text : (item.content ?? []).filter(v => v.type === 'text').map(v => v.text).join('\n');
      if (!text) continue;
      const name = catalog.agentName(current?.provider);
      const article = node('article', undefined, 'history-message'); article.append(node('p', item.type === 'userMessage' ? '你' : item.phase === 'commentary' ? `${name} · 进度` : name, 'role'));
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
function fillVoices() {
  const s = workspace.settings;
  $('qwen-voice').value = s.qwenVoice || characters.characterProfile(s.character).qwenVoice;
  $('voice').value = String(s.voice);
  if (!$('voice').value) { const o = node('option',`${s.voice >= 58 ? '男声' : '女声'} · ${s.voice}`); o.value = s.voice; $('voice').append(o); $('voice').value = s.voice; }
}
function updateCharacterStatus() {
  const profile = characters.characterProfile(workspace.settings.character), status = workspace.wallpaper;
  const requested = characters.characterProfile(status?.character);
  for (const radio of document.querySelectorAll('[name="wallpaper-character"]')) radio.checked = radio.value === (status?.phase === 'loading' ? requested.id : profile.id);
  $('character-status').dataset.phase = status?.phase || '';
  $('character-status').textContent = status?.phase === 'error' ? status.error : status?.phase === 'loading' ? `正在载入${requested.label}…` : `当前人物：${profile.label}`;
  $('retry-character').hidden = status?.phase !== 'error';
  $('retry-character').textContent = `重试加载${requested.label}`;
}
async function saveCharacter(character) {
  const radios = [...document.querySelectorAll('[name="wallpaper-character"]')];
  for (const radio of radios) radio.disabled = true;
  $('retry-character').disabled = true;
  $('save-settings').disabled = true;
  try {
    acceptWorkspace(await run(api.saveSettings({ character, wallpaperKind: 'artwork' })));
    fillVoices(); updateSpeechStatus();
  } finally {
    updateCharacterStatus();
    for (const radio of radios) radio.disabled = false;
    $('retry-character').disabled = false;
    $('save-settings').disabled = false;
  }
}
function fillSettings() {
  // Replacing a focused input does not reliably emit blur. Preserve the key
  // learner through backend updates until the user explicitly leaves it.
  if (document.activeElement?.matches('#shortcuts input,#remote-keys input')) { updateSpeechStatus(); return; }
  const s = workspace.settings; $('auto-speak').checked = s.autoSpeak; $('speed').value = String(s.speed); $('remote-enabled').checked = s.remoteEnabled;
  fillVoices();
  fillStills();
  keyFields('shortcuts',s.shortcuts); keyFields('remote-keys',s.remoteKeys); fillModels();
  $('tts-engine').value = s.ttsEngine || 'qwen';
  updateSpeechStatus();
  refreshDevices().catch(() => {}); settingsDirty = false;
}
function updateSpeechStatus() {
  updateCharacterStatus();
  updateStillStatus();
  updateAmbienceStatus();
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
  const active = ['downloading','verifying','installing','runtime','loading'].includes(resource.phase);
  for (const id of ['tts-resident','tts-engine','choose-qwen']) $(id).disabled = active;
  const format = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${Math.ceil(bytes / 1024 ** 2)} MiB`;
  for (const pack of resource.packs) {
    let row = [...host.children].find(row => row.dataset.resource === pack.id);
    if (!row) {
      row = node('div', undefined, 'setting-row'); row.dataset.resource = pack.id;
      const description = node('span', undefined, 'resource-description');
      description.append(node('strong', pack.label), node('span', undefined, 'hint'));
      row.append(description, node('button'));
      row.lastChild.onclick = act(async () => { acceptWorkspace(await run(row.lastChild.dataset.action === 'unload' ? api.unloadResource(pack.id) : api.downloadResource(pack.id))); updateResourceStatus(); }); host.append(row);
    }
    const installed = pack.installed || (pack.id === 'asr' ? speech.asr : speech.engines?.[pack.id]);
    const loaded = pack.id === 'asr' ? speech.loaded?.includes('asr') : speech.engine === pack.id && speech.loaded?.includes('tts');
    row.firstChild.firstChild.textContent = pack.label;
    row.firstChild.lastChild.textContent = loaded ? '已载入' : installed ? '已下载 · 未载入' : `模型 ${format(pack.bytes)} · Hugging Face${pack.runtimeBytes ? `；首次另需约 ${format(pack.runtimeBytes)} 运行依赖` : ''}`;
    row.lastChild.dataset.action = loaded ? 'unload' : 'load';
    row.lastChild.textContent = active && resource.id === pack.id ? (resource.phase === 'loading' ? '正在载入…' : '正在准备…') : loaded ? '释放模型' : installed ? '载入模型' : resource.id === pack.id && ['error','cancelled'].includes(resource.phase) ? '继续下载并载入' : '下载并载入模型';
    row.lastChild.disabled = active;
  }
  const phases = {downloading:'正在下载',verifying:'正在校验',installing:'正在准备模型文件',runtime:'正在准备语音运行环境',loading:'正在载入模型',ready:'模型已载入，可以使用语音功能',cancelled:'已取消，已下载的内容会保留'};
  $('resource-progress').hidden = resource.phase === 'idle';
  $('resource-progress').textContent = resource.error || `${resource.stage || phases[resource.phase] || ''}${resource.phase === 'downloading' && resource.total ? ` · ${Math.min(100,Math.floor(100 * resource.received / resource.total))}% · ${format(resource.received)} / ${format(resource.total)}` : ''}`;
  $('resource-meter').hidden = !active;
  if (resource.phase === 'downloading' && resource.total) $('resource-meter').value = Math.min(1, resource.received / resource.total);
  else $('resource-meter').removeAttribute('value');
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
$('new-thread').onclick = act(async () => { await run(api.newThread(projectId, current.provider)); await refreshThreads(); });
$('resume').onclick = act(async () => { if (selected) await run(api.resumeThread(projectId,selected.id,current.provider)); });
$('rename').onclick = act(async () => { if (!selected) return; const target = selected, name = $('thread-title').value.trim(), provider = current.provider; await run(api.renameThread(target.id,name,provider)); if (current.provider !== provider || selected !== target) return; target.name = name; const t = threads.find(t => t.id === target.id); if (t) t.name = name; renderThreads(); notice(current.renameLocal ? '已更新 Rin 中的会话名称。' : '对话已重命名。'); });
$('agent-select').onchange = act(async () => { try { await run(api.chooseProvider($('agent-select').value)); } finally { updateActivity(); } });
$('agent-reconnect').onclick = act(() => run(api.reconnect()));
$('refresh').onclick = act(() => refreshThreads()); $('more-threads').onclick = act(() => refreshThreads(true)); $('more-history').onclick = act(() => loadHistory(true));
$('search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshThreads(),250); };
function showSettings() { $('settings').hidden = false; $('conversations').hidden = true; $('settings-tab').setAttribute('aria-pressed','true'); renderProjects(); if (!settingsDirty) fillSettings(); }
$('settings-tab').onclick = showSettings;
for (const radio of document.querySelectorAll('[name="wallpaper-character"]')) radio.onchange = act(() => saveCharacter(radio.value));
$('retry-character').onclick = act(() => saveCharacter(workspace.wallpaper.character));
let stillSaving = 0;
let previewCharacter;
function fillStills() {
  if(stillSaving) return;
  const s=stills.stillSettings(workspace.settings);
  const animated=workspace.settings.character==='female' && s.wallpaperMotion;
  $('wallpaper-motion').checked=s.wallpaperMotion;
  $('wallpaper-motion').disabled=workspace.settings.character!=='female';
  $('motion-hint').textContent=workspace.settings.character==='male'?'男生使用静态壁纸。':'工作与陪伴各自循环播放，对话时在动作接点转向你。关闭后使用静态姿态。';
  $('still-pose').value=s.stillPose;
  for(const option of $('still-pose').options) option.disabled=(workspace.settings.character==='male' || animated) && !['auto','work','attention'].includes(option.value);
  if(animated && !['auto','work','attention'].includes(s.stillPose)) $('still-pose').value='auto';
  if(workspace.settings.character==='male' && !['auto','work','attention'].includes(s.stillPose)) $('still-pose').value='work';
  const character=workspace.settings.character==='male'?'male':'female';
  if(previewCharacter!==`${character}:${animated}`) {
    previewCharacter=`${character}:${animated}`;
    $('still-previews').replaceChildren();
    for(const pose of character==='male'||animated?['work','attention']:stills.POSES) {
      const label=character==='male'?(pose==='work'?'专注工作':'看向你'):stills.POSE_LABELS[pose];
      const button=node('button'); button.type='button'; button.dataset.pose=pose; button.setAttribute('aria-label','固定查看：'+label);
      const image=node('img'); image.alt=''; image.src=animated?`app://local/assets/motion/female/${pose==='work'?'work':'user'}.png`:`app://local/assets/stills/${character==='female'?'female-v2':'male'}/${pose}.png`;
      button.append(image,node('span',label)); button.onclick=act(()=>saveStillSetting({stillPose:pose})); $('still-previews').append(button);
    }
  }
  for(const button of $('still-previews').children) button.setAttribute('aria-pressed',String(button.dataset.pose===$('still-pose').value));
  updateStillStatus();
  $('ambience-enabled').checked=s.ambienceEnabled;
  for(const [field,key] of [['rain-volume','rainVolume'],['key-volume','keyVolume']]) { $(field).value=Math.round(s[key]*100); $(field+'-label').textContent=$(field).value+'%'; }
  updateAmbienceStatus();
}
function updateStillStatus() {
  const character=workspace.settings.character==='male'?'male':'female', shown=workspace.wallpaper;
  const poseLabel=character==='male'?(shown?.pose==='attention'?'看向你':'专注工作'):stills.POSE_LABELS[shown?.pose];
  $('still-status').textContent=shown?.character===character && poseLabel && shown?.activity
    ? `当前画面：${poseLabel} · ${shown.motionPhase==='transition'?'正在转身':shown.model==='motion-clips' && shown.motionPhase==='loop'?'循环播放 · ':''}${shown.motionPhase==='transition'?'':stills.ACTIVITY_LABELS[shown.activity] || '等待状态更新'}` : '等待壁纸画面就绪…';
}
function updateAmbienceStatus() {
  const status=workspace.ambience;
  $('ambience-status').textContent=status?.phase==='error'?status.error:workspace.wallpaperPaused?'壁纸和环境音已暂停。':!workspace.settings.ambienceEnabled?'环境音已关闭。':status?.phase==='loading'?'正在载入声音…':status?.phase==='ready'?'已开启 · 小雨和轻敲将随当前状态播放。':'等待壁纸声音就绪…';
  $('retry-ambience').hidden=status?.phase!=='error';
  $('pause-stills').setAttribute('aria-pressed',String(!!workspace.wallpaperPaused));
  $('pause-stills').textContent=workspace.wallpaperPaused?'继续壁纸与环境音':'暂停壁纸与环境音';
}
async function saveStillSetting(patch) {
  stillSaving++;
  try { acceptWorkspace(await run(api.saveSettings(patch))); }
  finally { stillSaving--; fillStills(); }
}
$('still-pose').onchange=act(()=>saveStillSetting({stillPose:$('still-pose').value}));
$('wallpaper-motion').onchange=act(()=>saveStillSetting({wallpaperMotion:$('wallpaper-motion').checked}));
$('ambience-enabled').onchange=act(()=>saveStillSetting({ambienceEnabled:$('ambience-enabled').checked}));
for(const [field,key] of [['rain-volume','rainVolume'],['key-volume','keyVolume']]) {
  $(field).oninput=()=>{ $(field+'-label').textContent=$(field).value+'%'; };
  $(field).onchange=act(()=>saveStillSetting({[key]:Number($(field).value)/100}));
}
$('retry-ambience').onclick=act(async()=>acceptWorkspace(await run(api.wallpaperControl('retry-audio'))));
$('pause-stills').onclick=act(async()=>acceptWorkspace(await run(api.wallpaperControl('pause',!workspace.wallpaperPaused))));
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
$('settings').addEventListener('change',event => { if (!event.target.closest('#remote-settings,#ambience-settings') && event.target.name !== 'wallpaper-character' && !['wallpaper-motion','still-pose','model','effort','tts-resident','tts-engine','qwen-voice','auto-speak','prepare-speech','completion-sound'].includes(event.target.id)) settingsDirty = true; });
$('model').onchange = act(async () => { await run(api.chooseModel($('model').value)); }); $('effort').onchange = act(async () => { await run(api.chooseEffort($('effort').value)); });
$('close').onclick = () => api.windowAction('hide-workbench'); $('back-chat').onclick = () => api.windowAction('show-chat');
window.addEventListener('blur', () => { if (document.activeElement?.matches('#shortcuts input,#remote-keys input')) document.activeElement.blur(); });
document.addEventListener('keydown',e => {
  if (e.isComposing) return;
  if (e.key === 'Escape') { if (!$('settings').hidden && projectId) selectProject(projectId).catch(() => {}); else api.windowAction('hide-workbench'); }
  if (['ArrowDown','ArrowUp'].includes(e.key) && e.target.matches('.thread-row,.project-row')) { e.preventDefault(); const siblings = [...e.target.parentElement.querySelectorAll('button')]; const i = siblings.indexOf(e.target); siblings[(i+(e.key==='ArrowDown'?1:-1)+siblings.length)%siblings.length]?.focus(); }
});
api.onState(state => {
  const wasReady = available(), changedProvider = current?.provider !== state.provider;
  const changedModel = changedProvider || current?.model !== state.model || current?.effort !== state.effort || JSON.stringify(current?.models) !== JSON.stringify(state.models);
  current = state;
  if (changedProvider || state.connection === 'connecting' && wasReady) {
    listVersion++; historyVersion++; selected = null; threads = []; listCursor = null; historyCursor = null;
    $('threads').replaceChildren(); $('history').replaceChildren(); $('detail').hidden = true; $('empty-detail').hidden = false;
    $('more-threads').hidden = true; $('more-history').hidden = true;
  }
  updateActivity(); if (changedModel) fillModels();
  if (ready && (changedProvider || !wasReady) && available()) refreshWorkspace().then(() => refreshThreads()).catch(() => {});
});
api.onWorkspace(value => { const settingsChanged = JSON.stringify(value.settings) !== JSON.stringify(workspace.settings), characterChanged = value.settings.character !== workspace.settings.character; if (!acceptWorkspace(value) || !ready) return; renderProjects(); if (!projectId) refreshWorkspace().catch(() => {}); if (characterChanged) { fillVoices(); fillStills(); } if (settingsChanged && !settingsDirty) fillSettings(); else updateSpeechStatus(); });
api.onWorkbenchRefresh(page => { refreshWorkspace().then(() => { if (['speech','remote','wallpaper'].includes(page)) { showSettings(); settingsNavigation.show(page === 'remote' ? 'remote-settings' : page === 'wallpaper' ? 'wallpaper-settings' : 'playback-settings'); } else if ($('settings').hidden) return refreshThreads(); }).catch(() => {}); });
try { current = await run(api.snapshot()); await refreshWorkspace(); ready = true; } catch { ready = true; }
import inputActions from '../backend/input-actions.cjs';
