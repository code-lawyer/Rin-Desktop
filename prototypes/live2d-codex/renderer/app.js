import { startAvatar } from './avatar.js';
import { startWallpaper } from './wallpaper.js';
import { currentReply } from './current-reply.mjs';
import { renderReply } from './reply-document.mjs';
import { installSpeech } from './speech-ui.js';
import { installCompletionSound } from './completion-sound.js';
import { createDraftSession } from './draft-session.mjs';
import { isTaskBusy } from '../backend/task-state.mjs';

const $ = id => document.getElementById(id);
const api = window.companion;
const isAvatar = new URLSearchParams(location.search).get('view') === 'avatar';
const isWallpaper = new URLSearchParams(location.search).get('view') === 'wallpaper';
const isVisual = isAvatar || isWallpaper;
let wallpaper;
$(isWallpaper ? 'wallpaper-view' : isAvatar ? 'avatar-view' : 'chat-view').hidden = false;
let current, sending = false, composing = false, approvalKey = '', modelKey = '';
let pendingReply = false, previousUserId = null, replyKey = '', replyText = null, replyComplete = null;
let measureTimer, lastMeasurement = '';
let draftTimer, speechControls;
const drafts = createDraftSession({ request: (...args) => api.draft(...args), getText: () => $('prompt').value,
  setText: text => { $('prompt').value = text; growPrompt(); }, error });
function saveDraft() { clearTimeout(draftTimer); return drafts.save(); }
function restoreDraft(state) {
  if (isVisual) return;
  // Bind immediately on provider changes, including their connecting state.
  drafts.restore({ provider:state.provider ?? 'codex',cwd:state.cwd,threadId:state.threadId }, { creatingThread: sending && state.provider !== 'dots' });
}
const busy = () => isTaskBusy(current);

function error(message) { if (isVisual) return; $('error-banner').textContent = message ?? ''; $('error-banner').hidden = !message; scheduleMeasure(); }
async function call(promise) {
  const result = await promise;
  if (!result?.ok) { error(result?.error ?? '操作未完成。'); return { ok: false }; }
  return result;
}
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

