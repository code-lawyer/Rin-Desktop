import { drawSceneFrame } from './still-scene-compose.mjs';
const labels={work:'伏案工作',cup:'捧杯休息',thinking:'托腮思考',window:'侧身看雨',attention:'转身陪伴'};
const canvas=document.querySelector('canvas'),context=canvas.getContext('2d',{alpha:false});
const cache=new Map();let pose='work',mode='fixed',version=0,timer;
function load(url){if(!cache.has(url)){const promise=(async()=>{const image=new Image();image.src=url;await image.decode();return image;})();cache.set(url,promise);promise.catch(()=>cache.delete(url));}return cache.get(url);}
async function render(){
  const attempt=++version,current=pose,view=mode;document.getElementById('loading').hidden=false;
  for(const button of document.querySelectorAll('[data-pose]'))button.setAttribute('aria-pressed',String(button.dataset.pose===pose));
  for(const item of ['original','fixed'])document.getElementById(item).setAttribute('aria-pressed',String(item===mode));
  try{const [person,room,legReference]=await Promise.all([load(`/media/${view==='original'?'original/':''}${current}.png`),load('/media/scene.png'),load('/media/work.png')]);if(attempt!==version)return;
    if(view==='fixed')drawSceneFrame(context,room,person,current,{legReference});else context.drawImage(person,0,0,canvas.width,canvas.height);
    canvas.dataset.pose=current;canvas.dataset.mode=view;
    document.getElementById('status').textContent=`${labels[current]} · ${view==='fixed'?'共用固定房间与沙发':'原版完整图片'} · 对比小样`;
  }catch{if(attempt===version)document.getElementById('status').textContent='图片加载失败，已保留画面；点击姿态按钮重试。';}
  finally{if(attempt===version)document.getElementById('loading').hidden=true;}
}
for(const [key,label] of Object.entries(labels)){const button=document.createElement('button');button.textContent=label;button.dataset.pose=key;button.onclick=()=>{pose=key;render();};document.getElementById('poses').append(button);}
for(const item of ['original','fixed'])document.getElementById(item).onclick=()=>{mode=item;render();};
document.getElementById('cycle').onclick=()=>{if(timer){clearInterval(timer);timer=null;}else timer=setInterval(()=>{const poses=Object.keys(labels);pose=poses[(poses.indexOf(pose)+1)%poses.length];render();},3000);document.getElementById('cycle').setAttribute('aria-pressed',String(!!timer));};
window.addEventListener('beforeunload',()=>clearInterval(timer));render();
