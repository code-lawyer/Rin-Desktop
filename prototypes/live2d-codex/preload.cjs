const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', {
  snapshot: () => ipcRenderer.invoke('companion:snapshot'),
  login: () => ipcRenderer.invoke('companion:login'),
  cancelLogin: () => ipcRenderer.invoke('companion:cancel-login'),
  appearance: () => ipcRenderer.invoke('companion:appearance'),
  presentation: () => ipcRenderer.invoke('companion:presentation'),
  avatarScale: scale => ipcRenderer.invoke('companion:avatar-scale', scale),
  resetAvatar: () => ipcRenderer.invoke('companion:avatar-reset'),
  openLink: href => ipcRenderer.invoke('companion:open-link', href),
  send: (text, target) => ipcRenderer.invoke('companion:send', text, target),
  submission: (action, id) => ipcRenderer.invoke('companion:submission', action, id),
  chooseProvider: kind => ipcRenderer.invoke('companion:provider', kind),
  reconnect: () => ipcRenderer.invoke('companion:reconnect'),
  openDot: () => ipcRenderer.invoke('companion:open-dot'),
  interrupt: () => ipcRenderer.invoke('companion:interrupt'),
  newConversation: () => ipcRenderer.invoke('companion:new'),
  chooseProject: () => ipcRenderer.invoke('companion:project'),
  chooseModel: model => ipcRenderer.invoke('companion:model', model),
  workspace: () => ipcRenderer.invoke('workbench:snapshot'),
  downloadResource: id => ipcRenderer.invoke('resources:download', id),
  unloadResource: id => ipcRenderer.invoke('resources:unload', id),
  cancelDownload: () => ipcRenderer.invoke('resources:cancel'),
  useData: () => ipcRenderer.invoke('workbench:use-data'),
  addProject: () => ipcRenderer.invoke('workbench:add'),
  removeProject: id => ipcRenderer.invoke('workbench:remove', id),
  listThreads: (id, cursor = null, search = '', provider) => ipcRenderer.invoke('workbench:list', id, cursor, search, provider),
  history: (id, cursor = null, provider) => ipcRenderer.invoke('workbench:history', id, cursor, provider),
  resumeThread: (projectId, threadId, provider) => ipcRenderer.invoke('workbench:resume', projectId, threadId, provider),
  newThread: (id, provider) => ipcRenderer.invoke('workbench:new', id, provider),
  renameThread: (id, name, provider) => ipcRenderer.invoke('workbench:rename', id, name, provider),
  chooseEffort: effort => ipcRenderer.invoke('workbench:effort', effort),
  draft: (target, text) => ipcRenderer.invoke('workbench:draft', target, text),
  saveSettings: patch => ipcRenderer.invoke('workbench:settings', patch),
  learnKey: learning => ipcRenderer.invoke('workbench:learn-key', learning),
  capture: target => ipcRenderer.invoke('speech:capture', target),
  remote: (command, value) => ipcRenderer.invoke('remote:command', command, value),
  onRemote: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('remote:state', listener); return () => ipcRenderer.removeListener('remote:state', listener); },
  onRemoteText: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('remote:text', listener); return () => ipcRenderer.removeListener('remote:text', listener); },
  onRemoteAction: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('remote:action', listener); return () => ipcRenderer.removeListener('remote:action', listener); },
  transcribe: data => ipcRenderer.invoke('speech:transcribe', data),
  synthesize: (text, profile) => ipcRenderer.invoke('speech:synthesize', text, profile),
  stopSpeech: (notify = true) => ipcRenderer.invoke('speech:stop', notify),
  setPlaybackVolume: value => ipcRenderer.invoke('speech:volume', value),
  previewVoice: () => ipcRenderer.invoke('speech:preview'),
  chooseQwen: () => ipcRenderer.invoke('speech:choose-qwen'),
  previewCompletionSound: () => ipcRenderer.invoke('notification:preview'),
  onCompletionSound: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('notification:sound', listener); return () => ipcRenderer.removeListener('notification:sound', listener); },
  onWorkspace: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('workbench:state', listener); return () => ipcRenderer.removeListener('workbench:state', listener); },
  onWorkbenchRefresh: callback => { const listener = (_event, page) => callback(page); ipcRenderer.on('workbench:refresh', listener); return () => ipcRenderer.removeListener('workbench:refresh', listener); },
  onInputAction: callback => { const listener = (_event, action) => callback(action); ipcRenderer.on('companion:input-action', listener); return () => ipcRenderer.removeListener('companion:input-action', listener); },
  onSpeech: (event, callback) => {
    if (!['reply', 'stop', 'cancel'].includes(event)) return () => {};
    const listener = (_event, value) => callback(value); ipcRenderer.on('speech:' + event, listener); return () => ipcRenderer.removeListener('speech:' + event, listener);
  },
  respond: (id, answer) => ipcRenderer.invoke('companion:respond', { id, answer }),
  windowAction: action => ipcRenderer.invoke('companion:window', action),
  hit: hit => ipcRenderer.send('companion:hit', Boolean(hit)),
  beginMove: point => ipcRenderer.send('companion:drag-start', point),
  moveTo: point => ipcRenderer.send('companion:drag-move', point),
  endMove: () => ipcRenderer.send('companion:drag-end'),
  beginChatMove: point => ipcRenderer.send('companion:chat-drag-start', point),
  moveChatTo: point => ipcRenderer.send('companion:chat-drag-move', point),
  endChatMove: () => ipcRenderer.send('companion:chat-drag-end'),
  renderReady: info => ipcRenderer.send('companion:render-ready', info),
  avatarAnchor: anchor => ipcRenderer.send('companion:avatar-anchor', anchor),
  resizeBubble: size => ipcRenderer.send('companion:resize-bubble', size),
  onLayout: callback => {
    const listener = (_event, layout) => callback(layout);
    ipcRenderer.on('companion:layout', listener);
    return () => ipcRenderer.removeListener('companion:layout', listener);
  },
  onFocus: callback => {
    const listener = () => callback();
    ipcRenderer.on('companion:focus', listener);
    return () => ipcRenderer.removeListener('companion:focus', listener);
  },
  onAppearance: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('companion:appearance', listener);
    return () => ipcRenderer.removeListener('companion:appearance', listener);
  },
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('companion:state', listener);
    return () => ipcRenderer.removeListener('companion:state', listener);
  },
  onPresentation: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('companion:presentation', listener);
    return () => ipcRenderer.removeListener('companion:presentation', listener);
  }
});
