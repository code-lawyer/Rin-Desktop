import { REMOTE_ACTIONS, REMOTE_BUTTONS, DEFAULT_BUTTONS } from '../backend/remote-config.mjs';
import { remoteVoiceStatus } from './remote-voice-status.mjs';
import { composerRemoteHints } from './composer-controls.mjs';
export function installRemoteSettings(api) {
  const $=id=>document.getElementById(id);let state,working=false,operation=0;
  const fields=new Map();
  for(const [id,label] of Object.entries(REMOTE_BUTTONS)) {
    const row=document.createElement('label');row.textContent=label;
    const select=document.createElement('select');select.setAttribute('aria-label',label+'的功能');
    for(const [value,text] of Object.entries(id==='voice'?{dictate:'按住说话，松开写入草稿',none:'不使用遥控器麦克风'}:REMOTE_ACTIONS)) {
      const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);
    }
    select.onchange=()=>operate('settings',{buttons:{[id]:select.value}});row.append(select);$('rc003-buttons').append(row);fields.set(id,select);
  }
  async function operate(command,value) {
    const current=++operation,focus=document.activeElement;
    working=true;render();
    try {const result=await api.remote(command,value);if(current!==operation)return;if(!result.ok)throw new Error(result.error);if(result.value)state=result.value;}
    catch(error){if(current===operation)$('rc003-error').textContent=error.message;}
    finally{if(current===operation){working=false;render();if(command==='settings' && focus?.isConnected && !focus.disabled)focus.focus();}}
  }
  function render(value) {
    if(value)state=value;if(!state)return;
    const pending=working || ['connecting','pairing','disconnecting'].includes(state.phase) || state.scanning;
    $('rc003-status').textContent=({connected:'已连接',connecting:'正在连接…',pairing:'请确认 Windows 配对提示…',disconnected:'未连接',error:'需要重新连接'})[state.phase] || '正在处理…';
    $('rc003-name').textContent=state.config.device?.name || '连接你的 RC003 遥控器';
    $('rc003-detail').textContent=state.notice || (state.phase==='connected' ? '' : '让遥控器进入配对状态后搜索；已配对时按任意键唤醒。');
    $('rc003-status').dataset.phase=state.phase;
    const voice=remoteVoiceStatus(state);
    $('rc003-audio').textContent=voice.active?voice.text:'';
    $('remote-microphone-status').textContent=[voice.text,voice.result].filter(Boolean).join('。');
    $('rc003-scan').textContent=state.scanning?'正在搜索…':'搜索遥控器';$('rc003-scan').hidden=state.phase==='connected';$('rc003-scan').disabled=!!pending || state.phase==='connected' || state.audio!=='idle';
    $('rc003-disconnect').hidden=!['connected','connecting','pairing','error','disconnecting'].includes(state.phase);$('rc003-disconnect').disabled=state.phase==='disconnecting';
    $('rc003-reconnect').hidden=!state.config.device || state.phase==='connected';$('rc003-reconnect').disabled=!!pending;
    $('rc003-forget').hidden=!state.config.device;$('rc003-forget').disabled=!!pending;
    $('rc003-auto').checked=state.config.autoConnect;$('rc003-auto').disabled=!!pending;
    $('rc003-reset').disabled=!!pending || state.audio!=='idle';
    $('rc003-last').textContent=state.lastButton?`刚刚按下：${REMOTE_BUTTONS[state.lastButton]}`:'连接后按一下按钮，这里会显示它的名称。';
    for(const [id,field] of fields){field.value=state.config.buttons[id];field.disabled=!!pending || state.audio!=='idle';field.closest('label').classList.toggle('remote-pressed',id===state.lastButton);}
    const guide=$('rc003-guide'),guideKey=JSON.stringify(state.config.buttons);
    if(guide.dataset.signature!==guideKey){guide.dataset.signature=guideKey;guide.replaceChildren();
      const undo=composerRemoteHints(state.config.buttons,{undo:true});
      const rows=[['说话',state.config.buttons.voice==='dictate'?'按住语音键，松开后转成草稿':'语音键已停用'],['草稿',composerRemoteHints(state.config.buttons,{hasText:true}) || '在下方设置发送、清空和朗读按钮'],['重录',undo || '清空后重新输入'],['音量','音量加减键默认调节播报音量']];
      for(const [name,text] of rows){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=name;detail.textContent=text;guide.append(term,detail);}
    }
    const list=$('rc003-devices');list.hidden=state.phase==='connected';
    // Keep focus stable while key/status events arrive.
    const signature=JSON.stringify([state.devices,pending]);
    if(list.dataset.signature!==signature){list.dataset.signature=signature;list.replaceChildren();
      for(const device of state.devices){const button=document.createElement('button');button.textContent=`${device.name} · ${device.paired?'连接':'配对并连接'}`;button.disabled=!!pending;button.onclick=()=>operate('connect',device.id);list.append(button);}
      if(!state.devices.length && !state.scanning){const note=document.createElement('p');note.className='hint';note.textContent='搜索结果会显示在这里。';list.append(note);}
    }
  }
  $('rc003-scan').onclick=()=>{ $('rc003-error').textContent='';operate('scan'); };
  $('rc003-disconnect').onclick=()=>operate('disconnect');
  $('rc003-forget').onclick=()=>operate('forget');
  $('rc003-reconnect').onclick=()=>operate('connect',state.config.device.id);
  $('rc003-auto').onchange=()=>operate('settings',{autoConnect:$('rc003-auto').checked});
  $('rc003-reset').onclick=()=>operate('settings',{buttons:DEFAULT_BUTTONS});
  api.onRemote(render);api.remote('snapshot').then(result=>{if(result.ok)render(result.value);});
}

