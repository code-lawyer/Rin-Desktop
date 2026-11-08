import { connectPage } from './cdp.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createRunDirectory, requireLiveRun } from './run-output.mjs';
import { hasPresentedMotion as hasPresented } from './motion-live-state.mjs';

requireLiveRun('Usage: npm run qa:motion-live -- --run --port=<local-debug-port> [--enable-preview] [--quit]', 'inspect the already running project app; --enable-preview selects female dynamic automatic mode through its existing UI API; --quit closes that app. No prompts, recordings, downloads or model loading');
const args=process.argv.slice(2), ports=args.filter(arg=>arg.startsWith('--port='));
if(ports.length!==1 || args.some(arg=>!['--run','--enable-preview','--quit'].includes(arg)&&!arg.startsWith('--port=')))throw new Error('Invalid or repeated arguments.');
const port=Number(ports[0].slice(7));if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use a local debug port between1024 and65535.');
const pages=await (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(10000)})).json();
const find=part=>{const page=pages.find(item=>item.type==='page'&&item.url.startsWith('app://local/renderer/')&&item.url.includes(part));if(!page)throw new Error('Project application window not found: '+part);return page;};
let workspace,wallpaper;
try {
  workspace=await connectPage(find('workbench.html'), port);wallpaper=await connectPage(find('view=wallpaper'), port);
  const output=await createRunDirectory('motion-live');
  const before=await workspace.evaluate('(async()=>{const s=(await companion.workspace()).value;return {character:s.settings.character,qwenVoice:s.settings.qwenVoice,voice:s.settings.voice};})()');
  if(args.includes('--enable-preview')){
    const result=await workspace.evaluate(`companion.saveSettings({wallpaperMotion:true,stillPose:'auto'${before.character==='female'?'':",character:'female'"}})`);
    if(!result?.ok)throw new Error(result?.error||'Preview settings could not be saved.');
  }
  let status;
  for(let i=0;i<120;i++){
    status=await workspace.evaluate('(async()=>{const s=(await companion.workspace()).value;return {wallpaper:s.wallpaper,settings:{character:s.settings.character,wallpaperMotion:s.settings.wallpaperMotion,stillPose:s.settings.stillPose,qwenVoice:s.settings.qwenVoice,voice:s.settings.voice}};})()');
    if(status.wallpaper.phase==='ready'&&status.wallpaper.model==='motion-clips')break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(status.wallpaper.phase,'ready');assert.equal(status.wallpaper.model,'motion-clips');
  if(before.character==='female'){assert.equal(status.settings.qwenVoice,before.qwenVoice);assert.equal(status.settings.voice,before.voice);}
  let presentation,display;
  for(let i=0;i<200;i++){
    presentation=await wallpaper.evaluate('(async()=>{const p=(await companion.presentation()).value;return {desktopAttached:p.desktopAttached,desktopLayer:p.desktopLayer,paused:p.paused,character:p.character,chatVisible:p.chatVisible};})()');
    display=await wallpaper.evaluate("({host:{...document.getElementById('wallpaper-view').dataset},viewport:{width:innerWidth,height:innerHeight,density:devicePixelRatio},videos:[...document.querySelectorAll('.wallpaper-motion')].map(v=>({width:v.videoWidth,height:v.videoHeight,paused:v.paused,readyState:v.readyState,active:v.dataset.active==='true'}))})");
    if(display.host.rig==='motion' && display.videos.some(v=>v.width===3840&&v.height===2160&&v.readyState>=2) && (presentation.paused || hasPresented(display)))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(display.host.rig,'motion');assert.ok(display.videos.some(v=>v.width===3840&&v.height===2160&&v.readyState>=2));
  const playbackReady=hasPresented(display);
  if(!presentation.paused)assert.ok(playbackReady,'No active decoded video has been presented');
  const screenshot=await wallpaper.send('Page.captureScreenshot',{format:'png'});
  await writeFile(join(output,'wallpaper.png'),Buffer.from(screenshot.data,'base64'));
  const passed=playbackReady&&presentation.desktopAttached;
  await writeFile(join(output,'result.json'),JSON.stringify({passed,playbackPending:!playbackReady,previewEnabled:args.includes('--enable-preview'),before,status,presentation,display,promptsSent:false,microphoneUsed:false},null,2)+'\n');
  console.log(JSON.stringify({output,passed,playbackPending:!playbackReady,status,presentation,display},null,2));
  if(!passed)process.exitCode=2;
  if(args.includes('--quit'))await workspace.evaluate("companion.windowAction('quit')").catch(()=>{});
} finally {workspace?.close();wallpaper?.close();}