function renderMessages(messages) {
  const host = $('messages');
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
  const fixed = [document.querySelector('.bubble-header'), $('current-target'), $('context-panel'), $('approval'), $('login-panel'), $('error-banner'), $('activity-line'), $('composer')].reduce((sum, node) => sum + height(node), 0);
  const size = { width: (replyText?.length ?? 0) > 900 ? 560 : 440, height: Math.ceil(chrome + fixed + textHeight + 3), viewport: { width: innerWidth, height: innerHeight } };
  const key = JSON.stringify(size);
  if (key !== lastMeasurement) { lastMeasurement = key; api.resizeBubble(size); }
}
function growPrompt() {
  $('prompt').style.height = '0px'; $('prompt').style.height = Math.min(140, Math.max(38, $('prompt').scrollHeight)) + 'px'; scheduleMeasure();
}
function renderApproval(approvals) {
  const host = $('approval');
  const key = JSON.stringify(approvals); if (key === approvalKey) return; approvalKey = key;
  host.replaceChildren(); host.hidden = !approvals.length; if (!approvals.length) return;
  const request = approvals[0];
  const titles = { command: 'Codex 需要确认这次操作', files: 'Codex 需要文件修改权限', permissions: 'Codex 需要额外权限', questions: 'Codex 想请你补充信息' };
  host.append(element('h3', '', titles[request.kind]));
  if (approvals.length > 1) host.append(element('p', '', `还有 ${approvals.length - 1} 个请求等待处理`));
  if (request.reason) host.append(element('p', '', request.reason));
  if (request.cwd) host.append(element('p', '', `目录：${request.cwd}`));
  if (request.command || request.details) host.append(element('pre', '', [request.command, request.details].filter(Boolean).join('\n\n')));
  const actions = element('div', 'approval-actions');
  const fields = {};
  if (request.kind === 'questions') {
    for (const question of request.questions) {
      const label = element('label', '', question.question); const field = element('input');
      field.type = question.secret ? 'password' : 'text'; field.maxLength = 8000; field.setAttribute('aria-label', question.question);
      fields[question.id] = field;
      if (question.options.length) {
        const select = element('select'); select.setAttribute('aria-label', `${question.header}选项`);
        select.append(element('option', '', '选择建议答案，或在下方输入'));
        for (const option of question.options) { const node = element('option', '', option.label); node.value = option.label; node.title = option.description ?? ''; select.append(node); }
        select.addEventListener('change', () => { field.value = select.value; }); label.append(select);
      }
      label.append(field); host.append(label);
    }
  }
  function action(label, answer, primary = false) {
    const button = element('button', primary ? 'primary' : '', label); button.type = 'button';
    button.addEventListener('click', async () => {
      const buttons = [...actions.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
      await call(api.respond(request.id, typeof answer === 'function' ? answer() : answer));
      buttons.forEach(b => b.disabled = false);
    }); actions.append(button);
  }
  if (request.kind === 'questions') action('提交回答', () => ({ answers: Object.fromEntries(Object.entries(fields).map(([id, input]) => [id, input.value])) }), true);
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
  const signal = state.connection === 'error' ? 'error' : active ? 'working' : state.connection === 'ready' ? 'ready' : '';
  if (isWallpaper) { wallpaper?.setBackendState(state); return; }
  if (isAvatar) {
    const status = state.connection === 'error' ? '连接需要处理' : state.connection !== 'ready' ? `正在连接${dots ? '凛' : ' Codex'}` : state.status === 'waiting' ? '需要你确认' : active ? '正在工作' : '已就绪';
    $('avatar-canvas').title = `${status} · 点击对话，右键设置或退出`; return;
  }
  $('connection-signal').className = `signal ${signal}`;
  $('speaker-name').textContent = dots ? '凛 · DOT' : 'CODEX';
  $('prompt').setAttribute('aria-label', dots ? '给凛的消息' : '给 Codex 的任务');
  $('prompt').placeholder = dots ? '和凛说点什么，或继续追问…' : '告诉我你的任务，或继续追问…';
  $('prompt').disabled = dots && !state.threadId;
  $('login-panel').hidden = dots || state.connection !== 'authentication';
  $('login-button').disabled = !!state.loginPending;
  $('login-button').textContent = state.loginPending ? '请在浏览器完成登录…' : '在浏览器登录 ChatGPT';
  $('cancel-login-button').hidden = !state.loginPending;
  $('provider-select').value = dots ? 'dots' : 'codex';
  $('provider-select').disabled = sending || state.status === 'configuring' || (!dots && active);
  $('codex-context').hidden = dots; $('dots-help').hidden = !dots;
  $('open-dot').hidden = !dots; $('reconnect-dot').hidden = !dots;
  $('reconnect-dot').disabled = sending || state.status === 'configuring';
  $('new-chat').hidden = dots;
  $('bubble-status').textContent = state.connection === 'error' ? '需要处理' : state.connection !== 'ready' ? '连接中' : state.status === 'waiting' ? '等待确认' : active ? '处理中' : '已就绪';
  $('bubble-status').hidden = !active && state.connection === 'ready';
  $('connection-signal').setAttribute('aria-label', $('bubble-status').textContent);
  $('connection-signal').title = $('bubble-status').textContent;
  $('connection-label').textContent = dots ? (state.connection === 'ready' ? '已连接 · 私人 dot 通道' : state.connection === 'error' ? 'Dots 连接需要处理' : '正在连接凛') : state.connection === 'ready' ? '已连接 · 现有 ChatGPT 登录' : state.connection === 'error' ? 'Codex 连接需要处理' : '正在读取 Codex 登录';
  $('connection-label').title = state.version ?? '';
  $('project-name').textContent = state.projectName; $('choose-project').title = state.cwd;
  $('current-target').hidden = dots;
  $('target-label').textContent = `${state.projectName} / ${state.threadName || '新对话'}`; $('workbench-button').title = `${state.cwd}\n打开项目与对话工作台`;
  const nextModelKey = JSON.stringify(state.models);
  if (nextModelKey !== modelKey) { modelKey = nextModelKey; $('model-select').replaceChildren(); for (const model of state.models) { const option = element('option', '', model.name); option.value = model.model; $('model-select').append(option); } }
  $('model-select').value = state.model ?? '';
  $('model-select').disabled = active || state.connection !== 'ready' || state.status === 'error'; $('choose-project').disabled = false; $('new-chat').disabled = active || state.connection !== 'ready';
  $('send-button').disabled = active || sending || state.connection !== 'ready' || state.status === 'error';
  $('stop-button').hidden = !active || state.status === 'configuring'; $('stop-button').disabled = state.status === 'stopping';
  $('stop-button').textContent = dots ? '打开凛 ↗' : '停止';
  $('activity-label').textContent = state.activity; $('session-label').textContent = state.threadId ? `${state.restored ? '已恢复' : '会话'} · ${state.threadId.slice(-8)}` : '新对话';
  $('session-label').hidden = !state.threadId;
  $('activity-line').hidden = !active && state.connection === 'ready';
  $('session-label').title = state.threadId ?? '';
  renderMessages(state.messages); renderApproval(state.approvals); error(state.error);
  speechControls?.refresh();
}

api.onState(render);
const initial = await call(api.snapshot()); if (initial.ok) render(initial.value);
if (isWallpaper) {
  startWallpaper().then(value => { wallpaper = value; if (current) wallpaper.setBackendState(current); }).catch(failure => {
    $('wallpaper-error').textContent = `动态模型加载失败：${failure.message}。Ctrl+Alt+空格仍可打开对话。`;
    $('wallpaper-error').hidden = false;
  });
} else if (isAvatar) {
  startAvatar().catch(failure => {
    $('avatar-error').textContent = `Live2D 模型未能加载：${failure.message}。对话仍可使用。`;
    $('avatar-error').hidden = false; api.hit(true);
  });
} else {
  installCompletionSound(api);
  api.workspace().then(r => { if (r.ok && !r.value.legacyDotsAvailable) document.querySelector('.provider-bar').hidden = true; });
  speechControls = installSpeech({ api, state: () => current, isBusy: () => busy() || sending || pendingReply, error, measure: scheduleMeasure, insert: text => { const prompt = $('prompt'); prompt.value += (prompt.value && !/\s$/.test(prompt.value) ? ' ' : '') + text; growPrompt(); saveDraft(); prompt.focus(); } });
  api.onInputAction(action => {
    if (action === 'record') speechControls.toggleCapture();
    else if (action === 'readReply') speechControls.readReply();
    else if (action === 'send') submitDraft(true);
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
  $('cancel-login-button').addEventListener('click', () => call(api.cancelLogin()));
  $('stop-button').addEventListener('click', () => call(current?.provider === 'dots' ? api.openDot() : api.interrupt()));
  async function submitDraft(fromShortcut = false) {
    const reject = message => { error(message); if (fromShortcut) api.windowAction('show-chat'); };
    if (busy() || sending) { reject('当前任务尚未结束，请等待回复完成后再发送。'); return; }
    if (current?.connection !== 'ready' || current?.status === 'error') { reject('Codex 尚未就绪，草稿已保留。'); return; }
    if (speechControls?.isCapturing()) { reject('请先完成听写、等待识别结束，再按发送键。'); return; }
    if (composing) { reject('请先确认输入法中的文字，再发送。'); return; }
    const text = $('prompt').value.trim(); if (!text) { if (fromShortcut) reject('当前没有可发送的草稿。'); return; }
    previousUserId = currentReply(current.messages).userId; pendingReply = true;
    sending = true; $('prompt').value = ''; saveDraft(); growPrompt(); render(current);
    let restore = false, failure;
    try { const result = await api.send(text); restore = !result?.ok || result.value?.cancelled; failure = result?.ok ? null : result?.error || '发送未完成，草稿已保留。'; }
    catch { restore = true; failure = '与桌面窗口的连接已断开。请重启桌面伙伴，草稿已保留。'; }
    finally {
      if (restore) { pendingReply = false; $('prompt').value = [text, $('prompt').value].filter(Boolean).join('\n'); }
      sending = false; render(current); growPrompt(); saveDraft(); $('prompt').focus();
      if (failure) reject(failure);
    }
  }
  $('composer').addEventListener('submit', event => { event.preventDefault(); submitDraft(); });
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
