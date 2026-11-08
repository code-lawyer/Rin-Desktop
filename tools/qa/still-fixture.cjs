// Production HTML, bundles and preload; isolated data and synthetic backend.
const {app,BrowserWindow,protocol,net,ipcMain}=require('electron');
const {join,resolve,sep}=require('node:path');
const {writeFileSync,mkdirSync,readFileSync,renameSync}=require('node:fs');
const fs=require('node:fs/promises');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'../..'),application=join(root,'prototypes/live2d-codex'),output=process.argv[2];
if(!output || !resolve(output).startsWith(join(root,'work','qa')+sep))throw new Error('Use an output beneath work/qa.');
const actualMotion=process.argv.includes('--actual-motion');
const puppetRun=process.argv.includes('--puppet');
const characterRestore=process.argv.includes('--character-restore');
mkdirSync(output,{recursive:true});app.setPath('userData',join(output,'profile'));
// Asset preparation itself has a 15s bound. Give the real renderer enough
// time to report that failure even when other QA windows occupy the GPU.
const waitAttempts=600;
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let windows=[],wallpaper,chat,workbench,version=0,store,ambient={phase:'off'},blocked='',expectedFailure=false,persistFault=false,prepareGate,commitReplyGate;
const errors=[],checks=[],acknowledgements=[];
let characterFault, playbackRevision=0;
const characterRequests=[];
const present={mode:'wallpaper',wallpaperKind:'artwork',character:'female',characterRequest:0,chatVisible:false,paused:false,stills:{stillPose:'auto',ambienceEnabled:false},capturing:false,speaking:false,ambientRevision:0,ambientRetry:0};
let wallpaperStatus={phase:'loading',character:'female',requestId:0};
const state={provider:'codex',connection:'ready',status:'idle',cwd:output,projectName:'Example',threadId:'fixture-thread',threadName:'本地验证',models:[],messages:[{role:'assistant',text:'这是离线验证的完整回复。',complete:true}],approvals:[],activity:''};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const js=(win,code)=>win.webContents.executeJavaScript(code);
const sendPresentation=()=>{present.stills={...store.data.settings,wallpaperMotion:wallpaperStatus.wallpaperMotion ?? store.data.settings.wallpaperMotion===true};if(wallpaper&&!wallpaper.isDestroyed()&&!wallpaper.webContents.isCrashed())wallpaper.webContents.send('companion:presentation',present);};
let remote;
const snapshot=()=>({...store.snapshot(),version,speech:{phase:'ready',asr:true,engine:'qwen',engines:{qwen:true,kokoro:true}},remote,wallpaper:wallpaperStatus,ambience:ambient,wallpaperPaused:present.paused,resources:{phase:'idle',packs:[]},shortcutErrors:[]});
const notify=()=>{version++;sendPresentation();for(const w of [chat,workbench])if(w&&!w.isDestroyed())w.webContents.send('workbench:state',snapshot());};
const handler=(name,fn)=>ipcMain.handle(name,async(event,...args)=>{try{return{ok:true,value:await fn(event,...args)};}catch(error){return{ok:false,error:error.message};}});
async function until(win,expression){for(let i=0;i<waitAttempts;i++){if(await js(win,expression))return;await delay(50);}const detail=await js(win,"({hidden:document.hidden,host:{...document.getElementById('wallpaper-view')?.dataset},error:document.getElementById('wallpaper-error')?.textContent})");throw new Error('Timed out: '+expression+' / '+JSON.stringify(detail));}
async function open(file,width,height){
  const win=new BrowserWindow({width,height,show:false,frame:false,webPreferences:{preload:join(application,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});windows.push(win);
  win.webContents.on('console-message',event=>{const {level,message}=event;if((level==='error'||level===3)&&!message.includes('Electron Security Warning')&&message!=='[wallpaper:still] The source image cannot be decoded.'&&!(expectedFailure&&(message.includes('404')||message.startsWith('[wallpaper:still]'))))errors.push(message);});
  await win.loadURL('app://local/renderer/'+file);return win;
}
async function capture(win,name){writeFileSync(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
app.whenReady().then(async()=>{
  const {WorkspaceStore}=await import(pathToFileURL(join(application,'backend/workspace-store.mjs')).href);
  const {remoteSettings}=await import(pathToFileURL(join(application,'backend/remote-config.mjs')).href);
  remote={phase:'disconnected',audio:'idle',config:remoteSettings(),devices:[],keysAvailable:false};
  store=new WorkspaceStore(join(output,'data'),{io:{...fs,open:async(path,...args)=>{if(prepareGate&&path.endsWith('workspaces.json.tmp'))await prepareGate;return fs.open(path,...args);},renameSync:(from,to)=>{if(persistFault&&to.endsWith('workspaces.json'))throw Object.assign(new Error('fixture disk full'),{code:'ENOSPC'});renameSync(from,to);},rename:async(from,to)=>{if(persistFault&&to.endsWith('workspaces.json'))throw Object.assign(new Error('fixture disk full'),{code:'ENOSPC'});return fs.rename(from,to);}}});await store.load();
  if(!characterRestore) { await store.add(output);await store.updateSettings({ttsResident:true,ttsEngine:'qwen',qwenVoice:'Vivian',voice:48,playbackVolume:.8}); }
  present.character=store.data.settings.character;present.stills=store.data.settings;
  wallpaperStatus={phase:'loading',character:present.character,wallpaperMotion:store.data.settings.wallpaperMotion===true,requestId:0};
  const mainSource=readFileSync(join(application,'main.cjs'),'utf8');
  const commitContext=vm.createContext({store,appliedWallpaperRequest:-1,wallpaperCommit:null,setTimeout,clearTimeout,presentation:()=>present,
    isCharacter:require(join(application,'backend/character-profiles.cjs')).isCharacter,
    isWallpaperKind:require(join(application,'backend/wallpaper-choice.cjs')).isWallpaperKind,
    stopSpeech(){present.speaking=false;sendPresentation();},notifyWorkspace:notify,console:{info(){},error(...args){if(!persistFault)console.error(...args);}}});
  Object.defineProperty(commitContext,'wallpaperStatus',{get:()=>wallpaperStatus,set:value=>{wallpaperStatus=value;present.character=value.character;present.characterRequest=value.requestId;}});
  vm.runInContext(mainSource.slice(mainSource.indexOf('async function confirmWallpaper('),mainSource.indexOf('function recoverWallpaperRenderer(')),commitContext);
  const {AmbientBarrier}=require(join(application,'backend/ambient-barrier.cjs'));
  const barrier=new AmbientBarrier({publish(revision){present.ambientRevision=revision;sendPresentation();}});
  const {createMotionMedia}=await import(pathToFileURL(join(application,'backend/motion-media.mjs')).href);
  const motionMedia=await createMotionMedia(join(output,'media'));
  const {isCharacterImageRequest}=await import(pathToFileURL(join(__dirname,'character-asset-probe.mjs')).href);
  protocol.handle('app',async request=>{
    const path=decodeURIComponent(new URL(request.url).pathname);
    if(characterFault && isCharacterImageRequest(request.url,characterFault.character)) {
      const fault=characterFault;characterRequests.push({character:fault.character,path});
      fault.hits++;
      if(fault.hold)await new Promise(resolve=>fault.releases.push(resolve));
      return new Response('',{status:404});
    }
    if(blocked&&path.includes(blocked))return new Response('',{status:404});
    if(process.argv.includes('--motion')&&path.startsWith('/assets/motion/'))return motionMedia.respond(request);
    const file=resolve(application,'.'+path);if(!file.startsWith(application+sep))return new Response('',{status:403});
    return net.fetch(pathToFileURL(file).href);
  });
  handler('companion:snapshot',()=>state);handler('companion:appearance',()=>({scale:1,mode:'wallpaper'}));handler('companion:presentation',()=>present);handler('workbench:snapshot',snapshot);
  handler('remote:command',()=>remote);handler('workbench:list',()=>({data:[],nextCursor:null}));handler('workbench:draft',()=>({text:''}));handler('workbench:learn-key',()=>{});
  handler('speech:stop',()=>{});handler('speech:volume',async(_e,value)=>{await store.updateSettings({playbackVolume:value});notify();return snapshot();});
  handler('speech:synthesize',()=>({samples:Float32Array.from({length:24000*2},(_,i)=>puppetRun && Math.floor(i/4800)%2===0 ? .14*Math.sin(2*Math.PI*220*i/24000) : 0),sampleRate:24000}));
  handler('speech:playback',async(_e,active)=>{const revision=++playbackRevision;present.speaking=active;if(active)await barrier.wait();else sendPresentation();return {revision};});
  const mouthContext=vm.createContext({ipcMain,trusted:()=>true,Date});
  Object.defineProperties(mouthContext,{chat:{get:()=>chat},avatar:{get:()=>wallpaper},speaking:{get:()=>present.speaking},playbackRevision:{get:()=>playbackRevision}});
  vm.runInContext(mainSource.slice(mainSource.indexOf('    let lastMouthAt ='),mainSource.indexOf("    handler('wallpaper:control'")),mouthContext);
  handler('speech:capture',async(_e,target)=>{present.capturing=!!target;if(target)await barrier.wait();else sendPresentation();});
  handler('companion:window',(_e,action)=>{if(action==='show-chat'||action==='recall-chat'){present.chatVisible=true;chat.show();}else if(action==='workbench'){present.chatVisible=false;chat.hide();workbench.show();}sendPresentation();});
  handler('wallpaper:control',(_e,action,value)=>{if(action==='pause')present.paused=value;else if(action==='gesture')throw Error('单次骨骼动作已停用');else{present.ambientRetry++;commitContext.recoverWallpaperRenderer();}notify();return snapshot();});
  handler('wallpaper:commit',async(_e,info)=>{const result=await commitContext.confirmWallpaper(info);if(commitReplyGate)await commitReplyGate;return result;});
  ipcMain.on('wallpaper:finish',(event,info,accept)=>{event.returnValue={ok:true,value:commitContext.finishWallpaper(info,accept)};});
  handler('workbench:settings',async(_e,patch)=>{
    const choice=require(join(application,'backend/wallpaper-choice.cjs')).wallpaperChoice(patch,store.data.settings);
    if(choice){commitContext.cancelWallpaperCommit();present.character=choice.character;present.characterRequest++;wallpaperStatus={phase:'loading',...choice,requestId:present.characterRequest};patch={...patch};delete patch.character;delete patch.wallpaperKind;delete patch.wallpaperMotion;}
    if(Object.keys(patch).length)await store.updateSettings(patch);notify();return snapshot();
  });
  ipcMain.on('wallpaper:ambient-applied',(_e,revision)=>{acknowledgements.push(revision);barrier.acknowledge(revision);});
  ipcMain.on('wallpaper:ambient-status',(_e,value)=>{if(JSON.stringify(ambient)!==JSON.stringify(value)){ambient=value;notify();}});
  ipcMain.on('companion:render-ready',async(_e,info)=>{
    if(info.requestId!==present.characterRequest)return;
    if(info.error)await commitContext.confirmWallpaper(info);
    else if(info.ready)wallpaperStatus=require('../../prototypes/live2d-codex/backend/wallpaper-report.cjs').acceptWallpaperReport(wallpaperStatus,info,commitContext.appliedWallpaperRequest,store.data.settings.character);
    notify();
  });
  wallpaper=await open('index.html?view=wallpaper',actualMotion?3840:1280,actualMotion?2160:800);wallpaper.showInactive();sendPresentation();
  chat=await open('index.html?view=chat',440,520);workbench=await open('workbench.html',1120,850);
  Object.assign(commitContext,{avatar:wallpaper,wallpaperMode:true,ambientBarrier:barrier,lastPresentation:''});
  Object.defineProperty(commitContext,'ambienceStatus',{get:()=>ambient,set:value=>{ambient=value;}});
  vm.runInContext(mainSource.slice(mainSource.indexOf("    avatar.webContents.on('did-start-loading'"),mainSource.indexOf('    const handler =')),commitContext);
  vm.runInContext(mainSource.slice(mainSource.indexOf('function recoverWallpaperRenderer('),mainSource.indexOf('function switchAllowed()')),commitContext);
  const host="document.getElementById('wallpaper-view')";
  await until(wallpaper,host+".dataset.ready==='true'");
  if(puppetRun) {
    chat.webContents.setAudioMuted(true);
    wallpaper.webContents.setAudioMuted(true);
    const puppet="document.querySelector('.wallpaper-puppet[data-active=true]')";
    await until(wallpaper,host+".dataset.rig==='scene'");
    await capture(wallpaper,'rin-work');
    assert.equal(await js(wallpaper,"document.querySelectorAll('.wallpaper-puppet').length"),1);
    for(const pose of ['attention','window','thinking','cup','work']) {
      await js(workbench,`document.querySelector('[data-pose=${pose}]').click()`);
      await until(wallpaper,host+`.dataset.pose==='${pose}'`);
      await until(wallpaper,`${puppet}.dataset.actualPose==='${pose}' && Number(${puppet}.dataset.poseAmount)===1`);
      if(pose==='cup')assert.equal(await js(wallpaper,`${puppet}.dataset.cupStage`),'held');
      await capture(wallpaper,'rin-'+pose);
    }
    checks.push('all five workbench pose buttons show intact paintings; the cup is part of its pose');
    await js(workbench,"companion.saveSettings({ambienceEnabled:true})");
    await until(wallpaper,host+".dataset.audioState==='ready' && "+host+".dataset.audioKeys==='0.08'");
    assert.equal(await js(workbench,"document.querySelectorAll('[data-gesture]').length"),0);
    assert.equal((await js(workbench,"companion.wallpaperControl('gesture','wave')")).ok,false);
    await js(wallpaper,`window.poseTrace=[];window.traceUntil=performance.now()+4000;function tracePose(){const e=${puppet};poseTrace.push({pose:e.dataset.actualPose,opacity:Number(e.dataset.poseAmount),phase:e.dataset.transitionPhase});if(performance.now()<traceUntil)requestAnimationFrame(tracePose);}requestAnimationFrame(tracePose);`);
    for(const pose of ['cup','thinking','window']){await js(workbench,`companion.saveSettings({stillPose:'${pose}'})`);await delay(45);}
    await until(wallpaper,`${puppet}.dataset.actualPose==='window' && ${puppet}.dataset.transitionPhase==='steady'`);
    assert.equal(await js(wallpaper,host+'.dataset.audioKeys'),'0');
    await delay(1800);
    const trace=await js(wallpaper,'poseTrace');
    for(let i=1;i<trace.length;i++)if(trace[i].pose!==trace[i-1].pose)assert.equal(trace[i].opacity,0,'production renderer changes a painting only at zero opacity');
    assert.ok(trace.some(frame=>frame.opacity===0));
    assert.ok(trace.every(frame=>!['cup','thinking'].includes(frame.pose)),'obsolete intermediate selections are skipped');
    checks.push('rapid pose choices coalesce; actual frame changes occur only at zero opacity; retired gesture controls are absent');
    await js(workbench,"companion.saveSettings({stillPose:'cup'})");
    await until(wallpaper,`${puppet}.dataset.actualPose==='cup' && ${puppet}.dataset.transitionPhase==='steady'`);
    await js(workbench,"companion.windowAction('show-chat')");
    await until(wallpaper,`${puppet}.dataset.actualPose==='attention' && ${puppet}.dataset.transitionPhase==='steady'`);
    assert.equal(await js(wallpaper,host+'.dataset.activity'),'chat');
    assert.equal(store.data.settings.stillPose,'cup');
    await js(chat,"companion.windowAction('workbench')");
    await until(wallpaper,`${puppet}.dataset.actualPose==='cup' && ${puppet}.dataset.transitionPhase==='steady'`);
    assert.equal(await js(wallpaper,host+'.dataset.activity'),'manual');
    checks.push('waking the chat overrides a saved cup pose and closing the chat restores it without changing the saved preference');
    await js(workbench,"companion.saveSettings({stillPose:'work'})");
    await until(wallpaper,`${puppet}.dataset.actualPose==='work' && ${puppet}.dataset.transitionPhase==='steady'`);
    await until(wallpaper,host+".dataset.audioKeys==='0.08'");
    await js(workbench,"companion.saveSettings({ambienceEnabled:false})");
    await js(workbench,"companion.wallpaperControl('pause',true)");await delay(150);
    const frozen=(await wallpaper.webContents.capturePage()).toBitmap();
    await js(workbench,"companion.saveSettings({stillPose:'window'})");await delay(250);
    assert.equal(await js(wallpaper,host+'.dataset.pose'),'work');
    assert.ok((await wallpaper.webContents.capturePage()).toBitmap().equals(frozen),'paused pixels stay frozen');
    await js(workbench,"companion.wallpaperControl('pause',false)");await until(wallpaper,host+".dataset.pose==='window'");
    checks.push('pause freezes rendered pixels; resume applies the newest state');
    // Electron keeps document.visibilityState visible when throttling is
    // disabled. Enable normal window visibility for this specific check.
    wallpaper.webContents.setBackgroundThrottling(true);wallpaper.hide();await until(wallpaper,'document.hidden');
    const hiddenFrame=await js(wallpaper,"document.querySelector('.wallpaper-puppet[data-active=true] canvas').toDataURL()");
    await delay(300);
    assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-puppet[data-active=true] canvas').toDataURL()"),hiddenFrame,'hidden wallpaper does not keep painting');
    wallpaper.showInactive();await until(wallpaper,'!document.hidden');wallpaper.webContents.setBackgroundThrottling(false);
    checks.push('hidden wallpaper suspends drawing and resumes without reloading the scene');
    chat.webContents.send('speech:reply',{text:'动漫角色口型离线验证。',preview:true});
    await until(wallpaper,`Number(${puppet}.dataset.mouth)>.2`);
    await until(wallpaper,host+".dataset.pose==='attention'");await capture(wallpaper,'rin-speaking');
    await until(wallpaper,`Number(${puppet}.dataset.mouth)===0 && ${host}.dataset.pose==='window'`);
    await js(chat,"companion.mouth({revision:-1,level:1})");await delay(120);
    assert.equal(await js(wallpaper,`Number(${puppet}.dataset.mouth)`),0);
    checks.push('production speech UI and IPC drive mouth from burst/silent PCM, close after playback and reject stale samples');
    chat.webContents.send('speech:reply',{text:'口型静音和取消验证。',preview:true});
    await until(wallpaper,`Number(${puppet}.dataset.mouth)>.2`);
    await js(chat,"document.getElementById('playback-volume').value='0';document.getElementById('playback-volume').oninput()");
    await until(wallpaper,`Number(${puppet}.dataset.mouth)===0`);
    await delay(250);assert.equal(await js(wallpaper,`Number(${puppet}.dataset.mouth)`),0);
    await js(chat,"document.getElementById('playback-volume').value='80';document.getElementById('playback-volume').oninput()");
    await until(wallpaper,`Number(${puppet}.dataset.mouth)>.2`);
    await js(chat,"document.getElementById('stop-speech').click()");
    await until(wallpaper,`Number(${puppet}.dataset.mouth)===0 && ${host}.dataset.pose==='window'`);
    checks.push('muting actual playback closes the mouth, restoring volume resumes it and cancellation closes it');
    expectedFailure=true;blocked='/scene/rin-poses/cup-blink.png';
    await js(workbench,"companion.saveSettings({wallpaperMotion:false})");await until(workbench,"!document.getElementById('retry-character').hidden");
    assert.equal(await js(wallpaper,"document.querySelectorAll('.wallpaper-puppet').length"),1);
    assert.equal(store.data.settings.wallpaperMotion===true,false);
    blocked='';await js(workbench,"document.getElementById('retry-character').click()");
    await until(wallpaper,host+".dataset.loading==='false' && !"+host+".dataset.error");
    await until(workbench,"document.getElementById('retry-character').hidden");expectedFailure=false;
    checks.push('failed model replacement retains the old character; explicit retry disposes the failed candidate and recovers');
    let releaseRigCommit;commitReplyGate=new Promise(resolve=>{releaseRigCommit=resolve;});expectedFailure=true;
    await js(wallpaper,"window.retainedScene=document.querySelector('.wallpaper-puppet[data-active=true]')");
    await js(workbench,"companion.saveSettings({wallpaperMotion:false})");
    for(let i=0;i<120&&!commitContext.wallpaperCommit;i++)await delay(20);
    assert.ok(commitContext.wallpaperCommit,'model commit is held');
    await js(wallpaper,"document.querySelector('.wallpaper-puppet:not([data-active]) canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()");
    await until(wallpaper,"document.querySelector('.wallpaper-puppet:not([data-active]) canvas').hidden");
    releaseRigCommit();commitReplyGate=null;
    await until(workbench,"!document.getElementById('retry-character').hidden");
    assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-puppet[data-active=true]')===window.retainedScene"),true);
    assert.equal(await js(wallpaper,"document.querySelectorAll('.wallpaper-puppet').length"),1);
    await js(workbench,"document.getElementById('retry-character').click()");
    await until(wallpaper,host+".dataset.loading==='false' && !"+host+".dataset.error");expectedFailure=false;
    checks.push('context loss during a held settings commit rejects the candidate and retains the healthy visible rig');
    for(let i=0;i<8;i++) {
      await js(workbench,"companion.saveSettings({wallpaperMotion:false})");
      await until(wallpaper,host+".dataset.loading==='false' && !"+host+".dataset.error");
      assert.equal(await js(wallpaper,"document.querySelectorAll('.wallpaper-puppet').length"),1);
    }
    checks.push('eight model replacements retain one scene and release previous WebGL contexts');
    await js(workbench,"companion.saveSettings({stillPose:'work',ambienceEnabled:true})");
    await until(wallpaper,`${puppet}.dataset.actualPose==='work' && ${puppet}.dataset.transitionPhase==='steady' && ${host}.dataset.audioKeys==='0.08'`);
    const beforeLoss=await js(wallpaper,"document.querySelector('.wallpaper-puppet[data-active=true] .rin-fallback').hidden");assert.equal(beforeLoss,true);
    await js(wallpaper,"document.querySelector('.wallpaper-puppet[data-active=true] canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()");
    await until(workbench,"!document.getElementById('retry-character').hidden");
    assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-puppet[data-active=true] .rin-fallback').hidden"),false);
    await until(wallpaper,host+".dataset.audioKeys==='0' && "+host+".dataset.typing==='false'");
    assert.equal(await js(wallpaper,host+'.dataset.pose'),'attention','fallback reports the actual complete painting');
    assert.equal(await js(wallpaper,host+'.dataset.audioRain'),'0.12','rain remains independent of a failed character');
    await js(workbench,"document.getElementById('retry-character').click()");
    await until(wallpaper,host+".dataset.loading==='false' && !"+host+".dataset.error");
    await until(wallpaper,host+".dataset.audioKeys==='0.08'");
    await js(workbench,"companion.saveSettings({stillPose:'window',ambienceEnabled:false})");
    await until(wallpaper,`${puppet}.dataset.actualPose==='window' && ${puppet}.dataset.transitionPhase==='steady'`);
    checks.push('WebGL loss from work displays and reports the neutral fallback, stops keyboard sound while retaining rain; retry restores rendering and work sound');
    assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,48);
    await js(workbench,"document.getElementById('settings-tab').click()");await capture(workbench,'rin-settings');
    wallpaper.webContents.debugger.attach('1.3');
    await wallpaper.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await delay(200);
    const stillReduced=await js(wallpaper,"document.querySelector('.wallpaper-puppet[data-active=true] canvas').toDataURL()");
    await delay(400);
    assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-puppet[data-active=true] canvas').toDataURL()"),stillReduced,'reduced motion stops all idle pixel changes');
    chat.webContents.send('speech:reply',{text:'减少动态效果仍保留口型。',preview:true});
    await until(wallpaper,`Number(${puppet}.dataset.mouth)>.2`);
    await js(chat,"document.getElementById('stop-speech').click()");
    await until(wallpaper,`Number(${puppet}.dataset.mouth)===0`);
    await wallpaper.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    checks.push('OS reduced motion freezes idle pixels while retaining actual playback lip sync');
    await wallpaper.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:2,mobile:false});
    await until(wallpaper,"innerWidth===1920 && innerHeight===1080 && Math.abs(devicePixelRatio-2)<.001");
    await delay(200);
    const rendering=await js(wallpaper,`new Promise(resolve=>{const times=[];let previous;function frame(now){if(previous!==undefined)times.push(now-previous);previous=now;if(times.length===120){times.sort((a,b)=>a-b);resolve({medianFrameMs:times[60],p95FrameMs:times[114],canvas:[document.querySelector('.rin-character:not(img)').width,document.querySelector('.rin-character:not(img)').height],desktop:[${host}.dataset.renderWidth,${host}.dataset.renderHeight]});}else requestAnimationFrame(frame);}requestAnimationFrame(frame);})`);
    assert.deepEqual(rendering.desktop,['3840','2160']);
    assert.ok(rendering.canvas[1]>=2160,'the character buffer follows high-DPI output');
    const shot=await wallpaper.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1920,height:1080,scale:1}});
    writeFileSync(join(output,'rin-4k-render.png'),Buffer.from(shot.data,'base64'));wallpaper.webContents.debugger.detach();
    checks.push('3840x2160 emulated output uses a full-density character drawing buffer; 120 frame intervals recorded');
    const details=await js(wallpaper,`({viewport:[innerWidth,innerHeight],canvas:[document.querySelector('.rin-character:not(img)').width,document.querySelector('.rin-character:not(img)').height],status:{...${host}.dataset}})`);
    assert.deepEqual(errors,[]);
    writeFileSync(join(output,'report.json'),JSON.stringify({checks,errors,details,rendering,gpuFeatureStatus:app.getGPUFeatureStatus(),accounts:false,hardware:false,physical4kAcceptance:false},null,2));
    barrier.close();for(const win of windows)win.destroy();app.exit(0);return;
  }
  const assertCharacter=async(character,qwenVoice,voice)=>{
    await until(workbench,`document.getElementById('qwen-voice').value===${JSON.stringify(qwenVoice)} && document.getElementById('voice').value===${JSON.stringify(String(voice))}`);
    await store.queue;
    for(const settings of [store.data.settings,JSON.parse(await fs.readFile(store.file,'utf8')).settings]) {
      assert.equal(settings.character,character);assert.equal(settings.qwenVoice,qwenVoice);assert.equal(settings.voice,voice);
    }
    assert.equal(await js(wallpaper,host+'.dataset.character'),character);
  };
  const finishCharacter=(name,details={})=>{
    assert.deepEqual(errors,[]);
    writeFileSync(join(output,name+'.json'),JSON.stringify({checks,errors,...details,accounts:false,hardware:false},null,2),{flag:'wx'});
    barrier.close();for(const win of windows)win.destroy();app.exit(0);
  };
  if(characterRestore) {
    const expected=JSON.parse(await fs.readFile(join(output,'character-before-restart.json'),'utf8'));
    await assertCharacter('female','Uncle_Fu',59);
    assert.equal(store.data.settings.wallpaperMotion,true);
    // Loading can materialize default fields absent from the saved object;
    // every value that was actually persisted must still survive the restart.
    for(const [key,value] of Object.entries(expected.settings))assert.deepEqual(store.data.settings[key],value,key);
    assert.equal(wallpaperStatus.phase,'ready');
    assert.equal(await js(workbench,"document.getElementById('retry-character').hidden"),true);
    checks.push('fresh Electron process restores the last successful character and custom voices after a failed replacement');
    finishCharacter('character-restore');return;
  }
  if(process.argv.includes('--character-switch')) {
    const pick=style=>js(workbench,`document.querySelector('[name="wallpaper-style"][value="${style}"]').click()`);
    const retry=()=>js(workbench,"document.getElementById('retry-character').click()");
    const waitError=()=>until(workbench,"!document.getElementById('retry-character').hidden");
    const waitHeld=async()=>{for(let i=0;i<120;i++){if(characterFault.releases.length)return;await delay(50);}throw new Error('No held wallpaper image request: '+JSON.stringify(characterRequests));};
    const arm=(character,hold=false)=>{expectedFailure=true;characterFault={character,hold,hits:0,releases:[]};return characterFault;};
    await js(workbench,"document.getElementById('settings-tab').click()");
    assert.deepEqual(await js(workbench,"[...document.querySelectorAll('[name=wallpaper-style]')].map(r=>r.value)"),['anime','realistic']);
    const pixels=await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()");
    const fault=arm('realistic',true);
    await pick('realistic');await waitHeld();await assertCharacter('female','Vivian',48);
    assert.equal(wallpaperStatus.phase,'loading');assert.equal(store.data.settings.wallpaperMotion===true,false);
    await js(wallpaper,`companion.renderReady({ready:true,character:'female',wallpaperMotion:true,requestId:${present.characterRequest-1}})`);
    assert.equal(store.data.settings.wallpaperMotion===true,false);
    fault.hold=false;for(const release of fault.releases.splice(0))release();await waitError();
    assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()"),pixels);
    checks.push('held and failed realistic poster retains anime canvas, saved style and custom voices; stale ready is ignored');
    const hits=fault.hits;await retry();await waitError();assert.ok(fault.hits>hits);
    characterFault=null;await retry();await until(wallpaper,host+".dataset.rig==='motion'");
    await assertCharacter('female','Vivian',48);assert.equal(store.data.settings.wallpaperMotion,true);
    checks.push('repeated image failure remains explicit and successful retry persists realistic style without resetting voices');
    await js(workbench,"companion.saveSettings({qwenVoice:'Uncle_Fu',voice:59})");
    await wallpaper.webContents.session.clearCache();await wallpaper.loadURL('app://local/renderer/index.html?view=wallpaper');
    await until(wallpaper,host+".dataset.ready==='true'");
    const older=arm('anime',true);await pick('anime');await waitHeld();await pick('realistic');
    characterFault=null;for(const release of older.releases.splice(0))release();
    await until(wallpaper,host+".dataset.rig==='motion'");await delay(200);
    await assertCharacter('female','Uncle_Fu',59);assert.equal(store.data.settings.wallpaperMotion,true);assert.equal(wallpaperStatus.phase,'ready');
    checks.push('rapid return to realistic style discards the older failed anime request and preserves custom voices');
    const final=arm('anime');await pick('anime');await waitError();assert.ok(final.hits);
    assert.equal(store.data.settings.wallpaperMotion,true);await assertCharacter('female','Uncle_Fu',59);
    writeFileSync(join(output,'character-before-restart.json'),JSON.stringify({settings:store.data.settings},null,2),{flag:'wx'});
    checks.push('a failed anime replacement does not persist before process exit');
    finishCharacter('character-switch',{requests:characterRequests});return;
  }
  if(process.argv.includes('--motion')) {
    await js(workbench,"document.querySelector('[name=wallpaper-style][value=realistic]').click()");
    await until(wallpaper,host+".dataset.motionClip==='work-loop' && Number("+host+".dataset.motionPlayCount)>=3");
    assert.match(await js(workbench,"document.getElementById('still-help').textContent"),/工作与看向你.*循环播放/);
    assert.doesNotMatch(await js(workbench,"document.getElementById('still-help').textContent"),/捧杯|托腮|看雨/);
    const mediaPlayback=await js(wallpaper,"[...document.querySelectorAll('.wallpaper-motion')].map(video=>({width:video.videoWidth,height:video.videoHeight,readyState:video.readyState,quality:video.getVideoPlaybackQuality().toJSON?.()||{totalVideoFrames:video.getVideoPlaybackQuality().totalVideoFrames,droppedVideoFrames:video.getVideoPlaybackQuality().droppedVideoFrames}}))");
    let steadyPlayback;
    if(actualMotion){
      assert.ok(mediaPlayback.some(video=>video.width===3840&&video.height===2160));await capture(wallpaper,'motion-work-4k');
      steadyPlayback=await js(wallpaper,`new Promise((resolve,reject)=>{
        const host=document.getElementById('wallpaper-view'),changes=[],started=performance.now();
        const read=()=>[...document.querySelectorAll('.wallpaper-motion')].map(v=>{const q=v.getVideoPlaybackQuality();return{total:q.totalVideoFrames,dropped:q.droppedVideoFrames};});
        const before=read(),observer=new MutationObserver(()=>{changes.push({time:performance.now()-started,count:Number(host.dataset.motionPlayCount)});if(changes.length>=9){observer.disconnect();clearTimeout(timer);resolve({changes,before,after:read(),viewport:{width:innerWidth,height:innerHeight,devicePixelRatio}});}});
        const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Steady loop measurement timed out'));},25000);
        observer.observe(host,{attributes:true,attributeFilter:['data-motion-play-count']});
      })`);
      checks.push('nine additional real work-loop handoffs measured after decoder warmup');
    }
    assert.equal(await js(wallpaper,"document.querySelectorAll('.wallpaper-motion[data-active=true]').length"),1);
    assert.equal(store.data.settings.qwenVoice,'Vivian'); assert.equal(store.data.settings.voice,48);
    checks.push('production UI enables continuous work loops without resetting custom voices');
    present.chatVisible=true; sendPresentation();
    await until(wallpaper,host+".dataset.motionClip==='work-user'");
    await until(wallpaper,host+".dataset.motionClip==='user-loop'");
    if(actualMotion)await capture(wallpaper,'motion-user-4k');
    assert.equal(wallpaperStatus.pose,'attention');
    await until(workbench,"document.getElementById('still-status').textContent.includes('循环播放')");
    present.chatVisible=false; sendPresentation();
    await until(wallpaper,host+".dataset.motionClip==='user-work'");
    await until(wallpaper,host+".dataset.motionClip==='work-loop'");
    checks.push('opening and closing dialogue plays both turns and real idle video through the workbench status');
    await js(workbench,"companion.saveSettings({ambienceEnabled:true})");
    await until(wallpaper,host+".dataset.audioState==='ready' && "+host+".dataset.audioKeys==='0.08'");
    await js(chat,"companion.capture({provider:'codex',cwd:'fixture',threadId:'fixture'})");
    assert.deepEqual(await js(wallpaper,`[Number(${host}.dataset.audioRain),Number(${host}.dataset.audioKeys)]`),[0,0]);
    await until(wallpaper,host+".dataset.motionClip==='user-loop'");
    await js(chat,'companion.capture(null)');
    chat.webContents.send('speech:reply',{text:'动态壁纸离线朗读验证。',preview:true});
    await until(wallpaper,host+".dataset.audioRain==='0.024'");
    assert.equal(await js(wallpaper,host+".dataset.audioKeys"),'0');
    await until(wallpaper,host+".dataset.audioRain==='0.12'");
    checks.push('microphone acknowledgement mutes both channels and real speech-ui narration ducks rain');
    await js(workbench,"companion.wallpaperControl('pause',true)");
    await until(wallpaper,"[...document.querySelectorAll('.wallpaper-motion')].every(video=>video.paused)");
    const paused=await js(wallpaper,"[...document.querySelectorAll('.wallpaper-motion')].map(video=>video.currentTime)");
    await delay(200); assert.deepEqual(await js(wallpaper,"[...document.querySelectorAll('.wallpaper-motion')].map(video=>video.currentTime)"),paused);
    await js(workbench,"companion.wallpaperControl('pause',false)");
    checks.push('pause stops both decoders and resumes playback');
    // Force a fresh character request so the range reads cannot use a previous decoder cache.
    blocked='/assets/motion/female/work-loop.mp4'; expectedFailure=true;
    await js(workbench,"companion.saveSettings({character:'female'})");
    await until(workbench,"!document.getElementById('retry-character').hidden");
    assert.equal(store.data.settings.qwenVoice,'Vivian'); assert.equal(store.data.settings.voice,48);
    assert.equal(await js(wallpaper,host+".dataset.ready"),'true');
    blocked=''; await js(workbench,"document.getElementById('retry-character').click()");
    await until(wallpaper,host+".dataset.motionClip==='work-loop' && "+host+".dataset.motionPhase==='loop'");
    await until(workbench,"document.getElementById('retry-character').hidden"); expectedFailure=false;
    checks.push('unavailable video retains a decoded poster and voices; explicit retry recovers playback and status');
    await js(workbench,"document.querySelector('[name=wallpaper-style][value=anime]').click()");
    await until(wallpaper,host+".dataset.rig==='scene'");
    assert.equal(await js(wallpaper,"document.querySelectorAll('.wallpaper-motion').length"),0);
    assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,48);
    assert.match(await js(workbench,"document.getElementById('still-help').textContent"),/眨眼|转头/);
    checks.push('anime mode restores our live character, removes video decoders and preserves custom voices');
    await capture(workbench,'motion-workbench');
    writeFileSync(join(output,'report.json'),JSON.stringify({checks,errors,syntheticMedia:!actualMotion,mediaPlayback,steadyPlayback,gpuFeatureStatus:actualMotion?app.getGPUFeatureStatus():null,accounts:false,hardware:false},null,2));
    assert.deepEqual(errors,[]); barrier.close(); for(const win of windows)win.destroy(); app.exit(0); return;
  }
  if(process.argv.includes('--pose-recovery')) {
    // Gaze changes cannot acknowledge a failed model replacement transaction.
    await js(wallpaper,"window.retainedScene=document.querySelector('.wallpaper-puppet')");
    expectedFailure=true;blocked='/scene/rin-poses/cup-blink.png';
    await js(workbench,"companion.saveSettings({wallpaperMotion:false})");
    await until(workbench,"!document.getElementById('retry-character').hidden");
    assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-puppet')===window.retainedScene"),true);
    assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,48);
    checks.push('failed model replacement retains the active scene and custom voices');
    blocked='';expectedFailure=false;
    await js(workbench,"companion.saveSettings({stillPose:'window'})");
    await until(wallpaper,host+".dataset.pose==='window'");await delay(150);
    const recovered={displayedPose:await js(wallpaper,host+'.dataset.pose'),wallpaper:{...wallpaperStatus},
      ui:await js(workbench,"({status:document.getElementById('still-status').textContent,error:document.getElementById('character-status').textContent,retryVisible:!document.getElementById('retry-character').hidden})")};
    workbench.show();await js(workbench,"document.getElementById('settings-tab').click()");await delay(150);
    await capture(workbench,'pose-recovery-status');await capture(wallpaper,'pose-recovery-wallpaper');
    await js(workbench,"document.getElementById('retry-character').click()");
    await until(wallpaper,host+".dataset.loading==='false' && !"+host+".dataset.error");
    await until(workbench,"document.getElementById('retry-character').hidden && document.getElementById('still-status').textContent.includes('看向窗外')");
    assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,48);
    checks.push('explicit retry recovers the successful pose status without resetting custom voices');
    writeFileSync(join(output,'pose-recovery.json'),JSON.stringify({afterDifferentPose:recovered,afterExplicitRetry:{...wallpaperStatus},checks,synthetic:true,accounts:false,hardware:false},null,2));
    assert.equal(recovered.wallpaper.phase,'error','a gaze update cannot commit a failed model replacement');
    assert.equal(recovered.displayedPose,'window');assert.equal(recovered.ui.retryVisible,true);
    assert.equal(wallpaperStatus.phase,'ready');assert.equal(wallpaperStatus.pose,'window');
    barrier.close();for(const win of windows)win.destroy();app.exit(0);return;
  }
  await js(wallpaper,"window.retainedScene=document.querySelector('.wallpaper-puppet')");
  for(const pose of ['work','cup','thinking','window','attention']){
    await js(workbench,`companion.saveSettings({stillPose:'${pose}'})`);await until(wallpaper,host+`.dataset.pose==='${pose}'`);
    assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-puppet')===window.retainedScene"),true,pose+' retains the same model');
    assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,48);
    await capture(wallpaper,'pose-'+pose);checks.push('live model state '+pose+' / custom voices retained');
  }
  await js(workbench,"document.querySelector('#still-previews [data-pose=cup]').click()");await until(wallpaper,host+".dataset.pose==='cup'");
  await until(workbench,"document.getElementById('still-status').textContent.includes('拿杯喝水') && document.getElementById('still-status').textContent.includes('固定姿态')");
  assert.equal(await js(workbench,"document.querySelector('#still-previews [data-pose=cup]').getAttribute('aria-pressed')"),'true');
  checks.push('pose thumbnails select the actual frame and show the fixed-pose reason');
  await js(workbench,"companion.saveSettings({stillPose:'work',ambienceEnabled:true})");await until(wallpaper,host+".dataset.audioState==='ready' && "+host+".dataset.audioKeys==='0.08'");
  const levels=()=>js(wallpaper,`[Number(${host}.dataset.audioRain),Number(${host}.dataset.audioKeys)]`);
  assert.deepEqual(await levels(),[.12,.08]);
  await js(chat,"companion.capture({provider:'codex',cwd:'fixture',threadId:'fixture'})");assert.deepEqual(await levels(),[0,0]);checks.push('capture acknowledgement arrives only after both ambient channels mute');
  await js(chat,'companion.capture(null)');await until(wallpaper,host+".dataset.audioRain==='0.12'");
  // Real speech-ui starts and ends a synthesized silent PCM fixture. No model.
  chat.webContents.send('speech:reply',{text:'离线播放状态验证。',preview:true});await until(wallpaper,host+".dataset.audioRain==='0.024'");
  assert.equal((await levels())[1],0);await until(wallpaper,host+".dataset.audioRain==='0.12'");checks.push('actual narration start/end ducks rain and stops keys through production preload');
  await js(workbench,"companion.wallpaperControl('pause',true)");await until(wallpaper,host+".dataset.paused==='true'");
  await js(workbench,"companion.saveSettings({stillPose:'window'})");await delay(150);assert.equal(await js(wallpaper,host+'.dataset.pose'),'work');assert.deepEqual(await levels(),[0,0]);
  await js(workbench,"companion.wallpaperControl('pause',false)");await until(wallpaper,host+".dataset.pose==='window'");assert.equal((await levels())[1],0);checks.push('pause freezes current image and mutes; resume applies latest selection');
  // Realistic poster has not been cached: exercise a genuine HTTP image failure.
  expectedFailure=true;blocked='/motion/female/work.png';
  await js(workbench,"companion.saveSettings({wallpaperMotion:true})");await until(workbench,"!document.getElementById('retry-character').hidden");
  assert.equal(await js(wallpaper,host+'.dataset.rig'),'scene');assert.equal(store.data.settings.qwenVoice,'Vivian');
  blocked='';expectedFailure=false;await js(workbench,"document.getElementById('retry-character').click()");await until(wallpaper,host+".dataset.rig==='motion'");
  assert.equal(store.data.settings.qwenVoice,'Vivian');checks.push('failed style load retains canvas and voices; retry commits realistic wallpaper');
  const originalCanvas=await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()");
  persistFault=true;
  await js(workbench,"companion.saveSettings({wallpaperMotion:false})");await until(workbench,"!document.getElementById('retry-character').hidden && !document.getElementById('retry-character').disabled");
  assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()"),originalCanvas);
  assert.equal(await js(wallpaper,host+'.dataset.rig'),'motion');assert.equal(store.data.settings.wallpaperMotion,true);assert.equal(store.data.settings.qwenVoice,'Vivian');
  checks.push('real main commit disk failure leaves the original canvas and both character settings intact');
  persistFault=false;await js(workbench,"document.getElementById('retry-character').click()");await until(wallpaper,host+".dataset.rig==='scene'");
  assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,48);checks.push('disk failure retry displays the replacement only after its style settings commit');
  let releasePreparation;prepareGate=new Promise(resolve=>{releasePreparation=resolve;});
  const originalSettings=JSON.stringify(store.data.settings),originalPixels=await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()");
  await js(workbench,"companion.saveSettings({wallpaperMotion:true})");
  for(let i=0;i<120&&!commitContext.wallpaperCommit;i++)await delay(20);
  assert.ok(commitContext.wallpaperCommit,'character preparation started');
  const preparing=commitContext.wallpaperCommit.promise;
  await js(workbench,"companion.wallpaperControl('pause',true)");await until(wallpaper,host+".dataset.paused==='true'");
  releasePreparation();prepareGate=null;await preparing;await store.queue;
  assert.equal(JSON.stringify(store.data.settings),originalSettings);
  assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()"),originalPixels);
  assert.equal(JSON.stringify(JSON.parse(await fs.readFile(store.file,'utf8')).settings),originalSettings);
  await js(workbench,"companion.saveSettings({stillPose:'attention'})");await js(workbench,"companion.wallpaperControl('pause',false)");
  await until(wallpaper,host+".dataset.rig==='motion' && "+host+".dataset.pose==='attention'");
  assert.equal(store.data.settings.qwenVoice,'Vivian');checks.push('pause during disk preparation keeps canvas, saved style and voices; resume commits latest pose');
  await js(workbench,"companion.saveSettings({wallpaperMotion:false,stillPose:'auto'})");await until(wallpaper,host+".dataset.rig==='scene'");
  await js(chat,"companion.windowAction('show-chat')");await until(wallpaper,host+".dataset.pose==='attention'");checks.push('chat opens and automatic character attention remains connected');
  workbench.show();await js(workbench,"document.getElementById('settings-tab').click()");await delay(150);await capture(workbench,'wallpaper-settings');
  await js(workbench,"document.getElementById('ambience-settings').scrollIntoView({block:'start'})");await delay(100);await capture(workbench,'ambience-settings');
  await js(workbench,"companion.saveSettings({ambienceEnabled:false})");
  const exited=new Promise(resolve=>wallpaper.webContents.once('render-process-gone',resolve));
  wallpaper.webContents.forcefullyCrashRenderer();await exited;assert.equal(barrier.stopped,true);
  assert.equal((await js(chat,"companion.capture({provider:'codex',cwd:'fixture',threadId:'fixture'})")).ok,true);
  await js(chat,'companion.capture(null)');assert.equal((await js(chat,'companion.playbackState(true)')).ok,true);await js(chat,'companion.playbackState(false)');
  await js(workbench,"companion.wallpaperControl('retry-audio')");
  await until(wallpaper,host+"?.dataset.ready==='true'");assert.equal(barrier.stopped,false);
  assert.equal((await js(chat,"companion.capture({provider:'codex',cwd:'fixture',threadId:'fixture'})")).ok,true);
  assert.deepEqual(await levels(),[0,0]);await js(chat,'companion.capture(null)');
  checks.push('real wallpaper renderer crash releases voice barriers; retry reloads and restores mute acknowledgements');
  assert.deepEqual(errors,[]);
  writeFileSync(join(output,'summary.json'),JSON.stringify({checks,errors,acknowledgements,synthetic:true,accounts:false,hardware:false},null,2));
  barrier.close();for(const win of windows)win.destroy();app.exit(0);
}).catch(error=>{console.error(error.stack);writeFileSync(join(output,'failure.json'),JSON.stringify({error:error.stack,checks,errors},null,2));for(const win of windows)win.destroy();app.exit(1);});
