// Real HTML/CSS/assets with the shared synthetic API. Page zoom is not OS DPI.
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=async function visualCases({open,evaluate,delay,output}) {
  const captures=[],failures=[],checks=[];
  const emit=(win,name,value)=>evaluate(win,`interfaceFixture.emit(${JSON.stringify(name)},${JSON.stringify(value)})`);
  const wait=async(win,condition)=>{
    const end=Date.now()+15000;
    while(!await evaluate(win,condition)){if(Date.now()>end)throw new Error('Timed out: '+condition);await delay(60);}
  };
  async function capture(win,name,width,height,zoom=1) {
    // Hidden Chromium surfaces can return the previous composited frame even
    // after invalidate(). Paint a visible, inactive test window before capture.
    win.webContents.setZoomFactor(zoom);win.setSize(width,height);win.showInactive();await delay(220);
    await evaluate(win,`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))`);
    await delay(80);
    const metrics=await evaluate(win,`(()=>{
      const clipped=[];
      for(const el of document.querySelectorAll('button,input,select,textarea')) {
        if(!el.checkVisibility({visibilityProperty:true}) || el.closest('[hidden]'))continue;
        const painted=el.matches('.character-option input')?el.nextElementSibling:el;
        const r=painted.getBoundingClientRect();if(r.width<1||r.height<1)continue;
        let scrollX=false,scrollY=false,xmin=0,xmax=innerWidth,ymin=0,ymax=innerHeight;
        for(let p=painted.parentElement;p;p=p.parentElement){
          const s=getComputedStyle(p),b=p.getBoundingClientRect();
          if(/auto|scroll/.test(s.overflowX)&&b.width>8)scrollX=true;
          if(/auto|scroll/.test(s.overflowY)&&b.height>8)scrollY=true;
          if(!scrollX&&/hidden|clip/.test(s.overflowX)){xmin=Math.max(xmin,b.left);xmax=Math.min(xmax,b.right);}
          if(!scrollY&&/hidden|clip/.test(s.overflowY)){ymin=Math.max(ymin,b.top);ymax=Math.min(ymax,b.bottom);}
        }
        const x=!scrollX&&(r.left<xmin-1||r.right>xmax+1),y=!scrollY&&(r.top<ymin-1||r.bottom>ymax+1);
        if(x||y)clipped.push({id:el.id||el.getAttribute('aria-label')||el.textContent.trim().slice(0,32),x,y,rect:{x:r.x,y:r.y,width:r.width,height:r.height}});
      }
      return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},clipped,
        focus:document.activeElement.id,bodyOverflow:document.body.scrollWidth>innerWidth+1,
        pose:document.getElementById('wallpaper-view')?.dataset.pose,
        approval:document.getElementById('approval')?.hidden===false,
        error:document.getElementById('error-banner')?.textContent};
    })()`);
    let shot;
    for(let attempt=0;attempt<3;attempt++) {
      win.webContents.invalidate();
      try{shot=await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});break;}
      catch(error){if(!String(error.message).includes('UnknownVizError')||attempt===2)throw error;await delay(150);}
    }
    if(shot.isEmpty())throw new Error('Empty capture: '+name);
    writeFileSync(join(output,name+'.png'),shot.toPNG());
    captures.push({name,window:{width,height},zoom,pixels:shot.getSize(),...metrics});
    if(metrics.clipped.length||metrics.bodyOverflow)failures.push({name,clipped:metrics.clipped,bodyOverflow:metrics.bodyOverflow});
  }
  async function reachable(win,name,selectors) {
    for(const selector of selectors) {
      const visible=await evaluate(win,`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});el.focus();const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight+1&&(el===hit||el.contains(hit))})()`);
      if(!visible)failures.push({name,unreachable:selector});
    }
    checks.push(name);
  }
  const chat=await open('index.html?view=chat',440,420);
  await capture(chat,'bubble-standard',440,420);
  await capture(chat,'bubble-narrow',360,390);
  await capture(chat,'bubble-minimum',280,190);
  await reachable(chat,'minimum actions remain reachable',['#record-button','#send-button']);
  await capture(chat,'bubble-minimum-actions',280,190);
  await evaluate(chat,`document.getElementById('bubble-card').scrollTop=0`);
  await evaluate(chat,`(()=>{const p=document.getElementById('prompt');p.value='请整理今天的开发进展，并列出接下来需要确认的事项。\\n保留桌面原有的语音和遥控器功能。\\n给我可以逐项执行的计划。';p.dispatchEvent(new Event('input',{bubbles:true}));p.focus();interfaceFixture.emit('remoteAction','down')})()`);
  await capture(chat,'bubble-draft-focus',360,390);
  await evaluate(chat,`(()=>{const p=document.getElementById('prompt');p.value='';p.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const longReply='# 今天的进展\n\n已保留原有的 **对话、工作台、语音与遥控器**。以下内容用于检查长回复的阅读体验。\n\n## 下一步\n\n- 查看人物画面与窗口的衔接\n- 核对中文、数字及英文路径\n\n| 状态 | 项目 | 备注 |\n| --- | --- | --- |\n| 已完成 | 静态姿态 | 保持原有雨夜场景 |\n| 待验收 | 真实设备 | 需要在目标显示器和遥控器上确认 |\n\n```text\nC:/Projects/Example/long-path/renderer/workbench.html\n```\n\n'+('较长的说明应当留在阅读区内滚动，输入框和播放按钮仍然可以操作。\n\n'.repeat(8));
  await emit(chat,'state',{messages:[{role:'assistant',text:longReply,complete:true}],projectName:'中文项目 · 工作台视觉与遥控体验',threadName:'很长的对话标题用于确认截断和完整信息提示'});
  await capture(chat,'bubble-long-reply',560,620);
  await emit(chat,'layout',{fullscreen:true});await capture(chat,'reading-view',1040,760);
  await emit(chat,'layout',{fullscreen:false,side:'left',tailY:78});
  await emit(chat,'state',{status:'waiting',approvals:[{id:'visual-approval',kind:'command',reason:'需要你确认以下操作。较长的路径和命令应可滚动查看，审批按钮应始终可达。',cwd:'C:/Projects/Example/设计与前端视觉检查',command:'npm run build && npm run check:project',details:'仅展示合成审批，不执行命令。'}]});
  await capture(chat,'approval-compact',440,390);
  await reachable(chat,'compact approval and composer actions remain reachable',['.approval-actions button:first-child','.approval-actions button:last-child','#record-button','#send-button']);
  await capture(chat,'approval-compact-actions',440,390);
  await evaluate(chat,`document.getElementById('bubble-card').scrollTop=0`);
  await capture(chat,'approval-standard',560,620);
  await emit(chat,'state',{approvals:[{id:'visual-question',kind:'questions',reason:'确认本次检查的范围',questions:[{id:'scope',header:'检查范围',question:'你希望保留哪些已有功能？',options:[{label:'保留全部功能',description:'对话、工作台、语音和遥控器都保留'}]},{id:'notes',header:'补充',question:'还有其他视觉要求吗？',required:false,options:[]}]}]});
  await capture(chat,'question-compact',440,420);
  await reachable(chat,'compact question fields and actions remain reachable',['.approval select','.approval label:last-child input','.approval-actions button:first-child','#send-button']);
  await evaluate(chat,`document.getElementById('bubble-card').scrollTop=0`);
  await emit(chat,'state',{status:'idle',approvals:[],connection:'error',error:'连接暂时中断。请检查本地 Agent 状态后重试。',messages:[]});
  await capture(chat,'bubble-error',440,420);
  await emit(chat,'state',{connection:'ready',error:null,messages:[{role:'assistant',text:'可以用，中文显示和回复都正常。',complete:true}]});
  await capture(chat,'bubble-zoom-125',560,620,1.25);
  await capture(chat,'bubble-zoom-150',560,620,1.5);
  const workbench=await open('workbench.html',1120,760);
  await capture(workbench,'conversations-standard',1120,760);
  await capture(workbench,'conversations-compact',760,540);
  await evaluate(workbench,`document.getElementById('settings-tab').click()`);
  const groups=await evaluate(workbench,`[...document.querySelectorAll('[data-setting-target]')].map(el=>el.dataset.settingTarget)`);
  for(const group of groups) {
    await evaluate(workbench,`document.querySelector('[data-setting-target="${group}"]').click();document.querySelector('.settings-scroll').scrollTop=0`);
    await capture(workbench,group+'-standard',1120,760);
    await capture(workbench,group+'-compact',760,540);
  }
  await evaluate(workbench,`document.querySelector('[data-setting-target="wallpaper-settings"]').click();document.querySelector('[name="wallpaper-character"]').focus();interfaceFixture.emit('remoteAction','down')`);
  await capture(workbench,'character-focus',1120,760);
  await evaluate(workbench,`document.getElementById('still-previews').scrollIntoView({block:'center'})`);
  await capture(workbench,'pose-previews-standard',1120,760);
  await capture(workbench,'pose-previews-compact',760,540);
  await reachable(workbench,'all five pose previews remain reachable',['#still-previews button:first-child','#still-previews button:last-child','#still-pose']);
  await evaluate(workbench,`document.getElementById('ambience-enabled').scrollIntoView({block:'center'})`);
  await capture(workbench,'ambience-settings',760,540);
  for(const zoom of [1.25,1.5]) {
    await evaluate(workbench,`document.querySelector('[data-setting-target="playback-settings"]').click();document.querySelector('.settings-scroll').scrollTop=0`);
    await capture(workbench,'voice-zoom-'+Math.round(zoom*100),1120,760,zoom);
    await evaluate(workbench,`document.querySelector('[data-setting-target="wallpaper-settings"]').click();document.querySelector('.settings-scroll').scrollTop=0`);
    await capture(workbench,'wallpaper-zoom-'+Math.round(zoom*100),1120,760,zoom);
  }
  const wallpaper=await open('index.html?view=wallpaper',1280,800);
  await wait(wallpaper,`interfaceFixture.stats().renderInfo?.ready===true`);
  for(const pose of ['work','cup','thinking','window','attention']) {
    await emit(wallpaper,'presentation',{stills:{stillPose:pose,ambienceEnabled:false}});
    await wait(wallpaper,`document.getElementById('wallpaper-view').dataset.pose===${JSON.stringify(pose)}`);
    await capture(wallpaper,'female-'+pose,1280,800);
  }
  const density=await evaluate(wallpaper,'devicePixelRatio');
  await capture(wallpaper,'female-attention-4k',Math.round(3840/density),Math.round(2400/density));
  await emit(wallpaper,'presentation',{character:'male',characterRequest:1,stills:{stillPose:'work',ambienceEnabled:false}});
  await wait(wallpaper,`interfaceFixture.stats().renderInfo?.ready && interfaceFixture.stats().renderInfo.character==='male'`);
  await capture(wallpaper,'male-work',1280,800);
  await emit(wallpaper,'presentation',{chatVisible:true,stills:{stillPose:'auto',ambienceEnabled:false}});
  await wait(wallpaper,`document.getElementById('wallpaper-view').dataset.pose==='attention'`);
  await capture(wallpaper,'male-attention',1280,800);
  return {captures,checks,failures,synthetic:true,accounts:false,hardware:false,pageZoomOnly:true};
};
