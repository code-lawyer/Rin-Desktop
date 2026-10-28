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
mkdirSync(output,{recursive:true});app.setPath('userData',join(output,'profile'));if(!actualMotion)app.disableHardwareAcceleration();
const waitAttempts=actualMotion?600:120;
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let windows=[],wallpaper,chat,workbench,version=0,store,ambient={phase:'off'},blocked='',expectedFailure=false,persistFault=false,prepareGate;
const errors=[],checks=[],acknowledgements=[];
const present={mode:'wallpaper',wallpaperKind:'artwork',character:'female',characterRequest:0,chatVisible:false,paused:false,stills:{stillPose:'auto',ambienceEnabled:false},capturing:false,speaking:false,ambientRevision:0,ambientRetry:0};
let wallpaperStatus={phase:'loading',character:'female',requestId:0};
const state={provider:'codex',connection:'ready',status:'idle',cwd:output,projectName:'Example',threadId:'fixture-thread',threadName:'本地验证',models:[],messages:[{role:'assistant',text:'这是离线验证的完整回复。',complete:true}],approvals:[],activity:''};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const js=(win,code)=>win.webContents.executeJavaScript(code);
const sendPresentation=()=>{present.stills=store.data.settings;if(wallpaper&&!wallpaper.isDestroyed()&&!wallpaper.webContents.isCrashed())wallpaper.webContents.send('companion:presentation',present);};
let remote;
const snapshot=()=>({...store.snapshot(),version,speech:{phase:'ready',asr:true,engine:'qwen',engines:{qwen:true,kokoro:true}},remote,wallpaper:wallpaperStatus,ambience:ambient,wallpaperPaused:present.paused,resources:{phase:'idle',packs:[]},shortcutErrors:[]});
const notify=()=>{version++;sendPresentation();for(const w of [chat,workbench])if(w&&!w.isDestroyed())w.webContents.send('workbench:state',snapshot());};
const handler=(name,fn)=>ipcMain.handle(name,async(event,...args)=>{try{return{ok:true,value:await fn(event,...args)};}catch(error){return{ok:false,error:error.message};}});
async function until(win,expression){for(let i=0;i<waitAttempts;i++){if(await js(win,expression))return;await delay(50);}const detail=await js(win,"({hidden:document.hidden,host:{...document.getElementById('wallpaper-view')?.dataset},error:document.getElementById('wallpaper-error')?.textContent})");throw new Error('Timed out: '+expression+' / '+JSON.stringify(detail));}
async function open(file,width,height){
  const win=new BrowserWindow({width,height,show:false,frame:false,webPreferences:{preload:join(application,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});windows.push(win);
  win.webContents.on('console-message',(_event,level,message)=>{if(level===3&&!message.includes('Electron Security Warning')&&message!=='[wallpaper:still] The source image cannot be decoded.'&&!(expectedFailure&&message.includes('404')))errors.push(message);});
  await win.loadURL('app://local/renderer/'+file);return win;
}
async function capture(win,name){writeFileSync(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());}
app.whenReady().then(async()=>{
  const {WorkspaceStore}=await import(pathToFileURL(join(application,'backend/workspace-store.mjs')).href);
  const {remoteSettings}=await import(pathToFileURL(join(application,'backend/remote-config.mjs')).href);
  remote={phase:'disconnected',audio:'idle',config:remoteSettings(),devices:[],keysAvailable:false};
  store=new WorkspaceStore(join(output,'data'),{io:{...fs,open:async(path,...args)=>{if(prepareGate&&path.endsWith('workspaces.json.tmp'))await prepareGate;return fs.open(path,...args);},renameSync:(from,to)=>{if(persistFault&&to.endsWith('workspaces.json'))throw Object.assign(new Error('fixture disk full'),{code:'ENOSPC'});renameSync(from,to);},rename:async(from,to)=>{if(persistFault&&to.endsWith('workspaces.json'))throw Object.assign(new Error('fixture disk full'),{code:'ENOSPC'});return fs.rename(from,to);}}});await store.load();await store.add(output);await store.updateSettings({ttsResident:true,ttsEngine:'qwen',qwenVoice:'Vivian',voice:48,playbackVolume:.8});
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
  protocol.handle('app',request=>{const path=decodeURIComponent(new URL(request.url).pathname);if(blocked&&path.includes(blocked))return new Response('',{status:404});if(process.argv.includes('--motion')&&path.startsWith('/assets/motion/'))return motionMedia.respond(request);const file=resolve(application,'.'+path);if(!file.startsWith(application+sep))return new Response('',{status:403});return net.fetch(pathToFileURL(file).href);});
  handler('companion:snapshot',()=>state);handler('companion:appearance',()=>({scale:1,mode:'wallpaper'}));handler('companion:presentation',()=>present);handler('workbench:snapshot',snapshot);
  handler('remote:command',()=>remote);handler('workbench:list',()=>({data:[],nextCursor:null}));handler('workbench:draft',()=>({text:''}));handler('workbench:learn-key',()=>{});
  handler('speech:stop',()=>{});handler('speech:volume',async(_e,value)=>{await store.updateSettings({playbackVolume:value});notify();return snapshot();});
  handler('speech:synthesize',()=>({samples:new Float32Array(24000*2),sampleRate:24000}));
  handler('speech:playback',async(_e,active)=>{present.speaking=active;if(active)await barrier.wait();else sendPresentation();});
  handler('speech:capture',async(_e,target)=>{present.capturing=!!target;if(target)await barrier.wait();else sendPresentation();});
  handler('companion:window',(_e,action)=>{if(action==='show-chat'||action==='recall-chat'){present.chatVisible=true;chat.show();}else if(action==='workbench'){present.chatVisible=false;chat.hide();workbench.show();}sendPresentation();});
  handler('wallpaper:control',(_e,action,value)=>{if(action==='pause')present.paused=value;else{present.ambientRetry++;commitContext.recoverWallpaperRenderer();}notify();return snapshot();});
  handler('wallpaper:commit',(_e,info)=>commitContext.confirmWallpaper(info));
  ipcMain.on('wallpaper:finish',(event,info,accept)=>{event.returnValue={ok:true,value:commitContext.finishWallpaper(info,accept)};});
  handler('workbench:settings',async(_e,patch)=>{
    if(patch.character){commitContext.cancelWallpaperCommit();present.character=patch.character;present.characterRequest++;wallpaperStatus={phase:'loading',character:patch.character,requestId:present.characterRequest};patch={...patch};delete patch.character;}
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
  if(process.argv.includes('--motion')) {
    await js(workbench,"document.getElementById('wallpaper-motion').click()");
    await until(wallpaper,host+".dataset.motionClip==='work-loop' && Number("+host+".dataset.motionPlayCount)>=3");
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
    await js(workbench,"companion.saveSettings({character:'male'})");
    await until(wallpaper,host+".dataset.character==='male'");
    assert.equal(await js(wallpaper,"document.querySelectorAll('.wallpaper-motion').length"),0);
    assert.equal(store.data.settings.qwenVoice,'Dylan'); assert.equal(store.data.settings.voice,58);
    await js(workbench,"companion.saveSettings({character:'female'})");
    await until(wallpaper,host+".dataset.motionPhase==='loop'");
    assert.equal(store.data.settings.qwenVoice,'Serena');
    await js(workbench,"document.getElementById('wallpaper-motion').click()");
    await until(wallpaper,host+".dataset.rig==='static'");
    assert.equal(await js(wallpaper,"document.querySelectorAll('.wallpaper-motion').length"),0);
    checks.push('male static mode, default voice transaction and return to five static poses remain available');
    await capture(workbench,'motion-workbench');
    writeFileSync(join(output,'report.json'),JSON.stringify({checks,errors,syntheticMedia:!actualMotion,mediaPlayback,steadyPlayback,gpuFeatureStatus:actualMotion?app.getGPUFeatureStatus():null,accounts:false,hardware:false},null,2));
    assert.deepEqual(errors,[]); barrier.close(); for(const win of windows)win.destroy(); app.exit(0); return;
  }
  if(process.argv.includes('--pose-recovery')) {
    // Keep the failed same-character pose separate from character replacement.
    const originalPixels=await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()");
    expectedFailure=true;blocked='/stills/female-v2-4k/cup.png';
    await js(workbench,"companion.saveSettings({stillPose:'cup'})");
    await until(workbench,"!document.getElementById('retry-character').hidden");
    assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()"),originalPixels);
    assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,48);
    checks.push('same-character bad pose retains the visible frame and custom voices');
    blocked='';expectedFailure=false;
    await js(workbench,"companion.saveSettings({stillPose:'window'})");
    await until(wallpaper,host+".dataset.pose==='window'");await delay(150);
    const recovered={displayedPose:await js(wallpaper,host+'.dataset.pose'),wallpaper:{...wallpaperStatus},
      ui:await js(workbench,"({status:document.getElementById('still-status').textContent,error:document.getElementById('character-status').textContent,retryVisible:!document.getElementById('retry-character').hidden})")};
    workbench.show();await js(workbench,"document.getElementById('settings-tab').click()");await delay(150);
    await capture(workbench,'pose-recovery-status');await capture(wallpaper,'pose-recovery-wallpaper');
    await js(workbench,"document.getElementById('retry-character').click()");
    await until(workbench,"document.getElementById('retry-character').hidden && document.getElementById('still-status').textContent.includes('侧身看雨')");
    assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,48);
    checks.push('explicit retry recovers the successful pose status without resetting custom voices');
    writeFileSync(join(output,'pose-recovery.json'),JSON.stringify({afterDifferentPose:recovered,afterExplicitRetry:{...wallpaperStatus},checks,synthetic:true,accounts:false,hardware:false},null,2));
    assert.equal(recovered.wallpaper.phase,'ready','a successfully displayed replacement pose must clear the previous pose load error');
    assert.equal(recovered.wallpaper.pose,'window','the workbench must report the pose actually displayed');
    assert.equal(recovered.ui.retryVisible,false);
    barrier.close();for(const win of windows)win.destroy();app.exit(0);return;
  }
  for(const pose of ['work','cup','thinking','window','attention']){
    await js(workbench,`companion.saveSettings({stillPose:'${pose}'})`);await until(wallpaper,host+`.dataset.pose==='${pose}'`);
    const fullFrame=await js(wallpaper,`(async()=>{const image=new Image();image.src='app://local/assets/stills/female-v2-4k/${pose}.png';await image.decode();const actual=document.querySelector('.wallpaper-still'),expected=document.createElement('canvas');expected.width=actual.width;expected.height=actual.height;const ctx=expected.getContext('2d',{alpha:false}),scale=Math.max(actual.width/image.naturalWidth,actual.height/image.naturalHeight);ctx.drawImage(image,(actual.width-image.naturalWidth*scale)/2,(actual.height-image.naturalHeight*scale)/2,image.naturalWidth*scale,image.naturalHeight*scale);const a=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data,b=ctx.getImageData(0,0,actual.width,actual.height).data;return a.every((value,i)=>value===b[i]);})()`);
    assert.equal(fullFrame,true,pose+' preserves the full source frame, including hands and shoulders');
    assert.equal(store.data.settings.qwenVoice,'Vivian');assert.equal(store.data.settings.voice,48);
    await capture(wallpaper,'pose-'+pose);checks.push('direct decoded full frame '+pose+' / custom voices retained');
  }
  await js(workbench,"document.querySelector('#still-previews [data-pose=cup]').click()");await until(wallpaper,host+".dataset.pose==='cup'");
  await until(workbench,"document.getElementById('still-status').textContent.includes('捧杯休息') && document.getElementById('still-status').textContent.includes('固定姿态')");
  assert.equal(await js(workbench,"document.querySelector('#still-previews [data-pose=cup]').getAttribute('aria-pressed')"),'true');
  checks.push('pose thumbnails select the actual frame and show the fixed-pose reason');
  await js(workbench,"companion.saveSettings({stillPose:'work',ambienceEnabled:true})");await until(wallpaper,host+".dataset.audioState==='ready'");
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
  // Fresh male images have not been cached: exercise a genuine HTTP image failure.
  expectedFailure=true;blocked='/stills/male/';
  await js(workbench,"companion.saveSettings({character:'male'})");await until(workbench,"!document.getElementById('retry-character').hidden && !document.getElementById('retry-character').disabled");
  assert.equal(await js(wallpaper,host+'.dataset.character'),'female');assert.equal(store.data.settings.qwenVoice,'Vivian');
  blocked='';expectedFailure=false;await js(workbench,"document.getElementById('retry-character').click()");await until(wallpaper,host+".dataset.character==='male'");
  await until(workbench,"document.getElementById('qwen-voice').value==='Dylan'");assert.equal(store.data.settings.qwenVoice,'Dylan');checks.push('failed character load holds picture and voice; retry commits male with matching default');
  const originalCanvas=await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()");
  persistFault=true;
  await js(workbench,"companion.saveSettings({character:'female'})");await until(workbench,"!document.getElementById('retry-character').hidden && !document.getElementById('retry-character').disabled");
  assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()"),originalCanvas);
  assert.equal(await js(wallpaper,host+'.dataset.character'),'male');assert.equal(store.data.settings.character,'male');assert.equal(store.data.settings.qwenVoice,'Dylan');
  checks.push('real main commit disk failure leaves the original canvas and both character settings intact');
  persistFault=false;await js(workbench,"document.getElementById('retry-character').click()");await until(wallpaper,host+".dataset.character==='female'");
  assert.equal(store.data.settings.qwenVoice,'Serena');assert.equal(store.data.settings.voice,3);checks.push('disk failure retry displays the replacement only after its default voices commit');
  let releasePreparation;prepareGate=new Promise(resolve=>{releasePreparation=resolve;});
  const originalSettings=JSON.stringify(store.data.settings),originalPixels=await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()");
  await js(workbench,"companion.saveSettings({character:'male'})");
  for(let i=0;i<120&&!commitContext.wallpaperCommit;i++)await delay(20);
  assert.ok(commitContext.wallpaperCommit,'character preparation started');
  const preparing=commitContext.wallpaperCommit.promise;
  await js(workbench,"companion.wallpaperControl('pause',true)");await until(wallpaper,host+".dataset.paused==='true'");
  releasePreparation();prepareGate=null;await preparing;await store.queue;
  assert.equal(JSON.stringify(store.data.settings),originalSettings);
  assert.equal(await js(wallpaper,"document.querySelector('.wallpaper-still').toDataURL()"),originalPixels);
  assert.equal(JSON.stringify(JSON.parse(await fs.readFile(store.file,'utf8')).settings),originalSettings);
  await js(workbench,"companion.saveSettings({stillPose:'attention'})");await js(workbench,"companion.wallpaperControl('pause',false)");
  await until(wallpaper,host+".dataset.character==='male' && "+host+".dataset.pose==='attention'");
  assert.equal(store.data.settings.qwenVoice,'Dylan');checks.push('pause during disk preparation keeps canvas, saved character and voices; resume commits latest pose');
  await js(workbench,"companion.saveSettings({character:'female',stillPose:'auto'})");await until(wallpaper,host+".dataset.character==='female'");
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
