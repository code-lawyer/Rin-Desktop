// Real bubble dragging and wallpaper geometry; no prompts.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createGuiContext } from '../context.mjs';
const context = await createGuiContext('bubble-drag');
const { out } = context;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={checks:[],errors:[]};
let app,chat,wallpaper;
async function waitFor(read,test,name) { for(let i=0;i<200;i++){const v=await read();if(test(v))return v;await sleep(100);}throw new Error('Timeout: '+name); }
async function launch() {
  app = await context.launch('wallpaper');
  await waitFor(()=>Promise.resolve(app.windows()),p=>p.some(x=>x.url().includes('view=chat'))&&p.some(x=>x.url().includes('view=wallpaper')),'windows');
  chat=app.windows().find(p=>p.url().includes('view=chat'));wallpaper=app.windows().find(p=>p.url().includes('view=wallpaper'));
  for(const page of [chat,wallpaper])page.on('pageerror',e=>report.errors.push(e.message));
  await wallpaper.waitForFunction(()=>document.getElementById('wallpaper-view').dataset.ready==='true');
  await waitFor(()=>wallpaper.evaluate(async()=>(await window.companion.presentation()).value),p=>p.desktopAttached,'desktop parent');
  await waitFor(()=>chat.evaluate(async()=>(await window.companion.snapshot()).value),s=>s.connection==='ready'&&s.status==='idle','CLI initial layout');
  await chat.evaluate(()=>window.companion.windowAction('show-chat'));
  await sleep(450);
}
const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=chat')).getContentBounds());
async function drag(dx,dy) {
  const box=await chat.locator('#bubble-drag').boundingBox(), start=await bounds();
  const viewport=await chat.evaluate(()=>({width:innerWidth,height:innerHeight}));
  const x=box.x+box.width*.38,y=box.y+box.height/2;
  const absolute={x:start.x+x*start.width/viewport.width,y:start.y+y*start.height/viewport.height};
  await chat.mouse.move(x,y);await chat.mouse.down();
  for(let i=1;i<=12;i++) {
    const b=await bounds();
    const currentViewport=await chat.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await chat.mouse.move((absolute.x+dx*i/12-b.x)*currentViewport.width/b.width,(absolute.y+dy*i/12-b.y)*currentViewport.height/b.height);
    await sleep(25);
  }
  await chat.mouse.up();await sleep(400);return {start,end:await bounds()};
}
try {
  await launch();
  await chat.evaluate(()=>window.companion.windowAction('align-chat'));await sleep(200);
  report.render=await wallpaper.evaluate(()=>{const c=document.querySelector('#wallpaper-view canvas');return{width:c.width,height:c.height,cssWidth:innerWidth,cssHeight:innerHeight,dpr:devicePixelRatio};});
  assert.equal(report.render.width,Math.round(report.render.cssWidth*report.render.dpr));assert.equal(report.render.height,Math.round(report.render.cssHeight*report.render.dpr));
  report.checks.push('wallpaper renders at native physical resolution');
  report.drags=[];
  for(const [dx,dy] of [[-240,90],[-150,55],[70,-25]]) {
    const result=await drag(dx,dy);report.drags.push(result);
    assert.ok(Math.abs(result.end.x-result.start.x-dx)<=3 && Math.abs(result.end.y-result.start.y-dy)<=3,'pointer movement must move the native bubble');
    assert.ok(Math.abs(result.end.width-result.start.width)<=2 && Math.abs(result.end.height-result.start.height)<=2,'dragging must not resize the bubble');
  }
  const moved=await bounds();
  assert.equal(await chat.locator('.bubble-tail').isVisible(),false);
  await chat.locator('#prompt').fill('拖动后保留的草稿');
  await chat.locator('#settings-button').click();await sleep(250);await chat.locator('#settings-button').click();await sleep(250);
  const afterControls=await bounds();assert.ok(Math.abs(afterControls.x-moved.x)<3 && Math.abs(afterControls.y-moved.y)<3);
  report.checks.push('header drag, stable dimensions, detached tail, controls remain clickable');
  await chat.locator('#reading-button').click();await chat.waitForFunction(()=>document.getElementById('chat-view').dataset.reading==='true');
  await chat.keyboard.press('Escape');await chat.waitForFunction(()=>document.getElementById('chat-view').dataset.reading==='false');await sleep(450);
  assert.equal(await chat.locator('#prompt').inputValue(),'拖动后保留的草稿');
  const afterReading=await bounds();assert.ok(Math.abs(afterReading.x-moved.x)<3 && Math.abs(afterReading.y-moved.y)<3);
  report.checks.push('full-screen reading restores the dragged position and draft');
  const state=await chat.evaluate(async()=>(await window.companion.snapshot()).value);
  const renderReply=async text=>app.evaluate(({BrowserWindow},{state,text})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=chat')).webContents.send('companion:state',{...state,messages:[{id:'test-user',role:'user',text:'test'},{id:'test-answer',role:'assistant',text,complete:true}]}),{state,text});
  await renderReply('这是长回复位置检查。\n\n'.repeat(100));await sleep(450);
  const long=await bounds();const area=await app.evaluate(({screen})=>screen.getPrimaryDisplay().workArea);
  assert.ok(long.y>=area.y && long.y+long.height<=area.y+area.height+2);
  await renderReply('已修复拖动；可以继续输入任务。');await sleep(450);
  assert.ok(Math.abs((await bounds()).x-moved.x)<3 && Math.abs((await bounds()).y-moved.y)<3);
  report.checks.push('long replies stay on screen and short replies keep the chosen position');
  const coverId=await app.evaluate(({BrowserWindow})=>{
    const chat=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=chat')), b=chat.getBounds();
    const cover=new BrowserWindow({x:b.x-10,y:b.y-10,width:b.width+40,height:b.height+40,show:true,alwaysOnTop:true,title:'Vibe Voice · 遮挡验证',backgroundColor:'#23313a'});
    cover.focus();return cover.id;
  });
  await waitFor(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=chat')).isFocused()),v=>!v,'test cover owns focus');
  await chat.evaluate(()=>window.companion.windowAction('recall-chat'));await sleep(200);
  report.recall=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('view=chat'));return{visible:w.isVisible(),focused:w.isFocused(),topmost:w.isAlwaysOnTop()};});
  assert.ok(report.recall.visible&&report.recall.focused&&report.recall.topmost);
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id)?.destroy(),coverId);
  await chat.evaluate(()=>window.companion.windowAction('hide-chat'));await chat.evaluate(()=>window.companion.windowAction('recall-chat'));await sleep(200);
  assert.ok(Math.abs((await bounds()).x-moved.x)<3);
  report.checks.push('recall raises a visible unfocused window and reopens a hidden window');
  await chat.screenshot({path:resolve(out,'dragged-bubble.png'),omitBackground:true});
  report.savedPosition={x:moved.x,y:moved.y};
  await app.close();app=null;
  await launch();const restored=await bounds();report.restored=restored;
  assert.ok(Math.abs(restored.x-moved.x)<3 && Math.abs(restored.y-moved.y)<3);
  await chat.locator('#settings-button').click();await chat.locator('#align-chat').click();
  await waitFor(()=>chat.locator('#chat-view').getAttribute('data-detached'),v=>v==='false','reset to character');
  report.checks.push('restart restores position; reset resumes automatic character alignment');
  assert.equal(report.errors.length,0,report.errors.join('\n'));
} catch(error){report.failure=error.stack;process.exitCode=1;}
finally{if(app)await app.close();await writeFile(resolve(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