export function installRemoteNavigation(api,{notice=()=>{},compose=()=>false}={}) {
  let armed;
  api.onRemoteAction(action=>{
    if(!['up','down','left','right','confirm'].includes(action))return;
    // IPC-delivered remote input does not enable Chromium's :focus-visible
    // keyboard heuristic after mouse use. Keep its focus indication explicit.
    document.documentElement?.setAttribute('data-navigation-input','remote');
    const controls=[...document.querySelectorAll('button,select,input,textarea,summary,a[href],[tabindex="0"]')].filter(el=>!el.disabled && !el.closest('[hidden]') && el.getClientRects().length && el.checkVisibility?.({visibilityProperty:true})!==false);
    const active=document.activeElement,index=controls.indexOf(active);
    if(compose(action,active)){armed=null;return;}
    if(action==='confirm') {
      if(index<0)return;
      if(active.closest('#approval')) {
        if(armed!==active){armed=active;notice('已选择这项审批操作，请阅读说明；再次按确认才会提交。');return;}
      }
      armed=null;
      if(active.matches('button,summary,a[href],input[type="checkbox"],input[type="radio"]'))active.click();
      else if(active.tagName==='TEXTAREA')document.getElementById('send-button')?.focus();
      return;
    }
    armed=null;
    if(!['up','down','left','right'].includes(action))return;
    const delta=['up','left'].includes(action)?-1:1;
    if(active.tagName==='SELECT' && ['left','right'].includes(action)) {
      let next=active.selectedIndex+delta;
      while(next>=0 && next<active.options.length && (active.options[next].disabled || active.options[next].hidden))next+=delta;
      if(next>=0 && next<active.options.length && next!==active.selectedIndex){active.selectedIndex=next;active.dispatchEvent(new Event('change',{bubbles:true}));}
      return;
    }
    if(active.matches('input[type="range"]') && ['left','right'].includes(action)) {
      if(delta>0)active.stepUp();else active.stepDown();
      active.dispatchEvent(new Event('input',{bubbles:true}));active.dispatchEvent(new Event('change',{bubbles:true}));return;
    }
    const next=controls[index<0?0:(index+delta+controls.length)%controls.length];
    next?.focus();next?.scrollIntoView({block:'nearest'});
  });
  document.addEventListener('focusin',()=>{armed=null;});
  const nativeInput=()=>document.documentElement?.removeAttribute('data-navigation-input');
  document.addEventListener('pointerdown',nativeInput,{capture:true});
  document.addEventListener('keydown',nativeInput,{capture:true});
}
