import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { MOTION_IDS } from '../../prototypes/live2d-codex/renderer/motion-catalog.mjs';
import { inspectMotionAssets } from '../release/motion-assets.mjs';

const root = resolve(import.meta.dirname, '../..'), args = process.argv.slice(2);
if (!args.includes('--run') || args.includes('--help')) console.log('Usage: npm run art:motion-clips -- --run --input=<local-master.mp4> --cuts=<five-frame-indices> --id=<new-output-id>\nCuts one master into four contiguous clips at reviewed, zero-based half-open frame boundaries. Normalizes the source 24fps frames to an exact 24fps delivery clock without adding, removing or interpolating frames. Exports two posters, byte-locked runtime manifest and repeated roundtrip preview under work/qa/motion-clips. Never overwrites source or application assets.');
else await main().catch(error => { console.error(error.message); process.exitCode = 1; });

async function main() {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    const match = /^--(input|cuts|id)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Invalid or repeated option.');
    options.set(match[1],match[2]);
  }
  if (options.size !== 3 || !/^[a-z0-9][a-z0-9-]{0,90}$/.test(options.get('id'))) throw new Error('Specify input, five cut boundaries and a fresh id.');
  const input = resolve(root,options.get('input')), local=relative(root,input);
  if (local.startsWith('..') || isAbsolute(local) || !input.endsWith('.mp4')) throw new Error('Input must be a local MP4 inside this workspace.');
  const cuts = options.get('cuts').split(',').map(value => /^\d+$/.test(value) ? Number(value) : NaN);
  if (cuts.length !== 5 || cuts.some((n,i)=>!Number.isSafeInteger(n)||n<0||(i>0&&n<=cuts[i-1]))) throw new Error('Cuts must be five increasing nonnegative frame indices.');
  const source = await probe(input), video = source.streams[0], times=source.frames.map(frame=>Number(frame.best_effort_timestamp_time));
  if (times.length > 1000 || cuts.at(-1)>times.length || Math.abs(video.width/video.height-16/9)>.001
    || times.some((t,i)=>!Number.isFinite(t)||Math.abs(t-i/24)>1/60+.000002)) throw new Error('Expected the reviewed 16:9 master with 24fps source frames on its original clock.');
  const outRoot=join(root,'work/qa/motion-clips'), output=join(outRoot,options.get('id')), media=join(output,'media');
  await mkdir(outRoot,{recursive:true}); await mkdir(output); await mkdir(media);
  const clips=[], integrity={}, provenance=[];
  const encoding=['-an','-c:v','libx264','-preset','medium','-crf','16','-pix_fmt','yuv420p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709','-color_range','tv','-movflags','+faststart'];
  for (const [i,id] of MOTION_IDS.entries()) {
    const start=cuts[i],end=cuts[i+1],count=end-start,file=id+'.mp4',path=join(media,file);
    await command('ffmpeg',['-hide_banner','-loglevel','error','-n','-i',input,'-map','0:v:0','-vf',`trim=start_frame=${start}:end_frame=${end},setpts=N/(24*TB),setsar=1`,'-r','24','-fps_mode','cfr','-frames:v',String(count),...encoding,path]);
    const rendered=await probe(path), renderedTimes=rendered.frames.map(frame=>Number(frame.best_effort_timestamp_time));
    if (renderedTimes.length!==count || renderedTimes.some((t,j)=>Math.abs(t-j/24)>.000002)
      || rendered.streams[0].width!==video.width || rendered.streams[0].height!==video.height
      || Math.abs(Number(rendered.streams[0].duration)-count/24)>.000002) throw new Error('Delivery dimensions, frame count or timestamps changed: '+id);
    clips.push({id,file,duration:count/24,fps:24}); integrity[file]=await record(path);
    provenance.push({id,startFrame:start,endFrameExclusive:end,frameCount:count,sourceFirstSeconds:times[start],sourceLastSeconds:times[end-1]});
  }
  const posters={work:'work.png',user:'user.png'};
  for (const [state,file] of Object.entries(posters)) {
    const path=join(media,file);
    await command('ffmpeg',['-v','error','-n','-i',join(media,state+'-loop.mp4'),'-frames:v','1',path]);
    integrity[file]=await record(path);
  }
  await writeFile(join(media,'manifest.json'),JSON.stringify({format:1,clips,posters,integrity},null,2)+'\n',{flag:'wx'});
  await inspectMotionAssets(media);
  const sequence=['work-loop','work-loop','work-loop','work-user','user-loop','user-loop','user-loop','user-work','work-loop','work-loop','work-loop'];
  await writeFile(join(output,'roundtrip.ffconcat'),'ffconcat version 1.0\n'+sequence.map(id=>`file 'media/${id}.mp4'`).join('\n')+'\n',{flag:'wx'});
  await command('ffmpeg',['-v','error','-n','-f','concat','-safe','0','-i',join(output,'roundtrip.ffconcat'),'-map','0:v:0','-c','copy','-movflags','+faststart',join(output,'roundtrip.mp4')]);
  let elapsed=0;
  const joins=[];
  for(let i=0;i<sequence.length;i++){if(i)joins.push({atSeconds:elapsed,from:sequence[i-1],to:sequence[i]});elapsed+=clips.find(clip=>clip.id===sequence[i]).duration;}
  const demo=await probe(join(output,'roundtrip.mp4'));
  const expectedFrames=sequence.reduce((sum,id)=>sum+provenance.find(clip=>clip.id===id).frameCount,0);
  if(demo.frames.length!==expectedFrames || demo.frames.some((frame,i)=>Math.abs(Number(frame.best_effort_timestamp_time)-i/24)>.000002))throw new Error('Roundtrip frame sequence or timing is incomplete.');
  const report={createdAt:new Date().toISOString(),input:local.split('\\').join('/'),source:await record(input),dimensions:[video.width,video.height],cuts:provenance,deliveryFps:24,frameInterpolation:false,framesAdded:false,audio:'source audio omitted from runtime clips',loopClosure:'direct boundary between selected source frames; visual review required',joins,roundtrip:{frames:expectedFrames,duration:elapsed,...await record(join(output,'roundtrip.mp4'))},visualAcceptance:false};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output,clips,joins},null,2));
}

async function record(path){return{bytes:(await stat(path)).size,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};}
async function probe(path){return JSON.parse((await command('ffprobe',['-v','error','-select_streams','v:0','-show_streams','-show_frames','-show_entries','stream=width,height,duration:frame=best_effort_timestamp_time','-of','json',path])).toString());}
function command(exe,args){return new Promise((resolve,reject)=>{const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.once('error',reject);child.once('close',code=>code===0?resolve(Buffer.concat(out)):reject(new Error(exe+': '+Buffer.concat(err).toString().slice(-2000))));});}
