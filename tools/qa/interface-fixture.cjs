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
  let draft='',sends=0,spoken=0,renderInfo=null,promptCopies=0;
  let presentation={mode:'wallpaper',wallpaperKind:'artwork',character:'female',characterRequest:0,chatVisible:false,paused:false,manualPause:false};
  const applyEvent=(name,value)=>{
    if(name==='presentation')presentation={...presentation,...value};
    if(name==='state')Object.assign(state,value);
    if(name==='workspace'){if(value.version===undefined)workspace.version++;Object.assign(workspace,value);value=workspace;}
    if(name==='wallpaper-request'){workspace.wallpaper={phase:'loading',...value};workspace.version++;name='workspace';value=workspace;}
    emit(name,name==='presentation'?presentation:name==='state'?state:value);
  };
  ipcRenderer.on('fixture:relay',(_event,name,value)=>applyEvent(name,value));
  const api={snapshot:()=>ok(state),workspace:()=>ok(workspace),appearance:()=>ok({scale:1,mode:'wallpaper'}),onState:fn=>on('state',fn),onWorkspace:fn=>on('workspace',fn),onAppearance:fn=>on('appearance',fn),onFocus:fn=>on('focus',fn),onLayout:fn=>on('layout',fn),onRemote:fn=>on('remote',fn),onRemoteAction:fn=>on('remoteAction',fn),onRemoteText:fn=>on('remoteText',fn),onInputAction:fn=>on('inputAction',fn),onSpeech:(event,fn)=>on('speech:'+event,fn),onCompletionSound:fn=>on('sound',fn),onWorkbenchRefresh:fn=>on('workbench',fn),
    customAgents:()=>ipcRenderer.invoke('fixture:agents-list').then(ok),saveCustomAgent:(...args)=>ipcRenderer.invoke('fixture:agents-save',...args).then(ok),removeCustomAgent:(...args)=>ipcRenderer.invoke('fixture:agents-remove',...args).then(ok),reloadCustomAgents:()=>ipcRenderer.invoke('fixture:agents-reload').then(ok),pickAgentProgram:()=>ipcRenderer.invoke('fixture:agents-program').then(ok),copyAgentPrompt:name=>ipcRenderer.invoke('fixture:agents-prompt',name).then(value=>{promptCopies++;return ok(value);}),
    chooseProvider:id=>ipcRenderer.invoke('fixture:agents-connect',id).then(ok),reconnect:()=>ipcRenderer.invoke('fixture:agents-connect',state.provider).then(ok),
    remote:()=>ok(remote),draft:(_target,text)=>{if(text!==undefined)draft=text;return ok({text:draft});},resizeBubble(){},windowAction:()=>ok(),stopSpeech:()=>ok(),capture:()=>ok(),listThreads:()=>ok({data:[{id:'fixture-first',name:'第一段对话',updatedAt:1},{id:'fixture-second',name:'第二段对话',updatedAt:2}],nextCursor:null}),history:()=>ok({turns:[],nextCursor:null}),learnKey:()=>ok(),send:()=>{sends++;return ok({cancelled:true});},synthesize:()=>{spoken++;return new Promise(()=>{});},setPlaybackVolume:value=>{workspace.settings.playbackVolume=value;workspace.version++;emit('workspace',workspace);return ok(workspace);},
    presentation:()=>ok(presentation),onPresentation:fn=>on('presentation',fn),avatarAnchor(){},commitWallpaper:()=>ok(true),finishWallpaper:()=>({ok:true,value:true}),
    renderReady:info=>{renderInfo=info;},
    saveSettings:async patch=>{if('character' in patch || 'wallpaperKind' in patch)await ipcRenderer.invoke('fixture:wallpaper-choice',patch);else{Object.assign(workspace.settings,patch);workspace.version++;emit('workspace',workspace);}return {ok:true,value:workspace};}};
  contextBridge.exposeInMainWorld('companion',api);
  contextBridge.exposeInMainWorld('interfaceFixture',{emit:(name,value)=>{if(name==='remote')remote={...remote,...value};applyEvent(name,name==='remote'?remote:value);},stats:()=>({sends,draft,spoken,renderInfo,promptCopies,volume:workspace.settings.playbackVolume})});
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
  const errors=[],checks=[];let windows=[],customStore,setupPrompt,fixtureProvider='codex',fixtureLaunch;
  const present={mode:'wallpaper',wallpaperKind:'artwork',character:'female',characterRequest:0,chatVisible:false,paused:false,manualPause:false};
  const relay=(name,value)=>{for(const win of windows)if(!win.isDestroyed())win.webContents.send('fixture:relay',name,value);};
  const agentView=()=>({...customStore.snapshot(),activeId:fixtureProvider,needsReconnect:fixtureProvider.startsWith('custom-')&&JSON.stringify(fixtureLaunch)!==JSON.stringify(customStore.entries.find(entry=>entry.id===fixtureProvider))});
  const publishAgents=()=>{relay('workspace',{customAgents:customStore.entries.map(({id,name})=>({id,name})),agentConfigRevision:customStore.revision,agentConfigError:customStore.error,agentNeedsReconnect:agentView().needsReconnect});return agentView();};
  ipcMain.handle('fixture:agents-list',agentView);
  ipcMain.handle('fixture:agents-save',async(_event,entry,revision,creating)=>{await customStore.save(entry,revision,{creating});return publishAgents();});
  ipcMain.handle('fixture:agents-remove',async(_event,id,revision)=>{if(id===fixtureProvider)throw new Error('请先切换到其他 Agent');await customStore.remove(id,revision);return publishAgents();});
  ipcMain.handle('fixture:agents-reload',async()=>{await customStore.reload();return publishAgents();});
  ipcMain.handle('fixture:agents-program',()=>process.execPath);
  // Synthetic clipboard and connection: no real clipboard, process or account.
  ipcMain.handle('fixture:agents-prompt',(_event,name)=>setupPrompt({file:customStore.file,name}));
  ipcMain.handle('fixture:agents-connect',(_event,id)=>{fixtureProvider=id;fixtureLaunch=customStore.entries.find(entry=>entry.id===id);relay('state',{provider:id,connection:'ready',status:'idle',canResume:true});publishAgents();});
  ipcMain.handle('fixture:wallpaper-choice',(_event,patch)=>{present.character=patch.character;present.wallpaperKind=patch.wallpaperKind;present.characterRequest++;relay('wallpaper-request',{character:present.character,wallpaperKind:present.wallpaperKind,requestId:present.characterRequest});relay('presentation',present);});
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function evaluate(win,code){return win.webContents.executeJavaScript(code);}
  async function until(win,expression,label){for(let n=0;n<100;n++){if(await evaluate(win,expression))return;await delay(25);}throw new Error('Interface condition not reached: '+label);}
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
    const {CustomAgentStore}=await import(pathToFileURL(join(application,'backend/custom-agents.mjs')).href);
    ({agentSetupPrompt:setupPrompt}=await import(pathToFileURL(join(application,'backend/agent-setup-prompt.mjs')).href));
    customStore=new CustomAgentStore(output,{env:{}});await customStore.reload();
    protocol.handle('app',request=>{const path=decodeURIComponent(new URL(request.url).pathname);if(path.startsWith('/video/'))return new Response('',{status:404});const file=resolve(application,'.'+path);if(!file.startsWith(application+require('node:path').sep))return new Response('',{status:403});return net.fetch(pathToFileURL(file).href);});
    if(process.argv.includes('--visual')) {
      const result=await require('./visual-cases.cjs')({open,evaluate,delay,output,extended:process.argv.includes('--extended')});
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
      await evaluate(workbench,`document.querySelector('[data-setting-target="wallpaper-settings"]').click();document.querySelector('[name="wallpaper-style"]').focus();interfaceFixture.emit('remoteAction','down')`);
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
    // A connection outage must not leave project A's clickable conversations
    // under project B's heading. Exercise the bundled renderer in real Chromium.
    await evaluate(workbench,`(async()=>{const value=(await companion.workspace()).value;value.version++;value.projects.push({id:'second-project',name:'Second project',cwd:'C:/Projects/Second'});interfaceFixture.emit('workspace',value);interfaceFixture.emit('state',{connection:'error'});document.querySelector('[data-project-id="second-project"]').click();})()`);await delay(80);
    assert.equal(await evaluate(workbench,`document.getElementById('project-title').textContent`),'Second project');
    assert.equal(await evaluate(workbench,`document.querySelectorAll('.thread-row').length`),0,'offline project selection removes old conversations');
    assert.equal(await evaluate(workbench,`document.getElementById('more-threads').hidden && document.getElementById('more-history').hidden && document.getElementById('detail').hidden`),true);
    await evaluate(workbench,`interfaceFixture.emit('state',{connection:'ready'})`);await delay(100);
    assert.equal(await evaluate(workbench,`document.querySelectorAll('.thread-row').length`),2,'reconnection refreshes the selected project');
    assert.equal(await evaluate(workbench,`document.getElementById('project-title').textContent`),'Second project');
    checks.push('offline-project-selection-and-reconnect');
    await evaluate(workbench,`document.getElementById('settings-tab').click();document.querySelector('[data-setting-target="agent-settings"]').click()`);
    await until(workbench,`!document.getElementById('agents-add').disabled&&document.getElementById('agent-settings').checkVisibility()`,'custom settings loaded');
    await evaluate(workbench,`document.querySelector('.settings-scroll').scrollTop=0`);await delay(250);
    await capture(workbench,'agent-settings-empty',1120,760);
    await evaluate(workbench,`document.getElementById('agents-add').click();document.getElementById('agent-name').value='自定义测试助手';document.getElementById('agent-pick-program').click()`);
    await until(workbench,`document.getElementById('agent-command').value.endsWith('.exe')&&!document.getElementById('agent-editor-fields').disabled`,'program picker');
    await evaluate(workbench,`document.getElementById('agent-add-argument').click();document.querySelector('#agent-args input').value='C:/Fixture Tools/bridge.mjs';document.getElementById('agent-add-argument').click();document.querySelectorAll('#agent-args input')[1].value='--stdio'`);
    await capture(workbench,'agent-settings-form',1120,760);await capture(workbench,'agent-settings-form-compact',760,540);await capture(workbench,'agent-settings-form-narrow',520,760);
    await evaluate(workbench,`document.getElementById('agent-editor').requestSubmit()`);
    await until(workbench,`document.getElementById('agent-editor').hidden&&document.querySelectorAll('.custom-agent-row').length===1`,'create configuration');
    const created=customStore.entries[0];assert.equal(created.name,'自定义测试助手');assert.deepEqual(created.args,['C:/Fixture Tools/bridge.mjs','--stdio']);
    assert.equal(await evaluate(chat,`!!document.querySelector('#provider-select option[value="${created.id}"]')`),true,'new configuration reaches bubble');
    await evaluate(workbench,`document.querySelector('[data-action="edit"]').click();document.getElementById('agent-name').value='自定义测试助手 · 已编辑';document.getElementById('agent-name').dispatchEvent(new Event('input',{bubbles:true}));companion.workspace().then(result=>interfaceFixture.emit('workspace',result.value))`);
    assert.equal(await evaluate(workbench,`document.getElementById('agent-name').value`),'自定义测试助手 · 已编辑','unrelated updates retain editor input');
    assert.equal(await evaluate(workbench,`document.getElementById('agent-id').readOnly`),true,'existing ID is stable');
    await evaluate(workbench,`document.getElementById('agent-editor').requestSubmit()`);
    await until(workbench,`document.getElementById('agent-editor').hidden`,'edit configuration');
    assert.equal(customStore.entries[0].id,created.id);assert.equal(customStore.entries[0].name,'自定义测试助手 · 已编辑');
    await evaluate(workbench,`document.getElementById('agent-prompt-target').value='示例 Agent';document.getElementById('agent-copy-prompt').click()`);
    await until(workbench,`interfaceFixture.stats().promptCopies===1`,'copy setup prompt');
    const promptText=await evaluate(workbench,`document.getElementById('agent-prompt-preview').value`);
    assert.ok(promptText.includes(JSON.stringify(customStore.file)));assert.match(promptText,/示例 Agent/);assert.match(promptText,/保留其他配置/);
    await evaluate(workbench,`document.querySelector('[data-action="connect"]').click()`);
    await until(workbench,`document.querySelector('[data-action="remove"]').disabled&&document.getElementById('agents-status').textContent.includes('已连接')`,'connect synthetic agent');
    await evaluate(workbench,`document.querySelector('[data-action="edit"]').click();document.querySelectorAll('#agent-args input')[1].value='--updated';document.getElementById('agent-editor').requestSubmit()`);
    await until(workbench,`document.getElementById('agent-editor').hidden&&document.getElementById('agents-list').textContent.includes('重连后生效')`,'active edit pending reconnect');
    assert.equal(fixtureLaunch.args[1],'--stdio','active transport keeps old arguments');
    await evaluate(workbench,`document.querySelector('.settings-scroll').scrollTop=0`);await capture(workbench,'agent-settings-list',1120,760);
    await evaluate(workbench,`document.querySelector('[data-action="connect"]').click()`);
    await until(workbench,`companion.customAgents().then(result=>!result.value.needsReconnect)`,'reconnect applies saved launch');
    assert.equal(fixtureLaunch.args[1],'--updated');
    await evaluate(workbench,`companion.chooseProvider('codex')`);
    await until(workbench,`!document.querySelector('[data-action="remove"]').disabled`,'switch before removal');
    const retained=join(output,'agents',created.id);mkdirSync(retained,{recursive:true});writeFileSync(join(retained,'session.json'),'fixture history remains');
    await evaluate(workbench,`document.querySelector('[data-action="remove"]').click();document.getElementById('agent-confirm-cancel').click()`);
    assert.equal(customStore.entries.length,1,'cancel deletion preserves configuration');
    await evaluate(workbench,`document.querySelector('[data-action="remove"]').click();document.getElementById('agent-confirm-accept').click()`);
    await until(workbench,`document.querySelectorAll('.custom-agent-row').length===0`,'delete configuration');
    assert.equal(require('node:fs').readFileSync(join(retained,'session.json'),'utf8'),'fixture history remains');
    const supplied={...created,id:'custom-from-agent',name:'Agent 帮我添加的助手'};
    writeFileSync(customStore.file,JSON.stringify({format:1,agents:[supplied]}));
    await evaluate(workbench,`document.getElementById('agents-reload').click()`);
    await until(workbench,`document.querySelectorAll('.custom-agent-row').length===1&&document.getElementById('agents-list').textContent.includes('Agent 帮我添加')`,'reload agent-written configuration');
    await evaluate(workbench,`document.querySelector('[data-action="edit"]').click();document.getElementById('agent-name').value='未保存的修改';document.getElementById('agent-name').dispatchEvent(new Event('input',{bubbles:true}))`);
    writeFileSync(customStore.file,JSON.stringify({format:1,agents:[{...supplied,name:'来自其他 Agent 的更新'}]}));
    await evaluate(workbench,`document.getElementById('agent-editor').requestSubmit()`);
    await until(workbench,`document.getElementById('agents-status').textContent.includes('其他操作修改')`,'external update conflict');
    assert.equal(await evaluate(workbench,`document.getElementById('agent-name').value`),'未保存的修改');
    await evaluate(workbench,`document.getElementById('agents-reload').click();document.getElementById('agent-confirm-cancel').click()`);
    assert.equal(await evaluate(workbench,`document.getElementById('agent-name').value`),'未保存的修改');
    await evaluate(workbench,`document.getElementById('agents-reload').click();document.getElementById('agent-confirm-accept').click()`);
    await until(workbench,`document.getElementById('agent-editor').hidden&&document.getElementById('agents-list').textContent.includes('来自其他 Agent 的更新')`,'reload after explicit discard');
    checks.push('custom-agent-settings-create-edit-connect-remove-prompt-and-conflicts');
    // Runtime registrations must reach both pickers without exposing launch
    // configuration, and capability limits must affect the actual controls.
    for(const [win,picker] of [[chat,'provider-select'],[workbench,'agent-select']]) {
      await evaluate(win,`(async()=>{const value=(await companion.workspace()).value;value.version+=10;value.customAgents=[{id:'custom-fixture',name:'本地测试 Agent'}];value.agentConfigError='';interfaceFixture.emit('workspace',value);interfaceFixture.emit('state',{provider:'custom-fixture',connection:'ready',status:'idle',canResume:false,permissionHint:'自定义权限提示'});})()`);await delay(100);
      assert.equal(await evaluate(win,`document.getElementById('${picker}').value`),'custom-fixture');
      assert.match(await evaluate(win,`document.getElementById('${picker}').selectedOptions[0].textContent`),/自定义.*实验/);
      await evaluate(win,`(async()=>{const value=(await companion.workspace()).value;value.version++;interfaceFixture.emit('workspace',value);})()`);
      assert.equal(await evaluate(win,`document.getElementById('${picker}').value`),'custom-fixture','refresh retains custom selection');
    }
    await evaluate(workbench,`document.querySelector('.thread-row').click()`);await delay(50);
    assert.equal(await evaluate(workbench,`document.getElementById('resume').disabled`),true);
    assert.match(await evaluate(workbench,`document.getElementById('permission-hint').textContent`),/本地缓存/);
    await evaluate(workbench,`interfaceFixture.emit('state',{canResume:true})`);
    assert.equal(await evaluate(workbench,`document.getElementById('resume').disabled`),false);
    for(const win of [chat,workbench]) {
      await evaluate(win,`(async()=>{const value=(await companion.workspace()).value;value.version++;value.agentConfigError='配置格式需要修正';interfaceFixture.emit('workspace',value);})()`);
      assert.equal(await evaluate(win,`document.getElementById('agent-config-error').hidden`),false);
    }
    checks.push('custom-agent-pickers-capabilities-and-config-errors');
    assert.deepEqual(errors,[],'Renderer console errors');writeFileSync(join(output,'summary.json'),JSON.stringify({checks,errors,synthetic:true,accounts:false,hardware:false},null,2));
    for(const win of windows)win.destroy();app.exit(0);
  }).catch(error=>{console.error(error);writeFileSync(join(output,'failure.txt'),String(error.stack));app.exit(1);});
}
