import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createRunDirectory, writeRunReport, requireLiveRun } from './run-output.mjs';

requireLiveRun('npm run qa:halfbody -- --run', 'local browser/WebGL and sample audio decoding only; requires npm run preview:halfbody; no accounts, microphone or camera');
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=await createRunDirectory('live2d-halfbody');
const browser=await chromium.launch({channel:process.env.QA_BROWSER_CHANNEL||'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
const report={scope:'Local browser interaction and sampled Cubism geometry checks. Screenshots are captured, not automatically graded for likeness or anatomy. passed refers only to these technical checks.',visualAcceptance:'not-evaluated-by-this-probe',checks:[]};
try {
  const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5317');
  await page.waitForFunction(()=>window.halfbodyPreview?.state.ready,null,{timeout:30000});
  await page.evaluate(()=>window.halfbodyPreview.setPose(0));await page.waitForTimeout(1300);
  await page.screenshot({path:resolve(output,'front.png')});
  for(const [name,x,y] of [['left',-45,0],['right',45,0],['up-left',-45,20],['down-right',45,-20]]){
    await page.evaluate(([x,y])=>window.halfbodyPreview.setPose(x,y),[x,y]);await page.waitForTimeout(1100);
    const state=await page.evaluate(()=>window.halfbodyPreview.state);
    assert.ok(Math.abs(state.yaw-x)<1&&Math.abs(state.pitch-y)<1);
    await page.screenshot({path:resolve(output,`${name}.png`)});
  }
  report.checks.push('Manual head interpolation reaches all requested yaw/pitch endpoints');
  const geometry=await page.evaluate(()=>{
    const {model,app}=window.halfbodyPreview;app.ticker.stop();
    const raw=model.internalModel.coreModel.getModel();
    const defaults=raw.parameters.defaultValues,indices=Object.fromEntries(raw.parameters.ids.map((id,i)=>[id,i]));
    let samples=0,invalid=0,visibleTriangleFlips=0;
    function apply(x,y,eye,mouth,hair){raw.parameters.values.set(defaults);for(const [id,value] of Object.entries({ParamAngleX:x,ParamAngleY:y,ParamEyeLOpen:eye,ParamEyeROpen:eye,ParamMouthOpenY:mouth,ParamHairFront:hair,ParamHairBack:hair}))raw.parameters.values[indices[id]]=value;raw.update();}
    function signs(){return raw.drawables.vertexPositions.map((v,d)=>{const ix=raw.drawables.indices[d],out=[];for(let i=0;i<ix.length;i+=3){const a=ix[i]*2,b=ix[i+1]*2,c=ix[i+2]*2;const area=(v[b]-v[a])*(v[c+1]-v[a+1])-(v[b+1]-v[a+1])*(v[c]-v[a]);out.push(Math.abs(area)>1e-10?Math.sign(area):0);}return out;});}
    // Open eyes/mouth provide non-collapsed reference triangles; the closed
    // mouth's hidden cavity is intentionally collapsed and is not a baseline.
    apply(0,0,1,1,0);const base=signs();
    for(const x of [-45,0,45])for(const y of [-20,0,20])for(const eye of [0,.5,1])for(const mouth of [0,.5,1])for(const hair of [-1,0,1]){
      apply(x,y,eye,mouth,hair);samples++;
      for(const points of raw.drawables.vertexPositions)for(const value of points)if(!Number.isFinite(value))invalid++;
      const now=signs();now.forEach((values,d)=>{if(raw.drawables.opacities[d]<.05)return;values.forEach((s,i)=>{if(base[d][i]&&s&&s!==base[d][i])visibleTriangleFlips++;});});
    }
    raw.parameters.values.set(defaults);raw.update();app.ticker.start();
    return {samples,invalid,visibleTriangleFlips,drawables:raw.drawables.count,parameters:raw.parameters.count};
  });
  report.geometry=geometry;assert.equal(geometry.invalid,0);assert.equal(geometry.visibleTriangleFlips,0);
  await page.evaluate(()=>window.halfbodyPreview.setPose(0));await page.waitForTimeout(1000);
  await page.click('#blink');
  const blink=await page.evaluate(async()=>{const a=[];for(let i=0;i<20;i++){a.push(window.halfbodyPreview.state.blink);await new Promise(r=>setTimeout(r,20));}return a;});
  assert.ok(Math.min(...blink)<.2&&blink.at(-1)>.98);report.checks.push('Manual blink closes then reopens');
  await page.click('#play');await page.waitForFunction(()=>window.halfbodyPreview.state.playing);
  const speech=await page.evaluate(async()=>{const a=[];for(let i=0;i<90;i++){a.push(window.halfbodyPreview.state.mouth);await new Promise(r=>setTimeout(r,25));}return a;});
  assert.ok(Math.max(...speech)>.15);assert.ok(Math.max(...speech)-Math.min(...speech)>.12);
  await page.screenshot({path:resolve(output,'speaking.png')});await page.click('#stop');
  assert.equal(await page.evaluate(()=>window.halfbodyPreview.state.mouth),0);
  report.audio={observedMaximum:Math.max(...speech),observedMinimum:Math.min(...speech),stopMouth:0};
  report.checks.push('Real decoded sample drives changing mouth amplitude; stop immediately resets it');
  await page.route('**/sample.wav',async route=>{await new Promise(r=>setTimeout(r,400));await route.continue();});
  await page.click('#play');await page.click('#stop');await page.waitForTimeout(700);
  assert.equal(await page.evaluate(()=>window.halfbodyPreview.state.playing),false);
  assert.equal(await page.evaluate(()=>window.halfbodyPreview.state.mouth),0);await page.unroute('**/sample.wav');
  report.checks.push('Stopping during audio loading prevents stale playback');
  await page.setInputFiles('#upload',{name:'invalid.wav',mimeType:'audio/wav',buffer:Buffer.from('invalid audio')});
  await page.waitForFunction(()=>document.getElementById('audio-status').textContent.includes('未能播放'));
  assert.equal(await page.locator('#play').isEnabled(),true);
  await page.setInputFiles('#upload',{name:'sample.wav',mimeType:'audio/wav',buffer:await readFile(resolve(root,'artwork/female-halfbody-v1/sample.wav'))});
  await page.waitForFunction(()=>window.halfbodyPreview.state.playing);await page.click('#stop');
  report.checks.push('Bad local audio is recoverable; valid local audio plays after the failure');
  assert.deepEqual(errors,[]);
  const retry=await browser.newPage({viewport:{width:1280,height:900}});let failures=0;
  await retry.route('**/Generated_artwork.moc3',route=>failures++===0?route.abort():route.continue());
  await retry.goto('http://127.0.0.1:5317');await retry.locator('#error').waitFor({state:'visible'});
  assert.equal(await retry.locator('#play').isEnabled(),false);await retry.click('#retry');
  await retry.waitForFunction(()=>window.halfbodyPreview?.state.ready,null,{timeout:30000});
  assert.equal(await retry.locator('#error').isVisible(),false);
  report.checks.push('Failed model load exposes retry and succeeds on retry');await retry.close();
  report.passed=true;
}catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;}
finally{await browser.close();await writeRunReport(output,report);}
console.log(JSON.stringify({output:relative(root,output),...report},null,2));
