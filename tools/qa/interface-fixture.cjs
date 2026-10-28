// This file doubles as a sandboxed synthetic preload and an Electron harness.
if(process.argv.includes('--video') || process.argv.includes('--fixture-video')) {
  console.error('The legacy three-state video fixture is retired. Use npm run qa:motion -- --run for the current wallpaper.');
  process.exitCode = 1;
} else if(process.type==='renderer') {
  const {contextBridge,ipcRenderer}=require('electron');
  const listeners={};const on=(name,fn)=>{(listeners[name]??=[]).push(fn);return ()=>{};};
  const emit=(name,value)=>{for(const fn of listeners[name]??[])fn(value);};
  const ok=value=>Promise.resolve({ok:true,value});
  const buttons={up:'up',down:'down',left:'left',right:'right',confirm:'confirm',home:'chat',menu:'workbench',back:'back',voice:'dictate',volumeUp:'volumeUp',volumeDown:'volumeDown'};
  let remote={phase:'connected',audio:'idle',config:{device:{name:'RC003',id:'fixture'},buttons,autoConnect:true},devices:[],keysAvailable:true};
  const state={provider:'codex',connection:'ready',status:'idle',cwd:'C:/Projects/Example',projectName:'Documents',threadId:'fixture-thread',threadName:'遥控器语音体验',model:'fixture-model',models:[{name:'Fixture model',model:'fixture-model',efforts:[{reasoningEffort:'medium'}]}],effort:'medium',messages:[{role:'assistant',text:'可以用，已收到你的消息，中文显示和回复都正常。',complete:true}],approvals:[],activity:''};
  const workspace={version:1,projects:[{id:'example',name:'Documents',cwd:state.cwd}],settings:{character:'female',ttsResident:true,ttsEngine:'qwen',qwenVoice:'Serena',autoSpeak:false,prepareSpeech:false,playbackVolume:.8,completionSound:true,shortcuts:{chat:'Control+Alt+Space',record:'Control+Alt+V',send:'Control+Alt+Enter',readReply:'Control+Alt+R',stopSpeech:'Control+Alt+S',workbench:'Control+Alt+P'},remoteKeys:{},rc003:remote.config},speech:{phase:'ready',asr:true,engine:'qwen',engines:{qwen:true,kokoro:true}},resources:{phase:'idle',packs:[{id:'asr',label:'本地听写',installed:true,bytes:200000000},{id:'qwen',label:'自然语音',installed:true,bytes:4000000000},{id:'kokoro',label:'轻量语音',installed:true,bytes:200000000}]}};
  let draft='',sends=0,spoken=0,renderInfo=null;
  let presentation={mode:'wallpaper',wallpaperKind:'artwork',character:'female',characterRequest:0,chatVisible:false,paused:false,manualPause:false};
  const applyEvent=(name,value)=>{
    if(name==='presentation')presentation={...presentation,...value};
    if(name==='state')Object.assign(state,value);
    if(name==='wallpaper-request'){workspace.wallpaper={phase:'loading',...value};workspace.version++;name='workspace';value=workspace;}
    emit(name,name==='presentation'?presentation:name==='state'?state:value);
  };
  ipcRenderer.on('fixture:relay',(_event,name,value)=>applyEvent(name,value));
  const api={snapshot:()=>ok(state),workspace:()=>ok(workspace),appearance:()=>ok({scale:1,mode:'wallpaper'}),onState:fn=>on('state',fn),onWorkspace:fn=>on('workspace',fn),onAppearance:fn=>on('appearance',fn),onFocus:fn=>on('focus',fn),onLayout:fn=>on('layout',fn),onRemote:fn=>on('remote',fn),onRemoteAction:fn=>on('remoteAction',fn),onRemoteText:fn=>on('remoteText',fn),onInputAction:fn=>on('inputAction',fn),onSpeech:(event,fn)=>on('speech:'+event,fn),onCompletionSound:fn=>on('sound',fn),onWorkbenchRefresh:fn=>on('workbench',fn),
    remote:()=>ok(remote),draft:(_target,text)=>{if(text!==undefined)draft=text;return ok({text:draft});},resizeBubble(){},windowAction:()=>ok(),stopSpeech:()=>ok(),capture:()=>ok(),listThreads:()=>ok({data:[{id:'fixture-first',name:'第一段对话',updatedAt:1},{id:'fixture-second',name:'第二段对话',updatedAt:2}],nextCursor:null}),history:()=>ok({turns:[],nextCursor:null}),learnKey:()=>ok(),send:()=>{sends++;return ok({cancelled:true});},synthesize:()=>{spoken++;return new Promise(()=>{});},setPlaybackVolume:value=>{workspace.settings.playbackVolume=value;workspace.version++;emit('workspace',workspace);return ok(workspace);},
    presentation:()=>ok(presentation),onPresentation:fn=>on('presentation',fn),avatarAnchor(){},commitWallpaper:()=>ok(true),finishWallpaper:()=>({ok:true,value:true}),
    renderReady:info=>{renderInfo=info;},
    saveSettings:async patch=>{if('character' in patch || 'wallpaperKind' in patch)await ipcRenderer.invoke('fixture:wallpaper-choice',patch);else{Object.assign(workspace.settings,patch);workspace.version++;emit('workspace',workspace);}return {ok:true,value:workspace};}};
  contextBridge.exposeInMainWorld('companion',api);
  contextBridge.exposeInMainWorld('interfaceFixture',{emit:(name,value)=>{if(name==='remote')remote={...remote,...value};applyEvent(name,name==='remote'?remote:value);},stats:()=>({sends,draft,spoken,renderInfo,volume:workspace.settings.playbackVolume})});
} else {
  const {app,BrowserWindow,protocol,net,ipcMain}=require('electron');
  const {join,resolve}=require('node:path');
  const {writeFileSync,mkdirSync}=require('node:fs');
  const {pathToFileURL}=require('node:url');
  const assert=require('node:assert/strict');
  const root=resolve(__dirname,'../..'),application=join(root,'prototypes/live2d-codex'),output=process.argv[2];
  if(!output || !resolve(output).startsWith(join(root,'work','qa')+require('node:path').sep))throw new Error('Use an output beneath work/qa.');
  mkdirSync(output,{recursive:true});app.setPath('userData',join(output,'electron-profile'));app.disableHardwareAcceleration();
  protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
  const errors=[],checks=[];let windows=[];
  const present={mode:'wallpaper',wallpaperKind:'artwork',character:'female',characterRequest:0,chatVisible:false,paused:false,manualPause:false};
  const relay=(name,value)=>{for(const win of windows)if(!win.isDestroyed())win.webContents.send('fixture:relay',name,value);};
  ipcMain.handle('fixture:wallpaper-choice',(_event,patch)=>{present.character=patch.character;present.wallpaperKind=patch.wallpaperKind;present.characterRequest++;relay('wallpaper-request',{character:present.character,wallpaperKind:present.wallpaperKind,requestId:present.characterRequest});relay('presentation',present);});
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
    const win=new BrowserWindow({width,height,show:false,frame:false,webPreferences:{preload:__filename,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});windows.push(win);
    win.webContents.on('console-message',(_event,level,message)=>{if(level===3 && !message.includes('Electron Security Warning'))errors.push(message);});
    await win.loadURL('app://local/renderer/'+file);await delay(300);return win;
  }
  app.whenReady().then(async()=>{
    protocol.handle('app',request=>{const path=decodeURIComponent(new URL(request.url).pathname);if(path.startsWith('/video/'))return new Response('',{status:404});const file=resolve(application,'.'+path);if(!file.startsWith(application+require('node:path').sep))return new Response('',{status:403});return net.fetch(pathToFileURL(file).href);});
    if(process.argv.includes('--visual')) {
      const result=await require('./visual-cases.cjs')({open,evaluate,delay,output});
      result.errors=errors;
      writeFileSync(join(output,'summary.json'),JSON.stringify(result,null,2));
      for(const win of windows)win.destroy();
      app.exit(result.failures.length || errors.length ? 1 : 0);return;
    }
    if(process.argv.includes('--focus')) {
      const workbench=await open('workbench.html',1120,760);
      workbench.show();workbench.focus();await delay(100);
      if(process.argv.includes('--baseline-focus'))await evaluate(workbench,`document.querySelector('link[href$="/remote-focus.css"]').disabled=true`);
      // A real pointer event establishes mouse modality before the remote's
      // programmatic focus movement. activeElement alone cannot prove visibility.
      const point=await evaluate(workbench,`(()=>{const r=document.querySelector('.project-row').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      workbench.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
      workbench.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await delay(100);
      await evaluate(workbench,`interfaceFixture.emit('remoteAction','down')`);await delay(50);
      const focus=await evaluate(workbench,`(()=>{const el=document.activeElement,s=getComputedStyle(el);return {tag:el.tagName,id:el.id,text:el.textContent?.slice(0,50),documentFocused:document.hasFocus(),focus:el.matches(':focus'),input:document.documentElement.dataset.navigationInput,focusVisible:el.matches(':focus-visible'),outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor,boxShadow:s.boxShadow}})()`);
      writeFileSync(join(output,'focus.json'),JSON.stringify(focus,null,2));
      await capture(workbench,'remote-focus-after-pointer',1120,760);
      assert.equal(focus.documentFocused,true,'The reproduction must use a focused window');
      assert.equal(focus.focus,true,'The selected control must actually have focus');
      assert.ok(focus.outlineStyle!=='none' && parseFloat(focus.outlineWidth)>=2,'Remote focus must have a visible outline after mouse use: '+JSON.stringify(focus));
      const walk=async(win,label)=>{
        const result=await evaluate(win,`(()=>{
          const visible=()=>[...document.querySelectorAll('button,select,input,textarea,summary,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.checkVisibility({visibilityProperty:true})&&!el.closest('[hidden]')&&el.getClientRects().length);
          const checked=new Set(),failures=[];
          for(let i=0,n=visible().length+1;i<n;i++){
            interfaceFixture.emit('remoteAction','down');const el=document.activeElement;
            if(checked.has(el))continue;checked.add(el);
            const painted=el.matches('.character-option input')?el.nextElementSibling:el.matches('.composer textarea')?el.closest('.composer'):el,s=getComputedStyle(painted);
            if(!el.matches(':focus')||s.outlineStyle==='none'||parseFloat(s.outlineWidth)<2||s.outlineColor==='rgba(0, 0, 0, 0)')failures.push({id:el.id,tag:el.tagName,text:el.textContent?.slice(0,30),outline:s.outline});
          }
          return {count:checked.size,expected:visible().length,failures};
        })()`);
        assert.equal(result.count,result.expected,label+' visits every control: '+JSON.stringify(result));assert.deepEqual(result.failures,[],label+' shows every remote focus');checks.push(label);
      };
      const chat=await open('index.html?view=chat',440,420);
      workbench.show();workbench.focus();await delay(80);
      await walk(workbench,'conversation list remote focus');
      await evaluate(workbench,`document.getElementById('settings-tab').click()`);
      const groups=await evaluate(workbench,`[...document.querySelectorAll('[data-setting-target]')].map(el=>el.dataset.settingTarget)`);
      for(const group of groups){
        await evaluate(workbench,`document.querySelector('[data-setting-target="${group}"]').click()`);await walk(workbench,group+' remote focus');
        if(group==='remote-settings'){
          await evaluate(workbench,`document.querySelector('#remote-settings summary').focus();interfaceFixture.emit('remoteAction','confirm')`);
          await walk(workbench,'expanded remote controls focus');
          await evaluate(workbench,`document.querySelector('#remote-settings summary').focus();interfaceFixture.emit('remoteAction','confirm');interfaceFixture.emit('remoteAction','down')`);
          assert.equal(await evaluate(workbench,`Boolean(document.activeElement.closest('details:not([open])'))`),false,'collapsed fields cannot trap remote navigation');
        }
      }
      await evaluate(workbench,`document.querySelector('[data-setting-target="wallpaper-settings"]').click();document.querySelector('[name="wallpaper-character"]').focus();interfaceFixture.emit('remoteAction','down')`);
      await capture(workbench,'character-card-focus',1120,760);
      await evaluate(workbench,`document.querySelector('[data-setting-target="playback-settings"]').focus();interfaceFixture.emit('remoteAction','confirm')`);
      await capture(workbench,'category-focus',1120,760);
      await evaluate(workbench,`document.querySelector('.project-row').focus();interfaceFixture.emit('remoteAction','confirm')`);await delay(100);
      assert.equal(await evaluate(workbench,`document.activeElement.dataset.projectId`),'example');
      assert.equal(await evaluate(workbench,`getComputedStyle(document.activeElement).outlineStyle`),'solid');checks.push('project refresh retains visible focus');
      chat.show();chat.focus();await delay(80);await walk(chat,'chat remote focus');
      await evaluate(chat,`document.getElementById('send-button').focus();interfaceFixture.emit('remoteAction','up')`);await capture(chat,'chat-focus',440,420);
      workbench.show();workbench.focus();await delay(80);
      const native=await evaluate(workbench,`(()=>{const r=document.getElementById('settings-tab').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      workbench.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...native});workbench.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...native});await delay(80);
      assert.equal(await evaluate(workbench,`document.documentElement.hasAttribute('data-navigation-input')`),false,'mouse restores native focus behavior');
      workbench.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});workbench.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await delay(80);
      assert.equal(await evaluate(workbench,`document.activeElement.matches(':focus-visible')`),true,'keyboard focus remains visible');checks.push('mouse and keyboard modality preserved');
      assert.deepEqual(errors,[],'Renderer console errors');
      writeFileSync(join(output,'summary.json'),JSON.stringify({checks,errors,synthetic:true,accounts:false,hardware:false},null,2));
      for(const win of windows)win.destroy();app.exit(0);return;
    }
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
