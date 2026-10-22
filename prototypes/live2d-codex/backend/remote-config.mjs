export const REMOTE_ACTIONS = Object.freeze({ none:'不执行操作', chat:'打开 / 收起对话', workbench:'打开工作台', remoteSettings:'遥控器设置', up:'向上选择', down:'向下选择', left:'向左选择 / 草稿中清空', right:'向右选择 / 草稿中朗读或撤销', confirm:'确认选择 / 草稿中发送', back:'返回对话', send:'发送当前草稿', clearDraft:'清空当前草稿', undoDraft:'撤销清空草稿', interrupt:'停止 Agent 任务', readReply:'朗读最新回复', stopSpeech:'停止朗读', volumeUp:'提高播报音量', volumeDown:'降低播报音量' });
export const REMOTE_BUTTONS = Object.freeze({ up:'方向键 ↑', down:'方向键 ↓', left:'方向键 ←', right:'方向键 →', confirm:'中间确认键', home:'主页键', menu:'菜单键', back:'返回键', voice:'语音键（按住说话）', volumeUp:'音量加键', volumeDown:'音量减键' });
export const DEFAULT_BUTTONS = Object.freeze({ up:'up',down:'down',left:'left',right:'right',confirm:'confirm',home:'chat',menu:'workbench',back:'back',voice:'dictate',volumeUp:'volumeUp',volumeDown:'volumeDown' });
export function remoteSettings(value = {}) {
  const buttons = { ...DEFAULT_BUTTONS, ...value.buttons };
  for (const [button, action] of Object.entries(buttons)) {
    if (!Object.hasOwn(REMOTE_BUTTONS,button) || !(button === 'voice' ? ['dictate','none'].includes(action) : Object.hasOwn(REMOTE_ACTIONS,action))) throw new Error('请选择遥控器支持的按钮功能。');
  }
  const device = value.device ?? null;
  if (device && (typeof device.id !== 'string' || !device.id || device.id.length > 2000 || /[\r\n\0]/.test(device.id) || typeof device.name !== 'string' || device.name.length > 150)) throw new Error('遥控器信息无效，请重新搜索。');
  return { device:device ? {id:device.id,name:device.name} : null, autoConnect:value.autoConnect === true, buttons };
}
export const KEY_BUTTONS = Object.freeze({ Up:'up',Down:'down',Left:'left',Right:'right',Return:'confirm',Home:'home',Apps:'menu',Escape:'back',BrowserBack:'back',Back:'back',F5:'voice',VolumeUp:'volumeUp',VolumeDown:'volumeDown' });

// One physical down/up pair is one action; timeout/transport loss clears ownership.
export class RemoteKeys {
  constructor() { this.held = new Set(); }
  accept(key, edge) {
    const button = KEY_BUTTONS[key]; if (!button) return;
    if (edge === 'up') { this.held.delete(button); return; }
    if (edge !== 'down' || this.held.has(button)) return;
    this.held.add(button); return button;
  }
  clear() { this.held.clear(); }
}
