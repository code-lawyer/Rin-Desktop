import { startAvatar } from './avatar.js';
import { startWallpaperRenderer } from './wallpaper-renderer.js';
import { currentReply } from './current-reply.mjs';
import { renderReply } from './reply-document.mjs';
import { installSpeech } from './speech-ui.js';
import { installCompletionSound } from './completion-sound.js';
import { createDraftSession } from './draft-session.mjs';
import { isTaskBusy } from '../backend/task-state.mjs';
import catalog from '../backend/agent-catalog.cjs';
import { populateAgentPicker } from './agent-picker.mjs';
import { installRemoteNavigation } from './remote-ui.mjs';
import { installComposerControls } from './composer-controls.mjs';

const $ = id => document.getElementById(id);
const api = window.companion;
populateAgentPicker($('provider-select'), { dots: true });
const isAvatar = new URLSearchParams(location.search).get('view') === 'avatar';
const isWallpaper = new URLSearchParams(location.search).get('view') === 'wallpaper';
const isVisual = isAvatar || isWallpaper;
let wallpaper;
$(isWallpaper ? 'wallpaper-view' : isAvatar ? 'avatar-view' : 'chat-view').hidden = false;
let current, sending = false, composing = false, approvalKey = '', modelKey = '';
let pendingReply = false, previousUserId = null, replyKey = '', replyText = null, replyComplete = null;
let measureTimer, lastMeasurement = '';
let draftTimer, speechControls, composerControls;
let quitRequest = null;
const seenSubmissions = new Set();
const drafts = createDraftSession({ request: (...args) => api.draft(...args), getText: () => $('prompt').value,
  setText: text => { $('prompt').value = text; growPrompt(); }, error });
function saveDraft() { clearTimeout(draftTimer); return drafts.save(); }
function installDraftShutdown() {
  api.onDraftFlush?.(async id => {
    quitRequest = id; $('prompt').readOnly = true; clearTimeout(draftTimer); composerControls?.refresh();
    try {
      await speechControls?.cancelCapture();
      await drafts.flush();
      if (quitRequest === id) api.draftFlushed(id, { ok: true });
    } catch (failure) {
      if (quitRequest === id) api.draftFlushed(id, { ok: false, error: failure.message });
    }
  });
  api.onDraftFlushCancelled?.(message => {
    quitRequest = null; $('prompt').readOnly = false; composerControls?.refresh(); error(message); $('prompt').focus();
  });
}
function restoreDraft(state) {
  if (isVisual) return;
  // Bind immediately on provider changes, including their connecting state.
  drafts.restore({ provider:state.provider ?? 'codex',cwd:state.cwd,threadId:state.threadId }, { creatingThread: (sending || ['starting', 'working', 'waiting', 'stopping'].includes(state.status)) && state.provider !== 'dots' });
}
const busy = () => isTaskBusy(current);

function error(message) {
  if (isVisual) return;
  const changed = $('error-banner').textContent !== (message ?? '');
  $('error-banner').textContent = message ?? ''; $('error-banner').hidden = !message;
  if (message && changed) requestAnimationFrame(() => ($('login-panel').hidden ? $('error-banner') : $('login-panel')).scrollIntoView({ block: 'nearest' }));
  scheduleMeasure();
}
async function call(promise) {
  const result = await promise;
  if (!result?.ok) { error(result?.error ?? '操作未完成。'); return { ok: false }; }
  return result;
}
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

