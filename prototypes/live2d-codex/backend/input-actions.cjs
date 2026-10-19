// One catalog for persisted bindings, native shortcuts and settings labels.
const INPUT_ACTIONS = Object.freeze({
  chat: { label: '唤出 / 收起气泡', shortcut: 'Control+Alt+Space', remote: '' },
  record: { label: '开始 / 完成听写', shortcut: 'Control+Alt+V', remote: 'F8' },
  send: { label: '发送当前草稿', shortcut: 'Control+Alt+Enter', remote: '' },
  readReply: { label: '朗读此条', shortcut: 'Control+Alt+R', remote: '' },
  stopSpeech: { label: '停止播报', shortcut: 'Control+Alt+S', remote: 'F9' },
  workbench: { label: '打开项目工作台', shortcut: 'Control+Alt+P', remote: 'F6' }
});
const DEFAULT_SHORTCUTS = Object.freeze(Object.fromEntries(Object.entries(INPUT_ACTIONS).map(([id, action]) => [id, action.shortcut])));
const DEFAULT_REMOTE_KEYS = Object.freeze(Object.fromEntries(Object.entries(INPUT_ACTIONS).map(([id, action]) => [id, action.remote])));
const aliases = { ctrl: 'control', commandorcontrol: 'control', cmdorctrl: 'control', return: 'enter', esc: 'escape', spacebar: 'space', meta: 'super', win: 'super' };
function acceleratorKey(value) {
  return value.toLowerCase().split('+').map(part => aliases[part.trim()] ?? part.trim()).sort().join('+');
}
// Native globalShortcut has no keyup event. Ignore a stream of repeated presses
// until it has been quiet for longer than Windows' initial key repeat delay.
function withoutKeyRepeat(action, now = Date.now) {
  let last = -Infinity;
  return () => { const time = now(), repeated = time - last < 1200; last = time; if (!repeated) return action(); };
}
function registerInputActions(native, settings, handlers, { suspended = false, now = Date.now, resumeAt = 0 } = {}) {
  native.unregisterAll();
  if (suspended) return [];
  const errors = [], seen = new Map();
  const bindings = [...Object.entries(settings.shortcuts), ...(settings.remoteEnabled ? Object.entries(settings.remoteKeys) : [])];
  for (const [id, key] of bindings) {
    if (!INPUT_ACTIONS[id] || typeof handlers[id] !== 'function' || !key) continue;
    const canonical = acceleratorKey(key);
    if (seen.has(canonical)) { if (seen.get(canonical) !== id) errors.push(`${key} 被分配给两个操作，请更换其中一个。`); continue; }
    seen.set(canonical, id);
    const invoke = withoutKeyRepeat(() => { if (now() >= resumeAt) return handlers[id](); }, now);
    try { if (!native.register(key, invoke)) errors.push(`${key} 已被占用，请在设置中更换。`); }
    catch { errors.push(`${key} 不是有效的快捷键。`); }
  }
  return errors;
}
module.exports = { INPUT_ACTIONS, DEFAULT_SHORTCUTS, DEFAULT_REMOTE_KEYS, registerInputActions };
