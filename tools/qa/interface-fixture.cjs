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
  const workspace={version:1,projects:[{id:'example',name:'Documents',cwd:state.cwd}],settings:{character:'female',animePlayback:'poses',ttsResident:true,ttsEngine:'qwen',qwenVoice:'Serena',autoSpeak:false,prepareSpeech:false,playbackVolume:.8,completionSound:true,shortcuts:{chat:'Control+Alt+Space',record:'Control+Alt+V',send:'Control+Alt+Enter',readReply:'Control+Alt+R',stopSpeech:'Control+Alt+S',workbench:'Control+Alt+P'},remoteKeys:{},rc003:remote.config},speech:{phase:'ready',asr:true,engine:'qwen',engines:{qwen:true,kokoro:true}},resources:{phase:'idle',packs:[{id:'asr',label:'本地听写',installed:true,bytes:200000000},{id:'qwen',label:'自然语音',installed:true,bytes:4000000000},{id:'kokoro',label:'轻量语音',installed:true,bytes:200000000}]}};
  let draft='',sends=0,spoken=0,renderInfo=null,interruptions=0,openedLink='',settingsError='',desktopRetries=0;
  let presentation={mode:'wallpaper',wallpaperKind:'artwork',character:'female',characterRequest:0,chatVisible:false,paused:false,manualPause:false,stills:{animePlayback:'poses'}};
  const applyEvent=(name,value)=>{
    if(name==='settings-error'){settingsError=value;return;}
    if(name==='presentation')presentation={...presentation,...value,stills:{...presentation.stills,...value.stills}};
    if(name==='state')Object.assign(state,value);
    if(name==='workspace'){if(value.version===undefined)workspace.version++;Object.assign(workspace,value);value=workspace;}
    if(name==='wallpaper-request'){workspace.wallpaper={phase:'loading',...value};workspace.version++;name='workspace';value=workspace;}
    emit(name,name==='presentation'?presentation:name==='state'?state:value);
  };
  ipcRenderer.on('fixture:relay',(_event,name,value)=>applyEvent(name,value));
  const api={snapshot:()=>ok(state),workspace:()=>ok(workspace),appearance:()=>ok({scale:1,mode:'wallpaper'}),onState:fn=>on('state',fn),onWorkspace:fn=>on('workspace',fn),onAppearance:fn=>on('appearance',fn),onFocus:fn=>on('focus',fn),onLayout:fn=>on('layout',fn),onRemote:fn=>on('remote',fn),onRemoteAction:fn=>on('remoteAction',fn),onRemoteText:fn=>on('remoteText',fn),onInputAction:fn=>on('inputAction',fn),onSpeech:(event,fn)=>on('speech:'+event,fn),onCompletionSound:fn=>on('sound',fn),onWorkbenchRefresh:fn=>on('workbench',fn),
    chooseProvider:id=>ipcRenderer.invoke('fixture:agents-connect',id),reconnect:()=>ipcRenderer.invoke('fixture:agents-connect',state.provider),
    openLink:href=>{openedLink=href;return ok();},
    interrupt:()=>{interruptions++;applyEvent('state',{status:'idle',approvals:[]});return ok();},
    remote:()=>ok(remote),draft:(_target,text)=>{if(text!==undefined)draft=text;return ok({text:draft});},resizeBubble(){},windowAction:()=>ok(),stopSpeech:()=>ok(),capture:()=>ok(),listThreads:()=>ok({data:[{id:'fixture-first',name:'第一段对话',updatedAt:1},{id:'fixture-second',name:'第二段对话',updatedAt:2}],nextCursor:null}),history:()=>ok({turns:[],nextCursor:null,localOnly:!!state.historyLocalOnly}),learnKey:()=>ok(),send:()=>{sends++;return ok({cancelled:true});},synthesize:()=>{spoken++;return new Promise(()=>{});},setPlaybackVolume:value=>{workspace.settings.playbackVolume=value;workspace.version++;emit('workspace',workspace);return ok(workspace);},
    presentation:()=>ok(presentation),onPresentation:fn=>on('presentation',fn),avatarAnchor(){},commitWallpaper:()=>ok(true),finishWallpaper:()=>({ok:true,value:true}),
    wallpaperControl:action=>{if(action==='retry-desktop'){desktopRetries++;applyEvent('workspace',{desktopWallpaper:{phase:'ready'}});}return ok(workspace);},
    renderReady:info=>{renderInfo=info;},
    saveSettings:async patch=>{if(settingsError)return {ok:false,error:settingsError};if('character' in patch || 'wallpaperKind' in patch)await ipcRenderer.invoke('fixture:wallpaper-choice',patch);else{Object.assign(workspace.settings,patch);workspace.version++;emit('workspace',workspace);}return {ok:true,value:workspace};}};
  contextBridge.exposeInMainWorld('companion',api);
  contextBridge.exposeInMainWorld('interfaceFixture',{emit:(name,value)=>{if(name==='remote')remote={...remote,...value};applyEvent(name,name==='remote'?remote:value);},stats:()=>({sends,draft,spoken,renderInfo,interruptions,openedLink,desktopRetries,volume:workspace.settings.playbackVolume})});
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
  const errors=[],checks=[];let windows=[],fixtureProvider='codex';
  const allowedAgents=['codex','antigravity','grok','claude','deepseek'];
  let fixtureConnection={connection:'ready',status:'idle',error:null,loginHelp:null},fixtureConnectWait,fixtureConnectError;
  const present={mode:'wallpaper',wallpaperKind:'artwork',character:'female',characterRequest:0,chatVisible:false,paused:false,manualPause:false};
  const relay=(name,value)=>{for(const win of windows)if(!win.isDestroyed())win.webContents.send('fixture:relay',name,value);};
  // Synthetic connection: no real CLI processes or accounts.
  ipcMain.handle('fixture:agents-connect',async(_event,id)=>{
    assert.ok(allowedAgents.includes(id),'only a supported Agent can connect in the fixture');
    if(fixtureConnectWait)await fixtureConnectWait;
    if(fixtureConnectError)return {ok:false,error:fixtureConnectError};
    fixtureProvider=id;relay('state',{provider:id,canResume:true,...fixtureConnection});
    return {ok:true};
  });
  ipcMain.handle('fixture:wallpaper-choice',(_event,patch)=>{present.character=patch.character;present.wallpaperKind=patch.wallpaperKind;present.characterRequest++;relay('wallpaper-request',{character:present.character,wallpaperKind:present.wallpaperKind,requestId:present.characterRequest});relay('presentation',present);});
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const connectButton=id=>`document.querySelector('#agents-list .agent-connect[data-agent-id="${id}"]')`;
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
      try {
        // The first hidden capture can contain the previous composited state.
        // Keep it awake for one frame before accepting the evidence image.
        await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await delay(100);
        screenshot=await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});break;
      }
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
        if(group==='agent-settings') {
          await until(workbench,`!${connectButton('codex')}.disabled`,'Agent page ready for native focus check');
          for(const [mode,id] of [['remote','claude'],['keyboard','codex']]) {
            const button=connectButton(id);
            await evaluate(workbench,`${button}.focus()`);
            if(mode==='remote')await evaluate(workbench,`interfaceFixture.emit('remoteAction','confirm')`);
            else {
              workbench.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
              workbench.webContents.sendInputEvent({type:'char',keyCode:'\r'});
              workbench.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
            }
            await until(workbench,`${button}.closest('.agent-row').dataset.active==='true'&&!${button}.disabled`,mode+' focused connection completed');
            const result=await evaluate(workbench,`(()=>{const el=document.activeElement,s=getComputedStyle(el);return {documentFocused:document.hasFocus(),agent:el.dataset.agentId,action:el.dataset.action,focused:el.matches(':focus'),outline:s.outlineStyle,width:parseFloat(s.outlineWidth)}})()`);
            assert.equal(result.documentFocused,true);assert.equal(result.focused,true);assert.equal(result.agent,id);assert.equal(result.action,'connect');assert.notEqual(result.outline,'none');assert.ok(result.width>=2,mode+' connection retains a visible focus outline');
            await capture(workbench,'agent-connection-'+mode+'-focus',1120,760);
          }
          checks.push('Agent connection preserves visible remote and keyboard focus');
        }
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
    const categories=await evaluate(workbench,`(() => {document.getElementById('settings-tab').click();const speed=document.getElementById('speed');speed.value='1.1';speed.dispatchEvent(new Event('change',{bubbles:true}));const shortcut=document.querySelector('#shortcuts input[data-action="chat"]');shortcut.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,altKey:true,bubbles:true}));return [...document.querySelectorAll('[data-setting-target]')].map(button=>button.dataset.settingTarget);})()`);
    for(const id of categories) {
      await evaluate(workbench,`document.querySelector('[data-setting-target="${id}"]').focus();interfaceFixture.emit('remoteAction','confirm')`);
      assert.equal(await evaluate(workbench,`document.activeElement.dataset.settingTarget`),id,'category retains remote navigation focus');
      assert.equal(await evaluate(workbench,`document.getElementById('${id}').hidden`),false,'selected category is visible');
    }
    assert.equal(await evaluate(workbench,`document.getElementById('speed').value`),'1.1','speed auto-saves without losing value');
    assert.equal(await evaluate(workbench,`document.querySelector('#shortcuts input[data-action="chat"]').value`),'Control+Alt+K','category navigation preserves unsaved shortcut input');
    await evaluate(workbench,`document.getElementById('discard-settings').click()`);
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
    await evaluate(workbench,`document.getElementById('manage-agents').click()`);
    const codexButton=connectButton('codex');
    await until(workbench,`!${codexButton}.disabled&&document.getElementById('agent-settings').checkVisibility()`,'fixed Agent page loaded');
    assert.deepEqual(await evaluate(workbench,`[...document.querySelectorAll('#agents-list > .agent-row')].map(row=>row.dataset.agentId)`),allowedAgents);
    assert.equal(await evaluate(workbench,`document.querySelectorAll('#agent-settings button').length`),allowedAgents.length,'each Agent has one connection control');
    assert.match(await evaluate(workbench,`document.getElementById(${connectButton('claude')}.getAttribute('aria-describedby')).textContent`),/Anthropic.*API 认证.*单独计费/);
    assert.equal(await evaluate(workbench,`document.querySelector('.agent-row[data-agent-id="claude"] .agent-api-label').textContent`),'仅 API');
    await evaluate(workbench,`document.getElementById('agent-setup-guide').click()`);
    assert.match(await evaluate(workbench,`interfaceFixture.stats().openedLink`),/github\.com\/code-lawyer\/Rin-Desktop\/.*CLI-AGENTS\.md$/);
    for(const id of ['antigravity','grok','claude','deepseek','codex']) {
      const button=connectButton(id);
      await evaluate(workbench,`${button}.focus();interfaceFixture.emit('remoteAction','confirm')`);
      await until(workbench,`${button}.closest('.agent-row').dataset.active==='true'&&!${button}.disabled`,'builtin connects from Agent page');
      assert.equal(fixtureProvider,id);
      assert.equal(await evaluate(workbench,`document.getElementById('agent-settings').checkVisibility()`),true,'switching Agent keeps the settings page open');
      assert.equal(await evaluate(workbench,`document.activeElement===${button}`),true,'connection restores the activated button after it is enabled');
      if(id==='antigravity') {
        await capture(workbench,'agent-settings-connection-focus',1120,760);
        await evaluate(workbench,`interfaceFixture.emit('remoteAction','down')`);
        assert.equal(await evaluate(workbench,`document.activeElement.dataset.agentId`),'grok','next remote step continues through the Agent list');
      }
    }
    let finishConnection;fixtureConnectWait=new Promise(resolve=>{finishConnection=resolve;});
    await evaluate(workbench,`${codexButton}.focus();interfaceFixture.emit('remoteAction','confirm')`);
    await until(workbench,`${codexButton}.disabled`,'connection in flight');
    await evaluate(workbench,`document.getElementById('back-chat').focus()`);finishConnection();fixtureConnectWait=null;
    await until(workbench,`!${codexButton}.disabled`,'connection finished after focus moved');
    assert.equal(await evaluate(workbench,`document.activeElement.id`),'back-chat','connection does not steal focus from a user-selected control');
    checks.push('agent-connection-focus-and-no-focus-stealing');
    for(const error of ['上次对话未能恢复：Thread not found。可重启重试，或点击「新对话」。','原项目目录不可用，请选择原目录。']) {
      fixtureConnection={connection:'ready',status:'error',error,loginHelp:'不应显示的认证建议'};
      await evaluate(workbench,`${codexButton}.focus();interfaceFixture.emit('remoteAction','confirm')`);
      await until(workbench,`!${codexButton}.disabled`,'connected transport with recovery error');
      const shown=await evaluate(workbench,`({status:document.getElementById('agents-status').textContent,row:document.querySelector('.agent-row[data-active=true]').textContent,color:document.querySelector('.agent-row[data-active=true] .agent-row-status').dataset.state,help:document.getElementById('agent-help').textContent})`);
      assert.equal(shown.status,error);assert.equal(shown.color,'error');assert.ok(shown.row.includes(error));assert.ok(!shown.row.includes(fixtureConnection.loginHelp));assert.equal(shown.help,error);
      assert.equal(await evaluate(workbench,`document.activeElement.dataset.agentId`),'codex','failed recovery also restores the connection button');
      if(error.includes('Thread not found'))await capture(workbench,'agent-settings-recovery-error',1120,760);
    }
    fixtureConnection={connection:'ready',status:'idle',error:null,loginHelp:null};
    await evaluate(workbench,`${codexButton}.click()`);
    await until(workbench,`!${codexButton}.disabled`,'recovery retry succeeds');
    assert.match(await evaluate(workbench,`document.getElementById('agents-status').textContent`),/Codex.*已连接/);
    assert.equal(await evaluate(workbench,`document.querySelector('.agent-row[data-active=true] .agent-row-status').dataset.state`),'ready');
    assert.equal(await evaluate(workbench,`document.querySelector('.agent-row-error:not([hidden])')`),null,'successful retry clears the visible recovery error');
    await evaluate(workbench,`interfaceFixture.emit('state',{connection:'error',status:'error',error:'CLI 已断开，请重新连接。'})`);
    assert.equal(await evaluate(workbench,`document.getElementById('agents-status').textContent`),'CLI 已断开，请重新连接。');
    await evaluate(workbench,`interfaceFixture.emit('state',{connection:'ready',status:'idle',error:null})`);
    fixtureConnectError='无法保存 Agent 选择，请检查数据目录是否可写后重试。';
    const grokButton=connectButton('grok');
    await evaluate(workbench,`${grokButton}.focus();${grokButton}.click()`);
    await until(workbench,`!${grokButton}.disabled&&!${grokButton}.closest('.agent-row').querySelector('.agent-row-error').hidden`,'switch write error appears by the selected Agent');
    assert.equal(await evaluate(workbench,`document.querySelector('.agent-row[data-active=true]').dataset.agentId`),'codex');
    assert.equal(await evaluate(workbench,`document.activeElement===${grokButton}`),true);
    fixtureConnectError=null;
    await evaluate(workbench,`${codexButton}.click()`);
    await until(workbench,`!${codexButton}.disabled`,'Agent recovery follows a failed preference save');
    checks.push('codex-recovery-error-visible-with-connected-transport');
    await evaluate(workbench,`interfaceFixture.emit('state',{status:'working'})`);
    assert.equal(await evaluate(workbench,`[...document.querySelectorAll('#agents-list .agent-connect')].every(button=>button.disabled)`),true,'running task blocks switching every Agent');
    await evaluate(workbench,`interfaceFixture.emit('state',{status:'idle'})`);
    checks.push('fixed-agent-page-and-busy-protection');
    await evaluate(workbench,`document.querySelector('.settings-scroll').scrollTop=0`);
    await capture(workbench,'agent-settings-builtins',1120,760);
    await capture(workbench,'agent-settings-builtins-compact',760,540);
    await capture(workbench,'agent-settings-builtins-narrow',520,760);
    workbench.setSize(1120,760);await delay(100);
    for(const [win,picker] of [[chat,'provider-select'],[workbench,'agent-select']]) {
      await evaluate(win,`interfaceFixture.emit('workspace',{customAgents:[{id:'custom-fixture',name:'旧的 Agent'}],agentConfigError:'旧配置错误'});interfaceFixture.emit('state',{provider:'claude',connection:'ready',status:'idle',canResume:false});`);
      assert.deepEqual(await evaluate(win,`[...document.getElementById('${picker}').options].map(option=>option.value)`),allowedAgents,'legacy configuration does not change current choices');
      assert.equal(await evaluate(win,`document.getElementById('${picker}').value`),'claude');
      const apiLabel = win===chat
        ? `document.getElementById('${picker}').selectedOptions[0].textContent`
        : `document.getElementById('agent-mode-note').textContent`;
      assert.match(await evaluate(win,apiLabel),/仅 API/);
      assert.equal(await evaluate(win,`document.getElementById('agent-config-error')`),null);
    }
    assert.match(await evaluate(chat,`document.getElementById('provider-api-note').textContent`),/Anthropic.*API 认证/);
    await evaluate(chat,`interfaceFixture.emit('workspace',{legacyDotsAvailable:true})`);
    assert.deepEqual(await evaluate(chat,`[...document.getElementById('provider-select').options].map(option=>option.value)`),[...allowedAgents,'dots'],'private Dots still uses its separate availability flag');
    await evaluate(chat,`interfaceFixture.emit('workspace',{legacyDotsAvailable:false})`);
    checks.push('fixed-pickers-ignore-legacy-config-and-preserve-dots');
    await evaluate(workbench,`document.querySelector('.thread-row').click()`);await delay(50);
    assert.equal(await evaluate(workbench,`document.getElementById('resume').disabled`),true);
    assert.match(await evaluate(workbench,`document.getElementById('permission-hint').textContent`),/本地缓存/);
    await evaluate(workbench,`interfaceFixture.emit('state',{canResume:true,historyLocalOnly:true})`);
    assert.equal(await evaluate(workbench,`document.getElementById('resume').disabled`),false);
    assert.match(await evaluate(workbench,`document.getElementById('permission-hint').textContent`),/恢复会话上下文.*本机缓存/);
    await evaluate(workbench,`document.querySelector('.thread-row').click()`);
    await until(workbench,`document.getElementById('history').textContent.includes('没有缓存时不会显示旧消息')`,'resume-only empty history notice');
    checks.push('resume-only-history-notice-and-resume-control');
    for(const provider of allowedAgents) for(const [win,help] of [[chat,'login-help'],[workbench,'agent-help']]) {
      await evaluate(win,`interfaceFixture.emit('state',{provider:${JSON.stringify(provider)},connection:'error',status:'error',error:'测试恢复失败，原会话仍保留。',loginHelp:'测试 Agent 的认证指引'})`);
      assert.equal(await evaluate(win,`document.getElementById('${help}').textContent`),'测试恢复失败，原会话仍保留。','recovery error does not append login advice');
      await evaluate(win,`interfaceFixture.emit('state',{connection:'authentication',error:'Authentication required'})`);
      assert.match(await evaluate(win,`document.getElementById('${help}').textContent`),/Authentication required.*测试 Agent 的认证指引/s);
      if(win===chat)assert.equal(await evaluate(win,`document.getElementById('login-button').hidden`),provider!=='codex','only Codex retains its native login action');
    }
    checks.push('all-agent-connection-errors-and-authentication-help');
    assert.deepEqual(errors,[],'Renderer console errors');writeFileSync(join(output,'summary.json'),JSON.stringify({checks,errors,synthetic:true,accounts:false,hardware:false},null,2));
    for(const win of windows)win.destroy();app.exit(0);
  }).catch(error=>{console.error(error);writeFileSync(join(output,'failure.txt'),String(error.stack));app.exit(1);});
}
