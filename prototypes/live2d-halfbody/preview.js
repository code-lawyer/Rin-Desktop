import '../live2d-codex/renderer/pixi-compat.js';
import { Application } from 'pixi.js';
import { Live2DModel } from '@jannchie/pixi-live2d-display/cubism4';
import { clamp, approach, blinkOpen, speechOpening, HairSpring } from './motion.mjs';

const $ = id => document.getElementById(id);
const state = { ready:false, mode:'auto', time:0, yaw:0, pitch:0, mouth:0, wind:.35, blink:1, hair:0, playing:false };
let app, model, observer, audioContext, analyser, source, audioEpoch=0, data, blinkAt=-10, nextBlink=2.4;
let pointer={x:0,y:0};
const backHair=new HairSpring(),frontHair=new HairSpring();
function mode(value) {
  state.mode=value;
  for(const button of document.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===value));
}
for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>mode(button.dataset.mode);
for(const id of ['yaw','pitch'])$(id).oninput=()=>mode('manual');
$('wind').oninput=()=>{state.wind=Number($('wind').value);$('wind-value').textContent=Math.round(state.wind*100)+'%';};
$('blink').onclick=()=>{blinkAt=state.time;};
$('reset').onclick=()=>{mode('manual');$('yaw').value='0';$('pitch').value='0';};
$('canvas').addEventListener('pointermove',event=>{
  const rect=$('canvas').getBoundingClientRect();
  pointer={x:clamp((event.clientX-rect.left)/rect.width*2-1,-1,1),y:clamp(1-(event.clientY-rect.top)/rect.height*2,-1,1)};
});
$('canvas').addEventListener('pointerleave',()=>{pointer={x:0,y:0};});
function stopAudio(message='本地女声 · 待播放') {
  audioEpoch++;
  if(source){source.onended=null;source.stop();source.disconnect();source=null;}
  analyser?.disconnect();analyser=null;state.playing=false;state.mouth=0;
  $('stop').disabled=true;$('play').disabled=!state.ready;$('audio-status').textContent=message;
}
async function playAudio(getBytes,label) {
  stopAudio('正在准备声音…');const epoch=audioEpoch;
  $('play').disabled=true;$('stop').disabled=false;
  try {
    audioContext??=new AudioContext();await audioContext.resume();
    const bytes=await getBytes();if(epoch!==audioEpoch)return;
    const buffer=await audioContext.decodeAudioData(bytes);if(epoch!==audioEpoch)return;
    source=audioContext.createBufferSource();source.buffer=buffer;
    analyser=audioContext.createAnalyser();analyser.fftSize=1024;data=new Float32Array(analyser.fftSize);
    source.connect(analyser);analyser.connect(audioContext.destination);
    source.onended=()=>{if(epoch===audioEpoch)stopAudio('播放结束 · 口型已归位');};
    state.playing=true;source.start();$('audio-status').textContent=label;
  } catch(error) {if(epoch===audioEpoch)stopAudio('声音未能播放，请重试或选择其他音频。');console.error(error);}
}
$('play').onclick=()=>playAudio(async()=>{const r=await fetch('/sample.wav');if(!r.ok)throw new Error('Sample audio unavailable');return r.arrayBuffer();},'正在播放 · 本地女声');
$('stop').onclick=()=>stopAudio('已停止 · 口型已归位');
$('upload').onchange=()=>{
  const file=$('upload').files[0];$('upload').value='';if(!file)return;
  if(file.size>32*1024*1024){stopAudio('请选择 32 MB 以内的音频。');return;}
  playAudio(()=>file.arrayBuffer(),'正在播放 · 所选音频');
};
function update(dt) {
  state.time+=dt;
  const target=state.mode==='auto'?{x:40*Math.sin(state.time*.33),y:14*Math.sin(state.time*.47)}:state.mode==='follow'?{x:pointer.x*45,y:pointer.y*20}:{x:Number($('yaw').value)*.45,y:Number($('pitch').value)*.20};
  const previousYaw=state.yaw;
  state.yaw=approach(state.yaw,target.x,dt,.22);state.pitch=approach(state.pitch,target.y,dt,.22);
  if(state.time>=nextBlink){blinkAt=state.time;nextBlink=state.time+4.1+Math.sin(state.time)*.6;}
  state.blink=blinkOpen(state.time-blinkAt);
  let opening=0;if(state.playing&&analyser){analyser.getFloatTimeDomainData(data);opening=speechOpening(data);}
  state.mouth=state.playing?approach(state.mouth,opening,dt,opening>state.mouth ? .025 : .06):0;
  const drift=state.wind*(Math.sin(state.time*1.5)*.5+Math.sin(state.time*2.3)*.16);
  state.hair=backHair.update(drift-(state.yaw-previousYaw)*.25,dt);
  const front=frontHair.update(drift*.5-(state.yaw-previousYaw)*.16,dt);
  const core=model.internalModel.coreModel;
  const values={ParamAngleX:state.yaw,ParamAngleY:state.pitch,ParamAngleZ:state.mode==='auto'?Math.sin(state.time*.38)*1.5:0,ParamBodyAngleX:state.yaw*.10,ParamBodyAngleY:0,ParamBodyAngleZ:0,ParamBodyLean:0,ParamProportion:0,ParamEyeLOpen:state.blink,ParamEyeROpen:state.blink,ParamEyeBallX:0,ParamEyeBallY:0,ParamBrowLY:0,ParamBrowRY:0,ParamMouthForm:0,ParamMouthOpenY:state.mouth,ParamBreath:(Math.sin(state.time*1.1)+1)*.12,ParamHairFront:front,ParamHairBack:state.hair};
  for(const [id,value] of Object.entries(values))core.setParameterValueById(id,value);
  $('yaw-value').textContent=Math.round(state.yaw/.45)+'%';$('pitch-value').textContent=Math.round(state.pitch/.20)+'%';
  if(state.mode!=='manual'){$('yaw').value=state.yaw/.45;$('pitch').value=state.pitch/.20;}
  $('mouth-meter').style.width=(state.mouth*100)+'%';
}
async function load() {
  $('error').hidden=true;$('controls').disabled=true;$('retry').disabled=true;
  try {
    app=new Application();await app.init({resizeTo:$('canvas'),resolution:Math.min(devicePixelRatio,2),autoDensity:true,backgroundAlpha:0,preference:'webgl',preserveDrawingBuffer:true,gcActive:false});
    app.ticker.maxFPS=60;$('canvas').append(app.canvas);
    model=await Live2DModel.from('/model/Generated_artwork.model3.json',{ticker:app.ticker,autoInteract:false,motionPreload:'NONE',idleMotionGroup:'PreviewNone'});
    model.internalModel.motionManager.stopAllMotions();
    const internal=model.internalModel,draw=internal.draw.bind(internal);
    internal.draw=gl=>{internal.viewport[2]=gl.drawingBufferWidth;internal.viewport[3]=gl.drawingBufferHeight;draw(gl);};
    internal.on('beforeModelUpdate',()=>update(Math.min(app.ticker.deltaMS/1000,.05)));
    app.stage.addChild(model);
    function fit(){const host=$('canvas'),scale=Math.min(host.clientWidth*.93/850,host.clientHeight*.97/1140);model.scale.set(scale);model.position.set(host.clientWidth/2-500*scale,host.clientHeight*.02-90*scale);}
    observer=new ResizeObserver(fit);observer.observe($('canvas'));fit();
    state.ready=true;$('controls').disabled=false;$('render-status').textContent='实时人物 · 已就绪';
    window.halfbodyPreview={state,model,app,stopAudio,setPose:(yaw,pitch=0)=>{mode('manual');$('yaw').value=String(clamp(yaw,-45,45)/.45);$('pitch').value=String(clamp(pitch,-20,20)/.20);},blink:()=>{blinkAt=state.time;}};
  }catch(error){console.error(error);state.ready=false;observer?.disconnect();if(app){try{app.destroy(true,{children:true});}catch{}}$('canvas').replaceChildren();$('error-message').textContent='人物未能载入。请确认样例素材完整，再重试。';$('error').hidden=false;$('render-status').textContent='加载失败';}
  finally{$('retry').disabled=false;}
}
$('retry').onclick=load;
window.addEventListener('beforeunload',()=>{stopAudio();audioContext?.close();observer?.disconnect();app?.destroy(true,{children:true});});
load();
