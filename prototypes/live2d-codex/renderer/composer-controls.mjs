// Contextual remote actions apply only to the draft field. Menus, sliders and
// permission requests retain their own navigation and confirmation behavior.
const buttonNames = {up:'上键',down:'下键',left:'左键',right:'右键',confirm:'确认键',home:'主页键',menu:'菜单键',back:'返回键',volumeUp:'音量加键',volumeDown:'音量减键'};
export function composerRemoteHints(buttons = {}, { hasText = false, undo = false } = {}) {
  const mapped = (...actions) => {
    for (const action of actions) {
      const entry = Object.entries(buttons).find(([id,value]) => id !== 'voice' && value === action);
      if (entry) return buttonNames[entry[0]];
    }
  };
  const hints = [];
  if (hasText) {
    const send = mapped('send','confirm'), clear = mapped('clearDraft','left');
    if (send) hints.push(`${send}发送`);
    if (clear) hints.push(`${clear}清空`);
  } else if (buttons.voice === 'dictate') hints.push('按住语音键说话');
  const last = undo ? mapped('undoDraft','right') : mapped('readReply','right');
  if (last) hints.push(`${last}${undo ? '撤销' : '朗读'}`);
  return hints.join(' · ');
}

export function installComposerControls({ api, drafts, submit, readReply, isLocked, isCapturing, error, measure }) {
  const $ = id => document.getElementById(id);
  let remote, changing = false;
  function refresh() {
    const hasText = !!$('prompt').value, undo = drafts.canUndoClear();
    const button = $('clear-draft');
    button.hidden = !hasText && !undo;
    button.textContent = undo ? '撤销清空' : '清空';
    button.disabled = changing || isLocked() || isCapturing();
    button.title = undo ? '恢复刚才清空的草稿' : '清空当前草稿，可以撤销';
    const connected = remote?.phase === 'connected';
    const hint = $('composer-hint');
    const inDraft = document.activeElement === $('prompt') && $('approval').hidden && $('context-panel').hidden;
    hint.textContent = connected ? inDraft ? composerRemoteHints(remote.config?.buttons,{hasText,undo}) : '上下键选择 · 确认键执行' : 'Enter 发送 · Shift + Enter 换行';
    hint.hidden = isCapturing() || !hint.textContent;
    hint.title = connected ? '以下操作在草稿输入框中生效；上下键可选择其他控件。' : hint.textContent;
    measure();
  }
  async function changeDraft(undo = false) {
    if (changing) return;
    if (isLocked()) { error('请先完成当前发送或权限请求，再整理草稿。'); return; }
    if (isCapturing()) { error('请先松开语音键并等待识别完成，再清空草稿。'); return; }
    changing = true; refresh();
    try { await (undo ? drafts.undoClear() : drafts.clear()); }
    finally { changing = false; $('prompt').focus(); refresh(); }
  }
  function action(action, active = document.activeElement) {
    if (['clearDraft','undoDraft'].includes(action)) {
      changeDraft(action === 'undoDraft').catch(e => error(e.message)); return true;
    }
    if (active !== $('prompt') || !$('approval').hidden || !$('context-panel').hidden) return false;
    if (action === 'confirm') { submit(true); return true; }
    if (action === 'left') { changeDraft().catch(e => error(e.message)); return true; }
    if (action === 'right') {
      if (drafts.canUndoClear()) changeDraft(true).catch(e => error(e.message));
      else readReply();
      return true;
    }
    return false;
  }
  $('clear-draft').onclick = () => changeDraft(drafts.canUndoClear()).catch(e => error(e.message));
  document.addEventListener('focusin',refresh);
  const accept = value => { remote = value; refresh(); };
  api.onRemote(accept); api.remote('snapshot').then(result => { if (result.ok && !remote) accept(result.value); });
  refresh(); return { refresh, action };
}
