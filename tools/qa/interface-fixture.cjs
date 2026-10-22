// This file doubles as a sandboxed synthetic preload and an Electron harness.
if(process.type==='renderer') {
  const {contextBridge}=require('electron');
  const listeners={};const on=(name,fn)=>{(listeners[name]??=[]).push(fn);return ()=>{};};
  const emit=(name,value)=>{for(const fn of listeners[name]??[])fn(value);};
  const ok=value=>Promise.resolve({ok:true,value});
  const buttons={up:'up',down:'down',left:'left',right:'right',confirm:'confirm',home:'chat',menu:'workbench',back:'back',voice:'dictate',volumeUp:'volumeUp',volumeDown:'volumeDown'};
  let remote={phase:'connected',audio:'idle',config:{device:{name:'RC003',id:'fixture'},buttons,autoConnect:true},devices:[],keysAvailable:true};
  const state={provider:'codex',connection:'ready',status:'idle',cwd:'C:/Projects/Example',projectName:'Documents',threadId:'fixture-thread',threadName:'遥控器语音体验',model:'fixture-model',models:[{name:'Fixture model',model:'fixture-model',efforts:['medium']}],effort:'medium',messages:[{role:'assistant',text:'可以用，已收到你的消息，中文显示和回复都正常。',complete:true}],approvals:[],activity:''};
  const workspace={version:1,projects:[{id:'example',name:'Documents',cwd:state.cwd}],settings:{character:'female',ttsResident:true,ttsEngine:'qwen',qwenVoice:'Serena',autoSpeak:false,prepareSpeech:false,playbackVolume:.8,completionSound:true,shortcuts:{chat:'Control+Alt+Space',record:'Control+Alt+V',send:'Control+Alt+Enter',readReply:'Control+Alt+R',stopSpeech:'Control+Alt+S',workbench:'Control+Alt+P'},remoteKeys:{},rc003:remote.config},speech:{phase:'ready',asr:true,engine:'qwen',engines:{qwen:true,kokoro:true}},resources:{phase:'idle',packs:[{id:'asr',label:'本地听写',installed:true,bytes:200000000},{id:'qwen',label:'自然语音',installed:true,bytes:4000000000},{id:'kokoro',label:'轻量语音',installed:true,bytes:200000000}]}};
  let draft='',sends=0;
  const api={snapshot:()=>ok(state),workspace:()=>ok(workspace),appearance:()=>ok({scale:1,mode:'wallpaper'}),onState:fn=>on('state',fn),onWorkspace:fn=>on('workspace',fn),onAppearance:fn=>on('appearance',fn),onFocus:fn=>on('focus',fn),onLayout:fn=>on('layout',fn),onRemote:fn=>on('remote',fn),onRemoteAction:fn=>on('remoteAction',fn),onRemoteText:fn=>on('remoteText',fn),onInputAction:fn=>on('inputAction',fn),onSpeech:(event,fn)=>on('speech:'+event,fn),onCompletionSound:fn=>on('sound',fn),onWorkbenchRefresh:fn=>on('workbench',fn),
    remote:()=>ok(remote),draft:(_target,text)=>{if(text!==undefined)draft=text;return ok({text:draft});},resizeBubble(){},windowAction:()=>ok(),stopSpeech:()=>ok(),capture:()=>ok(),listThreads:()=>ok({data:[{id:'fixture-first',name:'第一段对话',updatedAt:1},{id:'fixture-second',name:'第二段对话',updatedAt:2}],nextCursor:null}),history:()=>ok({turns:[],nextCursor:null}),learnKey:()=>ok(),send:()=>{sends++;return ok({cancelled:true});},synthesize:()=>new Promise(()=>{}),setPlaybackVolume:value=>{workspace.settings.playbackVolume=value;workspace.version++;emit('workspace',workspace);return ok(workspace);}};
  contextBridge.exposeInMainWorld('companion',api);
  contextBridge.exposeInMainWorld('interfaceFixture',{emit:(name,value)=>{if(name==='remote')remote={...remote,...value};emit(name,name==='remote'?remote:value);},stats:()=>({sends,draft,volume:workspace.settings.playbackVolume})});
} else {
  const {app,BrowserWindow,protocol,net}=require('electron');
  const {join,resolve}=require('node:path');
  const {writeFileSync,mkdirSync}=require('node:fs');
  const {pathToFileURL}=require('node:url');
  const assert=require('node:assert/strict');
  const root=resolve(__dirname,'../..'),application=join(root,'prototypes/live2d-codex'),output=process.argv[2];
  if(!output || !resolve(output).startsWith(join(root,'work','qa')+require('node:path').sep))throw new Error('Use an output beneath work/qa.');
  mkdirSync(output,{recursive:true});app.setPath('userData',join(output,'electron-profile'));app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
  const errors=[],checks=[];let windows=[];
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function evaluate(win,code){return win.webContents.executeJavaScript(code);}
  async function capture(win,name,width,height) {
    win.setSize(width,height);await delay(150);
    const overflow=await evaluate(win,`[...document.querySelectorAll('button,input,select,textarea')].filter(el=>!el.closest('[hidden]')&&el.getClientRects().length).filter(el=>{const r=el.getBoundingClientRect();return r.right>innerWidth+1||r.left<0;}).map(el=>el.id||el.textContent)`);
    assert.deepEqual(overflow,[],name+' controls overflow');
    // Hidden Windows surfaces may not have a composited frame immediately
    // after resize. Request a frame and keep the surface awake for capture;
    // retry only this transient compositor error, never assertion failures.
    let screenshot;
    for(let attempt=0;attempt<3;attempt++) {
      win.webContents.invalidate();
      try { screenshot=await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});break; }
      catch(error) { if(!String(error.message).includes('UnknownVizError') || attempt===2)throw error;await delay(150); }
    }
    assert.equal(screenshot.isEmpty(),false,name+' screenshot is empty');
    writeFileSync(join(output,name+'.png'),screenshot.toPNG());checks.push(name);
  }
  async function open(file,width,height) {
    const win=new BrowserWindow({width,height,show:false,frame:false,webPreferences:{preload:__filename,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});windows.push(win);
    win.webContents.on('console-message',(_event,level,message)=>{if(level===3 && !message.includes('Electron Security Warning'))errors.push(message);});
    await win.loadURL('app://local/renderer/'+file);await delay(300);return win;
  }
  app.whenReady().then(async()=>{
    protocol.handle('app',request=>{const path=decodeURIComponent(new URL(request.url).pathname);const file=resolve(application,'.'+path);if(!file.startsWith(application+require('node:path').sep))return new Response('',{status:403});return net.fetch(pathToFileURL(file).href);});
    const chat=await open('index.html?view=chat',440,390);
    const type=`const prompt=document.getElementById('prompt');prompt.value='请帮我整理这份项目的下一步计划。';prompt.dispatchEvent(new Event('input',{bubbles:true}));prompt.focus();`;
    await evaluate(chat,type);await capture(chat,'bubble-draft',440,390);await capture(chat,'bubble-compact',360,390);
    await evaluate(chat,`interfaceFixture.emit('remoteAction','confirm')`);await delay(80);assert.equal((await evaluate(chat,'interfaceFixture.stats()')).sends,1);
    await evaluate(chat,`interfaceFixture.emit('remoteAction','left')`);await delay(80);assert.equal(await evaluate(chat,`document.getElementById('prompt').value`),'');
    await capture(chat,'bubble-cleared',440,360);
    await evaluate(chat,`interfaceFixture.emit('remoteAction','right')`);await delay(80);assert.match(await evaluate(chat,`document.getElementById('prompt').value`),/下一步/);
    await evaluate(chat,`interfaceFixture.emit('remoteAction','right')`);await delay(80);await capture(chat,'bubble-playback-preparing',440,390);await capture(chat,'bubble-playback-compact',360,390);
    await evaluate(chat,`document.getElementById('stop-speech').click();interfaceFixture.emit('remote',{audio:'listening',capture:{stage:'receiving',durationMs:3200}})`);await capture(chat,'bubble-remote-recording',440,390);await capture(chat,'bubble-recording-compact',360,390);
    const workbench=await open('workbench.html',1120,760);
    // Selection and status refreshes must preserve the user's place in the
    // remote's focus order, including after a list replaces its DOM children.
    await evaluate(workbench,`document.querySelector('.project-row').focus();interfaceFixture.emit('remoteAction','confirm')`);await delay(80);
    assert.equal(await evaluate(workbench,`document.activeElement.dataset.projectId`),'example','project selection retains remote focus');
    await evaluate(workbench,`companion.workspace().then(result=>interfaceFixture.emit('workspace',result.value))`);
    assert.equal(await evaluate(workbench,`document.activeElement.dataset.projectId`),'example','workspace refresh retains project focus');
    await evaluate(workbench,`document.getElementById('search').focus();companion.workspace().then(result=>interfaceFixture.emit('workspace',result.value))`);
    assert.equal(await evaluate(workbench,`document.activeElement.id`),'search','list refresh does not steal unrelated focus');
    await evaluate(workbench,`document.querySelector('.thread-row').focus();interfaceFixture.emit('remoteAction','confirm')`);await delay(80);
    assert.equal(await evaluate(workbench,`document.activeElement.dataset.threadId`),'fixture-first','conversation selection retains remote focus');
    await evaluate(workbench,`interfaceFixture.emit('remoteAction','down')`);
    assert.equal(await evaluate(workbench,`document.activeElement.dataset.threadId`),'fixture-second','next direction continues to the next conversation');
    const categories=await evaluate(workbench,`(() => {document.getElementById('settings-tab').click();const speed=document.getElementById('speed');speed.value='1.1';speed.dispatchEvent(new Event('change',{bubbles:true}));return [...document.querySelectorAll('[data-setting-target]')].map(button=>button.dataset.settingTarget);})()`);
    for(const id of categories) {
      await evaluate(workbench,`document.querySelector('[data-setting-target="${id}"]').focus();interfaceFixture.emit('remoteAction','confirm')`);
      assert.equal(await evaluate(workbench,`document.activeElement.dataset.settingTarget`),id,'category retains remote navigation focus');
      assert.equal(await evaluate(workbench,`document.getElementById('${id}').hidden`),false,'selected category is visible');
    }
    assert.equal(await evaluate(workbench,`document.getElementById('speed').value`),'1.1','category navigation preserves unsaved input');
    await evaluate(workbench,`document.querySelector('[data-setting-target="playback-settings"]').focus();interfaceFixture.emit('remoteAction','confirm');interfaceFixture.emit('remoteAction','down')`);
    assert.equal(await evaluate(workbench,`document.activeElement.dataset.settingTarget`),'conversation-settings','direction after category confirmation continues through controls');
    checks.push('remote-project-thread-and-category-focus');
    await evaluate(workbench,`document.getElementById('settings-tab').click();document.querySelector('[data-setting-target="remote-settings"]').click()`);await capture(workbench,'remote-settings',1120,760);await capture(workbench,'remote-settings-compact',760,540);
    await evaluate(workbench,`document.querySelector('[data-setting-target="playback-settings"]').click()`);await capture(workbench,'voice-settings-compact',760,540);await capture(workbench,'voice-settings',1120,760);
    assert.deepEqual(errors,[],'Renderer console errors');writeFileSync(join(output,'summary.json'),JSON.stringify({checks,errors,synthetic:true,accounts:false,hardware:false},null,2));
    for(const win of windows)win.destroy();app.exit(0);
  }).catch(error=>{console.error(error);writeFileSync(join(output,'failure.txt'),String(error.stack));app.exit(1);});
}
