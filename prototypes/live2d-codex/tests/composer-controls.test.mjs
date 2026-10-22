import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftSession } from '../renderer/draft-session.mjs';
import { composerRemoteHints, installComposerControls } from '../renderer/composer-controls.mjs';
import { installRemoteNavigation } from '../renderer/remote-ui.mjs';
import { installSettingsNavigation } from '../renderer/settings-navigation.mjs';
import { remoteSettings } from '../backend/remote-config.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const target = {provider:'codex',cwd:'project',threadId:'a'};

function draftHarness() {
  let text = ''; const saved = new Map([['a','语音生成的草稿'],['b','另一个会话的草稿']]);
  const drafts = createDraftSession({request:async (target,value) => {
    if (value !== undefined) saved.set(target.threadId,value);
    return {ok:true,value:{text:saved.get(target.threadId) ?? ''}};
  },getText:()=>text,setText:value=>text=value,error:assert.fail});
  return {drafts,saved,get text(){return text;},set text(value){text=value;}};
}
test('clear and undo persist only the current draft, retain unsaved edits and expire on conversation changes',async()=>{
  const h=draftHarness(); await h.drafts.restore(target);
  h.text+='，继续补充'; h.drafts.edited();
  assert.equal(await h.drafts.clear(),true);assert.equal(h.text,'');assert.equal(h.saved.get('a'),'');assert.equal(h.saved.get('b'),'另一个会话的草稿');
  assert.equal(h.drafts.canUndoClear(),true);await h.drafts.undoClear();assert.equal(h.saved.get('a'),'语音生成的草稿，继续补充');
  await h.drafts.clear();await h.drafts.restore({...target,threadId:'b'});
  assert.equal(await h.drafts.undoClear(),false);assert.equal(h.text,'另一个会话的草稿');
});
test('typing or a new dictation after clearing invalidates undo without replacing new text',async()=>{
  const h=draftHarness();await h.drafts.restore(target);await h.drafts.clear();
  await h.drafts.appendExternal({target,text:'重新录制的草稿',id:'new-recording'});
  assert.equal(h.drafts.canUndoClear(),false);assert.equal(await h.drafts.undoClear(),false);assert.equal(h.text,'重新录制的草稿');
});
test('clearing during a pending draft read cannot clear a newly selected conversation',async()=>{
  let finish,text='';const writes=[];
  const drafts=createDraftSession({request:(target,value)=> value===undefined ? target.threadId==='a'?new Promise(r=>finish=r):Promise.resolve({ok:true,value:{text:'B'}}) : (writes.push([target.threadId,value]),Promise.resolve({ok:true})),getText:()=>text,setText:value=>text=value,error:assert.fail});
  drafts.restore(target);const clear=drafts.clear();await drafts.restore({...target,threadId:'b'});finish({ok:true,value:{text:'A'}});await clear;
  assert.equal(text,'B');assert.deepEqual(writes,[]);
});
test('remote hints follow saved button assignments and distinguish undo from reading',()=>{
  const buttons=remoteSettings().buttons;
  assert.match(composerRemoteHints(buttons,{hasText:true}),/确认键发送.*左键清空.*右键朗读/);
  assert.match(composerRemoteHints(buttons,{undo:true}),/右键撤销/);
  const custom={...buttons,confirm:'none',left:'none',right:'none',home:'send',menu:'clearDraft'};
  assert.equal(composerRemoteHints(custom,{hasText:true}),'主页键发送 · 菜单键清空');
});
test('one remote confirmation sends a draft; clear, undo and reading work without approving permission dialogs',async t=>{
  const old=globalThis.document;t.after(()=>globalThis.document=old);
  const nodes=new Map(),events={},calls=[];let remoteHandler,receive,locked=false,capturing=false;
  const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,value:'',textContent:'',tagName:'BUTTON',setAttribute(){},getClientRects:()=>[{}],closest:()=>null,matches:()=>false,focus(){globalThis.document.activeElement=this;events.focusin?.();}});return nodes.get(id);};
  globalThis.document={getElementById:get,addEventListener:(event,fn)=>events[event]=fn,querySelectorAll:()=>[get('prompt'),get('send-button')],activeElement:get('prompt')};
  get('prompt').tagName='TEXTAREA';get('approval').hidden=true;get('context-panel').hidden=true;
  const h=draftHarness();await h.drafts.restore(target);get('prompt').value=h.text;
  const drafts={...h.drafts,clear:async()=>{await h.drafts.clear();get('prompt').value=h.text;},undoClear:async()=>{await h.drafts.undoClear();get('prompt').value=h.text;}};
  const api={onRemote:fn=>remoteHandler=fn,remote:async()=>({ok:true,value:{phase:'connected',config:remoteSettings()}}),onRemoteAction:fn=>receive=fn};
  const composer=installComposerControls({api,drafts,submit:()=>calls.push('send'),readReply:()=>calls.push('read'),isLocked:()=>locked,isCapturing:()=>capturing,error:value=>calls.push(value),measure(){}});
  installRemoteNavigation(api,{compose:composer.action});await tick();
  receive('confirm');assert.deepEqual(calls,['send']);
  receive('left');await tick();assert.equal(h.text,'');receive('right');await tick();assert.equal(h.text,'语音生成的草稿');
  receive('right');assert.equal(calls.at(-1),'read');
  get('approval').hidden=false;assert.equal(composer.action('confirm',get('prompt')),false);get('approval').hidden=true;
  capturing=true;receive('left');await tick();assert.equal(h.text,'语音生成的草稿');assert.match(calls.at(-1),/识别完成/);
  capturing=false;locked=true;receive('clearDraft');await tick();assert.equal(h.text,'语音生成的草稿');
  remoteHandler({phase:'disconnected',config:remoteSettings()});assert.match(get('composer-hint').textContent,/Enter/);
});
test('settings categories hide unrelated sections without recreating edited inputs',()=>{
  const sections=[{id:'wall',dataset:{settingsGroup:'wall'}},{id:'voice',dataset:{settingsGroup:'voice'},input:{value:'unsaved'}},{id:'models',dataset:{settingsGroup:'voice'}}].map(section=>({...section,scrollIntoView(){},querySelector:()=>null}));
  const buttons=['wall','voice'].map(id=>({dataset:{settingTarget:id},attributes:{},setAttribute(key,value){this.attributes[key]=value;}}));
  const navigation=installSettingsNavigation({querySelectorAll:selector=>selector==='[data-setting-target]'?buttons:sections,getElementById:id=>sections.find(s=>s.id===id)});
  navigation.show('voice');assert.deepEqual(sections.map(s=>s.hidden),[true,false,false]);assert.equal(buttons[1].attributes['aria-pressed'],'true');
  navigation.show('wall');assert.equal(sections[1].input.value,'unsaved');assert.deepEqual(sections.map(s=>s.hidden),[false,true,true]);
});
test('confirming a settings category keeps focus in the remote control order',()=>{
  let focused;
  const sections=['wall','voice'].map(id=>({id,dataset:{settingsGroup:id},scrollIntoView(){}}));
  const buttons=sections.map(section=>({dataset:{settingTarget:section.id},setAttribute(){},focus(){focused=this;}}));
  installSettingsNavigation({querySelectorAll:selector=>selector==='[data-setting-target]'?buttons:sections,getElementById:id=>sections.find(section=>section.id===id)});
  buttons[1].onclick();assert.equal(focused,buttons[1]);
  assert.deepEqual(sections.map(section=>section.hidden),[true,false]);
});
