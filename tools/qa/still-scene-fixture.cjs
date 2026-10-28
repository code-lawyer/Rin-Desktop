const {app,BrowserWindow,protocol,net}=require('electron');
const {join,resolve,sep}=require('node:path');
const {writeFileSync,mkdirSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=resolve(__dirname,'../..'),output=process.argv[2];
if(!output||!resolve(output).startsWith(join(root,'work','qa')+sep))throw new Error('Output must be beneath work/qa.');
mkdirSync(output,{recursive:true});app.setPath('userData',join(output,'profile'));app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const regions={window:[80,80,460,650],mullion:[610,30,62,320],table:[550,590,340,20],leftArm:[706,665,35,150],rightArm:[1270,700,65,200],backrest:[1460,355,60,90],seat:[1110,845,90,80],throw:[1410,675,55,250],floor:[90,860,400,80]};
const errors=[],checks=[];let win;
app.whenReady().then(async()=>{
  const {stillRoutes}=await import(pathToFileURL(join(root,'tools/project/preview-stills.mjs')).href),routes=stillRoutes({scene:true});
  protocol.handle('app',request=>{const entry=routes.get(new URL(request.url).pathname);return entry?net.fetch(pathToFileURL(join(root,entry[0])).href):new Response('',{status:404});});
  win=new BrowserWindow({show:false,width:1586,height:1200,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level===3&&!message.includes('Electron Security Warning'))errors.push(message);});
  await win.loadURL('app://local/');
  const run=script=>win.webContents.executeJavaScript(script);
  let baseline;
  for(const pose of ['work','cup','thinking','window','attention']){
    await run(`document.querySelector('[data-pose="${pose}"]').click()`);
    for(let i=0;i<100;i++){if(await run(`document.querySelector('canvas').dataset.pose==='${pose}' && document.getElementById('loading').hidden`))break;await new Promise(resolve=>setTimeout(resolve,30));}
    assert.equal(await run("document.querySelector('canvas').dataset.pose"),pose);
    const png=await run("document.querySelector('canvas').toDataURL('image/png')");writeFileSync(join(output,pose+'.png'),Buffer.from(png.split(',')[1],'base64'));
    const pixels=await run(`(()=>{const ctx=document.querySelector('canvas').getContext('2d');return Object.fromEntries(Object.entries(${JSON.stringify(regions)}).map(([name,box])=>[name,Array.from(ctx.getImageData(...box).data)]));})()`);
    if(baseline)for(const [name,data] of Object.entries(pixels))assert.deepEqual(data,baseline[name],pose+' must preserve '+name+' pixels');else baseline=pixels;
    checks.push({pose,regions:Object.keys(regions),samePixels:true});
  }
  assert.deepEqual(errors,[]);
  writeFileSync(join(output,'summary.json'),JSON.stringify({checks,regions,errors,sourceSize:[1586,992],scope:'Fixed furniture regions only; not a full character-edge or 4K art verdict.',accounts:false,hardware:false},null,2));
  win.destroy();app.exit(0);
}).catch(error=>{console.error(error.stack);writeFileSync(join(output,'failure.json'),JSON.stringify({error:error.message,checks,errors},null,2));win?.destroy();app.exit(1);});
