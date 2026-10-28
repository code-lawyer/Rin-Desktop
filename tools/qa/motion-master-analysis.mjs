import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
if (!args.includes('--run') || args.includes('--help')) console.log('Usage: node tools/qa/motion-master-analysis.mjs --run --input=<local-mp4> --id=<new-report-id>\nMeasures adjacent frames and candidate loop boundaries of the approved fixed-camera two-state master. Candidate time windows are specific to this shot; scores do not replace visual review. Default: help only.');
else await main().catch(error => { console.error(error.message); process.exitCode = 1; });

async function main() {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    const match = /^--(input|id)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Invalid or repeated option.');
    options.set(match[1], match[2]);
  }
  if (options.size !== 2 || !/^[a-z0-9][a-z0-9-]{0,90}$/.test(options.get('id'))) throw new Error('Specify input and a fresh output id.');
  const input = resolve(root, options.get('input')), local = relative(root, input);
  if (local.startsWith('..') || isAbsolute(local) || !input.endsWith('.mp4')) throw new Error('Use an MP4 inside this workspace.');
  const probe = JSON.parse((await command('ffprobe', ['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=width,height,duration,r_frame_rate,avg_frame_rate:frame=best_effort_timestamp_time','-of','json',input])).toString());
  const times = probe.frames.map(frame => Number(frame.best_effort_timestamp_time));
  if (times.length < 100 || times.length > 1000 || times.some((t,i) => !Number.isFinite(t) || (i && t <= times[i-1])) || times.at(-1) > 20) throw new Error('Expected one short master with increasing frame timestamps.');
  const raw = await command('ffmpeg', ['-v','error','-i',input,'-vf','scale=320:180:flags=area','-fps_mode','passthrough','-pix_fmt','rgb24','-f','rawvideo','-']);
  const stride = 320*180*3;
  if (raw.length !== times.length*stride) throw new Error('Decoded frame count does not match timestamps.');
  const frames = times.map((_,i) => raw.subarray(i*stride,(i+1)*stride));
  const regions = { full:[0,0,320,180], head:[198,8,75,72], hands:[175,112,64,27], window:[3,20,110,145], windowFrame:[115,5,28,75], lamp:[275,2,42,58], sofa:[270,75,45,95] };
  const compare = (a,b) => Object.fromEntries(Object.entries(regions).map(([key,box])=>[key,difference(frames[a],frames[b],box)]));
  const changes = times.slice(1).map((time,i)=>({frame:i+1,time,mae:compare(i,i+1)}));
  const baseline = Object.fromEntries(Object.keys(regions).map(key=>[key,median(changes.map(change=>change.mae[key]))]));
  const score = mae => mae.full + .8*mae.head + .3*mae.hands + .4*mae.sofa;
  const indices = (min,max) => times.map((time,i)=>time>=min && time<=max ? i : -1).filter(i=>i>=0);
  const pairs = (first,last,minDuration) => {
    const candidates=[];
    for(const a of first) for(const b of last) {
      if(times[b]-times[a]<minDuration)continue;
      const mae=compare(a,b); candidates.push({start:a,end:b,startSeconds:times[a],endSeconds:times[b],score:score(mae),mae});
    }
    return candidates.sort((a,b)=>a.score-b.score);
  };
  const work = pairs(indices(.1,1.1),indices(1.9,3),1.8).slice(0,40);
  for(const candidate of work) {
    const returns = indices(13,15).map(end=>{const mae=compare(end,candidate.start);return{end,time:times[end],score:score(mae),mae};}).sort((a,b)=>a.score-b.score);
    candidate.return=returns[0]; candidate.combinedScore=candidate.score+returns[0].score;
  }
  work.sort((a,b)=>a.combinedScore-b.combinedScore);
  const user = pairs(indices(4.5,6),indices(8.5,10.5),3).slice(0,20);
  const output = join(root,'work/qa/motion-master',options.get('id'));
  await mkdir(join(root,'work/qa/motion-master'),{recursive:true}); await mkdir(output);
  const report = {input:local.split('\\').join('/'),sha256:createHash('sha256').update(await readFile(input)).digest('hex'),stream:probe.streams[0],frameTimes:times,regions,baseline,largestChanges:[...changes].sort((a,b)=>b.mae.full-a.mae.full).slice(0,25),workCandidates:work.slice(0,12),userCandidates:user,changes,visualAcceptance:false};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  const selected = [...new Set([work[0].start,work[0].end,work[0].return.end,user[0].start,user[0].end])];
  for(const index of selected) await command('ffmpeg',['-v','error','-n','-i',input,'-vf',`select=eq(n\\,${index})`,'-frames:v','1',join(output,`frame-${index}.png`)]);
  console.log(JSON.stringify({output,frameCount:times.length,baseline,work:work.slice(0,3),user:user.slice(0,3),largestChanges:report.largestChanges.slice(0,4)},null,2));
}

function difference(a,b,[x,y,w,h]) { let total=0;for(let row=y;row<y+h;row++)for(let i=(row*320+x)*3,end=i+w*3;i<end;i++)total+=Math.abs(a[i]-b[i]);return total/(w*h*3); }
function median(values){values.sort((a,b)=>a-b);return values[Math.floor(values.length/2)];}
function command(exe,args){return new Promise((resolve,reject)=>{const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.once('error',reject);child.once('close',code=>code===0?resolve(Buffer.concat(out)):reject(new Error(exe+': '+Buffer.concat(err).toString().slice(-2000))));});}