function renderMessages(messages) {
  const host = $('bubble-content');
  const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 90;
  const reply = currentReply(messages);
  const finishedAtBottom = replyComplete === false && reply.complete && atBottom;
  if (pendingReply && reply.userId !== previousUserId) pendingReply = false;
  const text = pendingReply ? '' : reply.text;
  const changedTurn = reply.key !== replyKey;
  $('welcome').hidden = !!text;
  $('welcome').textContent = busy() ? '正在为你处理…' : reply.userId ? '可以接着问我。' : '想一起做点什么？';
  $('current-message').hidden = !text; $('current-message').dataset.messageId = reply.messageId ?? '';
  if (replyText !== text || replyComplete !== reply.complete) {
    renderReply($('reply-body'), text, href => call(api.openLink(href)));
    if (text && !reply.complete) $('reply-body').append(element('span', 'stream-caret'));
    replyText = text; replyComplete = reply.complete;
  }
  replyKey = reply.key;
  if (changedTurn || finishedAtBottom) host.scrollTop = 0;
  else if (atBottom) host.scrollTop = host.scrollHeight;
  scheduleMeasure();
}
function scheduleMeasure() {
  if (isVisual || measureTimer) return;
  measureTimer = setTimeout(() => { measureTimer = null; measureBubble(); }, 45);
}
function measureBubble() {
  if ($('chat-view').dataset.reading === 'true') return;
  const outer = getComputedStyle($('chat-view')), card = getComputedStyle($('bubble-card'));
  const number = value => parseFloat(value) || 0;
  const height = node => {
    if (node.hidden) return 0;
    const style = getComputedStyle(node);
    return node.getBoundingClientRect().height + number(style.marginTop) + number(style.marginBottom);
  };
  const replyStyle = getComputedStyle($('messages'));
  const textHeight = Math.max(number(replyStyle.minHeight), $('reply-content').getBoundingClientRect().height) + number(replyStyle.marginTop) + number(replyStyle.marginBottom);
  const chrome = number(outer.paddingTop) + number(outer.paddingBottom) + number(card.paddingTop) + number(card.paddingBottom) + 2;
  const fixed = [document.querySelector('.bubble-header'), $('current-target'), $('context-panel'), $('approval'), $('login-panel'), $('error-banner'), $('submission-panel'), $('activity-line'), $('reply-player'), $('composer')].reduce((sum, node) => sum + height(node), 0);
  const size = { width: (replyText?.length ?? 0) > 900 ? 560 : 440, height: Math.ceil(chrome + fixed + textHeight + 3), viewport: { width: innerWidth, height: innerHeight } };
  const key = JSON.stringify(size);
  if (key !== lastMeasurement) { lastMeasurement = key; api.resizeBubble(size); }
}
function growPrompt() {
  $('prompt').style.height = '0px'; $('prompt').style.height = Math.min(140, Math.max(38, $('prompt').scrollHeight)) + 'px'; scheduleMeasure();
  composerControls?.refresh();
}
function renderApproval(approvals) {
  const host = $('approval');
  const key = JSON.stringify(approvals); if (key === approvalKey) return; approvalKey = key;
  host.replaceChildren(); host.hidden = !approvals.length; if (!approvals.length) return;
  const request = approvals[0];
  host.dataset.kind = request.kind;
  const name = catalog.agentName(current?.provider);
  const titles = { command: `${name} 需要确认这次操作`, files: `${name} 需要文件修改权限`, permissions: `${name} 需要额外权限`, questions: `${name} 想请你补充信息` };
  host.append(element('h3', '', titles[request.kind]));
  const body = element('div', 'approval-body'); host.append(body);
  if (approvals.length > 1) body.append(element('p', '', `还有 ${approvals.length - 1} 个请求等待处理`));
  if (request.reason) body.append(element('p', '', request.reason));
  if (request.cwd) body.append(element('p', 'approval-directory', `目录：${request.cwd}`));
  if (request.command || request.details) body.append(element('pre', '', [request.command, request.details].filter(Boolean).join('\n\n')));
  const actions = element('div', 'approval-actions');
  const fields = {};
  if (request.kind === 'questions') {
    for (const question of request.questions) {
      const label = element('label', '', question.question); const field = element('input');
      field.type = question.secret ? 'password' : 'text'; field.maxLength = 8000; field.setAttribute('aria-label', question.question);
      field.placeholder = question.required === false ? '可选' : question.fieldType === 'boolean' ? 'true 或 false' : '';
      fields[question.id] = { field, selected: null };
      if (question.options.length) {
        const select = element('select'); select.setAttribute('aria-label', `${question.header}选项`);
        select.multiple = !!question.multiSelect;
        if (!select.multiple) { const empty = element('option', '', '选择建议答案，或在下方输入'); empty.value = ''; select.append(empty); }
        for (const option of question.options) { const node = element('option', '', option.label); node.value = option.value ?? option.label; node.title = option.description ?? ''; select.append(node); }
        if (select.multiple) { fields[question.id].selected = select; field.placeholder = '补充答案（可选）'; }
        else select.addEventListener('change', () => { field.value = select.value; });
        label.append(select);
      }
      label.append(field); body.append(label);
    }
  }
  function action(label, answer, primary = false) {
    const button = element('button', primary ? 'primary' : '', label); button.type = 'button';
    if (request.allowDisabled && answer?.decision === 'accept') button.disabled = true;
    button.addEventListener('click', async () => {
      const buttons = [...actions.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
      await call(api.respond(request.id, typeof answer === 'function' ? answer() : answer));
      buttons.forEach(b => b.disabled = false);
      if (request.allowDisabled) actions.querySelector('.primary')?.setAttribute('disabled', '');
    }); actions.append(button);
  }
  if (request.kind === 'questions') action('提交回答', () => ({ answers: Object.fromEntries(Object.entries(fields).map(([id, input]) => [id, input.selected ? [...input.selected.selectedOptions].map(o => o.value).concat(input.field.value.trim() ? [input.field.value.trim()] : []) : input.field.value])) }), true);
  else if (request.kind === 'permissions') { action('本次允许', { allow: true }, true); action('拒绝', { allow: false }); }
  else { action(request.kind === 'files' && request.details.includes('本会话') ? '允许所示目录范围' : '允许这次', { decision: 'accept' }, true); action('拒绝', { decision: 'decline' }); action('停止任务', { decision: 'cancel' }); }
  if (request.kind === 'questions' || request.kind === 'permissions') {
    const stop = element('button', '', '停止任务'); stop.type = 'button'; stop.addEventListener('click', () => call(api.interrupt())); actions.append(stop);
  }
  host.append(actions);
}
function render(state) {
  current = state;
  restoreDraft(state);
  const active = busy();
  const dots = state.provider === 'dots';
  const name = catalog.agentName(state.provider), codex = state.provider === 'codex';
  const signal = state.connection === 'error' ? 'error' : active ? 'working' : state.connection === 'ready' ? 'ready' : '';
  if (isWallpaper) { wallpaper?.setBackendState(state); return; }
  if (isAvatar) {
    const status = state.connection === 'error' ? '连接需要处理' : state.connection !== 'ready' ? `正在连接 ${name}` : state.status === 'waiting' ? '需要你确认' : active ? '正在工作' : '已就绪';
    $('avatar-canvas').title = `${status} · 点击对话，右键设置或退出`; return;
  }
  $('connection-signal').className = `signal ${signal}`;
  $('speaker-name').textContent = dots ? '凛 · DOT' : name;
  $('prompt').setAttribute('aria-label', dots ? '给凛的消息' : `给 ${name} 的任务`);
  $('prompt').placeholder = dots ? '和凛说点什么，或继续追问…' : '告诉我你的任务，或继续追问…';
  $('prompt').disabled = dots && !state.threadId;
  const showLogin = !dots && ['authentication', 'error'].includes(state.connection);
  const loginOpened = $('login-panel').hidden && showLogin;
  $('login-panel').hidden = !showLogin;
  $('login-help').textContent = state.loginHelp || '使用你自己的 ChatGPT 账户登录 Codex。凭据由官方 CLI 保存在本机。';
  $('login-title').textContent = `${name} · 连接帮助`;
  $('login-button').hidden = !codex || state.connection !== 'authentication';
  $('login-reconnect').hidden = codex && state.connection === 'authentication';
  $('login-reconnect').disabled = sending || active || state.connection === 'connecting';
  $('login-button').disabled = !!state.loginPending;
  $('login-button').textContent = state.loginPending ? '请在浏览器完成登录…' : '在浏览器登录 ChatGPT';
  $('cancel-login-button').hidden = !state.loginPending;
  $('provider-select').value = state.provider ?? 'codex';
  $('provider-select').disabled = sending || active || state.connection === 'connecting';
  $('agent-context').hidden = dots; $('dots-help').hidden = !dots;
  $('open-dot').hidden = !dots; $('reconnect-dot').hidden = false;
  $('reconnect-dot').disabled = sending || active || state.connection === 'connecting';
  $('new-chat').hidden = dots;
  $('bubble-status').textContent = state.connection === 'error' ? '需要处理' : state.connection !== 'ready' ? '连接中' : state.status === 'waiting' ? '等待确认' : active ? '处理中' : '已就绪';
  $('bubble-status').hidden = !active && state.connection === 'ready';
  $('connection-signal').setAttribute('aria-label', $('bubble-status').textContent);
  $('connection-signal').title = $('bubble-status').textContent;
  $('connection-label').textContent = dots ? (state.connection === 'ready' ? '已连接 · 私人 dot 通道' : 'Dots 连接需要处理') : state.connection === 'ready' ? `已连接 · ${codex ? '现有 ChatGPT 登录' : state.login || 'CLI 原生认证'}` : state.connection === 'authentication' ? `${name} 需要登录` : state.connection === 'error' ? `${name} 连接需要处理` : `正在连接 ${name}`;
  $('connection-label').title = [state.version, state.permissionHint].filter(Boolean).join('\n');
  $('project-name').textContent = state.projectName; $('choose-project').title = state.cwd;
  $('current-target').hidden = dots;
  $('target-label').textContent = `${state.projectName} / ${state.threadName || '新对话'}`; $('workbench-button').title = `${state.cwd}\n打开项目与对话工作台`;
  const nextModelKey = JSON.stringify([state.provider, state.models]);
  if (nextModelKey !== modelKey) { modelKey = nextModelKey; $('model-select').replaceChildren(); for (const model of state.models) { const option = element('option', '', model.name); option.value = model.model; $('model-select').append(option); } }
  $('model-select').value = state.model ?? '';
  $('model-select').disabled = active || state.connection !== 'ready' || state.status === 'error'; $('choose-project').disabled = false; $('new-chat').disabled = active || state.connection !== 'ready' && !state.canStartNew;
  const submission = state.submission, unresolved = ['pending', 'unknown'].includes(submission?.status);
  if (unresolved) seenSubmissions.add(submission.id);
  if (submission?.status === 'confirmed' && seenSubmissions.delete(submission.id)) drafts.consume(submission);
  $('submission-panel').hidden = !unresolved;
  $('submission-message').textContent = submission?.error || (submission?.status === 'pending' ? '正在确认是否送达。原稿已保存，请勿重复发送。' : submission?.checkMessage || '上次发送结果尚未确定。原稿已保留，请先核查会话。');
  $('submission-copy').textContent = unresolved ? submission.text : '';
  $('submission-check').disabled = active || sending || state.connection !== 'ready';
  $('submission-release').hidden = !submission?.checkedAt;
  $('submission-release').disabled = active || sending;
  $('send-button').disabled = unresolved || active || sending || state.connection !== 'ready' || state.status === 'error';
  $('stop-button').hidden = !active || state.status === 'configuring'; $('stop-button').disabled = state.status === 'stopping';
  $('stop-button').textContent = dots ? '打开凛 ↗' : '停止';
  $('activity-label').textContent = state.activity; $('session-label').textContent = state.threadId ? `${state.restored ? '已恢复' : '会话'} · ${state.threadId.slice(-8)}` : '新对话';
  $('activity-label').title = state.activity || '';
  $('session-label').hidden = !state.threadId;
  $('activity-line').hidden = !active && state.connection === 'ready';
  $('session-label').title = state.threadId ?? '';
  renderMessages(state.messages); renderApproval(state.approvals); error(state.error);
  if (loginOpened) requestAnimationFrame(() => $('login-panel').scrollIntoView({ block: 'start' }));
  speechControls?.refresh();
  composerControls?.refresh();
}

api.onState(render);
const initial = await call(api.snapshot()); if (initial.ok) render(initial.value);
if (isWallpaper) {
  startWallpaperRenderer().then(value => { wallpaper = value; if (current) wallpaper.setBackendState(current); }).catch(failure => {
    $('wallpaper-error').textContent = `壁纸加载失败：${failure.message}。Ctrl+Alt+空格仍可打开对话。`;
    $('wallpaper-error').hidden = false;
  });
} else if (isAvatar) {
  startAvatar().catch(failure => {
    $('avatar-error').textContent = `Live2D 模型未能加载：${failure.message}。对话仍可使用。`;
    $('avatar-error').hidden = false; api.hit(true);
  });
} else {
  installCompletionSound(api);
  installRemoteNavigation(api,{notice:error,compose:(action,active)=>composerControls?.action(action,active)});
  api.onRemoteText(value=>drafts.appendExternal(value).then(()=>{composerControls?.refresh();}).catch(()=>error('听写文字已保存在草稿中，请重新打开这段对话。')));
  api.workspace().then(r => { if (r.ok && !r.value.legacyDotsAvailable) $('provider-select').querySelector('[value="dots"]')?.remove(); });
  speechControls = installSpeech({ api, state: () => current, isBusy: () => busy() || sending || pendingReply, error, measure: () => {scheduleMeasure();composerControls?.refresh();}, insert: text => { const prompt = $('prompt'); prompt.value += (prompt.value && !/\s$/.test(prompt.value) ? ' ' : '') + text; drafts.edited(); growPrompt(); saveDraft(); prompt.focus(); } });
  composerControls = installComposerControls({api,drafts,submit:submitDraft,readReply:()=>speechControls.readReply(),isLocked:()=>quitRequest !== null || sending || ['pending','unknown'].includes(current?.submission?.status) || ! $('approval').hidden,isCapturing:()=>speechControls.isCapturing(),error,measure:scheduleMeasure});
  installDraftShutdown();
  api.onInputAction(action => {
    if (quitRequest !== null) return;
    if (action === 'record') speechControls.toggleCapture();
    else if (action === 'readReply') speechControls.readReply();
    else if (action === 'send') submitDraft(true);
    else if (action === 'clearDraft' || action === 'undoDraft') composerControls.action(action);
    else if (action === 'volumeUp' || action === 'volumeDown') speechControls.adjustVolume(action === 'volumeUp' ? .1 : -.1);
  });
  $('workbench-button').addEventListener('click', () => api.windowAction('workbench'));
  function showAppearance(value) {
    $('avatar-size').value = Math.round(value.scale * 100); $('avatar-size-value').textContent = `${Math.round(value.scale * 100)}%`;
    const wallpaper = value.mode === 'wallpaper';
    $('avatar-size-label').hidden = wallpaper; $('avatar-size-controls').hidden = wallpaper;
    if (wallpaper) $('interaction-help').textContent = 'Ctrl + Alt + 空格 打开或收起对话 · 托盘可暂停动画或退出；× 只收起对话。';
    scheduleMeasure();
  }
  api.onAppearance(showAppearance);
  const savedAppearance = await call(api.appearance()); if (savedAppearance.ok) showAppearance(savedAppearance.value);
  $('avatar-size').addEventListener('input', () => { const scale = Number($('avatar-size').value) / 100; $('avatar-size-value').textContent = `${Math.round(scale * 100)}%`; call(api.avatarScale(scale)); });
  $('reset-avatar').addEventListener('click', () => call(api.resetAvatar()));
  $('align-chat').addEventListener('click', () => api.windowAction('align-chat'));
  const dragHeader = $('bubble-drag');
  let chatPointer = null;
  const headerControl = target => target.closest('button, a, input, select, textarea');
  dragHeader.addEventListener('pointerdown', event => {
    if (chatPointer !== null || event.button !== 0 || headerControl(event.target) || $('chat-view').dataset.reading === 'true') return;
    event.preventDefault(); chatPointer = event.pointerId;
    dragHeader.setPointerCapture(event.pointerId); dragHeader.classList.add('is-dragging');
    api.beginChatMove({ x:event.screenX, y:event.screenY });
  });
  dragHeader.addEventListener('pointermove', event => { if (chatPointer === event.pointerId) api.moveChatTo({ x:event.screenX, y:event.screenY }); });
  const endChatDrag = () => {
    const pointer = chatPointer; chatPointer = null; dragHeader.classList.remove('is-dragging');
    if (pointer !== null) { api.endChatMove(); if (dragHeader.hasPointerCapture(pointer)) dragHeader.releasePointerCapture(pointer); }
  };
  for (const event of ['pointerup','pointercancel','lostpointercapture']) dragHeader.addEventListener(event, endChatDrag);
  window.addEventListener('blur', endChatDrag);
  dragHeader.addEventListener('dblclick', event => { if (!headerControl(event.target) && $('chat-view').dataset.reading !== 'true') api.windowAction('align-chat'); });
  api.onFocus(() => { $('prompt').focus(); scheduleMeasure(); });
  let lastLayout;
  function positionTail() {
    if (!Number.isFinite(lastLayout?.tailY)) return;
    // Native window coordinates are DIP; the renderer may use a different zoom.
    const scale = lastLayout.contentHeight > 0 ? innerHeight / lastLayout.contentHeight : 1;
    $('chat-view').style.setProperty('--tail-y', lastLayout.tailY * scale + 'px');
  }
  api.onLayout(layout => {
    lastLayout = layout;
    const shell = $('chat-view'); shell.dataset.reading = String(!!layout.fullscreen);
    if (!layout.fullscreen) shell.dataset.detached = String(!!layout.detached);
    if (layout.side) shell.dataset.side = layout.side;
    positionTail();
    $('reading-label').textContent = layout.fullscreen ? '返回气泡' : '展开阅读';
    $('reading-button').setAttribute('aria-label', layout.fullscreen ? '返回气泡' : '展开阅读');
    scheduleMeasure();
  });
  window.addEventListener('resize', () => { positionTail(); scheduleMeasure(); });
  $('reading-button').addEventListener('click', () => api.windowAction('toggle-reading'));
  $('settings-button').addEventListener('click', () => {
    $('context-panel').hidden = !$('context-panel').hidden;
    if (!$('context-panel').hidden) $('context-panel').scrollIntoView({ block: 'start' });
    $('settings-button').setAttribute('aria-expanded', String(!$('context-panel').hidden)); scheduleMeasure();
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      if ($('chat-view').dataset.reading === 'true') api.windowAction('leave-reading');
      else if (!$('context-panel').hidden) { $('context-panel').hidden = true; $('settings-button').setAttribute('aria-expanded', 'false'); scheduleMeasure(); }
      else api.windowAction('hide-chat');
    }
  });
  $('close-chat').addEventListener('click', () => api.windowAction('hide-chat'));
  $('quit-button').addEventListener('click', () => api.windowAction('quit'));
  $('new-chat').addEventListener('click', () => call(api.newConversation()));
  $('choose-project').addEventListener('click', () => call(api.chooseProject()));
  $('model-select').addEventListener('change', () => call(api.chooseModel($('model-select').value)));
  $('provider-select').addEventListener('change', async () => { await call(api.chooseProvider($('provider-select').value)); render(current); });
  $('open-dot').addEventListener('click', () => call(api.openDot()));
  $('reconnect-dot').addEventListener('click', () => call(api.reconnect()));
  $('login-button').addEventListener('click', () => call(api.login()));
  $('login-reconnect').addEventListener('click', () => call(api.reconnect()));
  $('cancel-login-button').addEventListener('click', () => call(api.cancelLogin()));
  $('stop-button').addEventListener('click', () => call(current?.provider === 'dots' ? api.openDot() : api.interrupt()));
  async function submitDraft(fromShortcut = false) {
    if (quitRequest !== null) return;
    const reject = message => { error(message); if (fromShortcut) api.windowAction('show-chat'); };
    if (['pending','unknown'].includes(current?.submission?.status)) { reject('请先核查上次发送结果，原稿已保留。'); return; }
    if (busy() || sending) { reject('当前任务尚未结束，请等待回复完成后再发送。'); return; }
    if (current?.connection !== 'ready' || current?.status === 'error') { reject('Codex 尚未就绪，草稿已保留。'); return; }
    if (speechControls?.isCapturing()) { reject('请先完成听写、等待识别结束，再按发送键。'); return; }
    if (composing) { reject('请先确认输入法中的文字，再发送。'); return; }
    const text = $('prompt').value.trim(); if (!text) { if (fromShortcut) reject('当前没有可发送的草稿。'); return; }
    const destination = { provider: current.provider, cwd: current.cwd, threadId: current.threadId };
    previousUserId = currentReply(current.messages).userId; pendingReply = true;
    sending = true; await saveDraft(); render(current);
    let restore = false, failure;
    try { const result = await api.send(text, destination); restore = !result?.ok || result.value?.cancelled; failure = result?.ok ? null : result?.error || '发送未完成，草稿已保留。'; if (result?.ok && !result.value?.pending && !restore) await drafts.consume(result.value?.submission || { text, target: destination }); }
    catch { restore = true; failure = '与桌面窗口的连接已断开。请重启桌面伙伴，草稿已保留。'; }
    finally {
      if (restore) pendingReply = false;
      sending = false; render(current); growPrompt(); saveDraft(); $('prompt').focus();
      if (failure) reject(failure);
    }
  }
  $('composer').addEventListener('submit', event => { event.preventDefault(); submitDraft(); });
  $('submission-check').addEventListener('click', () => call(api.submission('check', current.submission?.id)));
  $('submission-release').addEventListener('click', async () => {
    if (confirm('请先在会话记录中核对原稿。解除保护不会重新发送；之后手动发送仍可能重复执行。确认已核对并保留原稿？')) {
      const result = await call(api.submission('release', current.submission?.id));
      if (result.ok) await drafts.recover(result.value);
    }
  });
  $('prompt').addEventListener('compositionstart', () => { composing = true; });
  $('prompt').addEventListener('compositionend', () => { composing = false; });
  $('prompt').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!event.repeat) $('composer').requestSubmit(); }
  });
  $('prompt').addEventListener('input', () => { drafts.edited(); growPrompt(); clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft,180); });
  window.addEventListener('beforeunload',saveDraft);
  const resizeObserver = new ResizeObserver(scheduleMeasure);
  for (const id of ['reply-content', 'composer', 'context-panel', 'approval', 'login-panel']) resizeObserver.observe($(id));
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('prompt').value = button.dataset.prompt; $('prompt').focus(); }));
  $('prompt').focus(); scheduleMeasure();
}
