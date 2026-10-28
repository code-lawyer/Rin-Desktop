import { spawn } from 'node:child_process';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { copyMotionAssets } from '../release/motion-assets.mjs';
if (!process.argv.includes('--run') || process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: npm run qa:motion -- --run [--media=<validated-runtime-directory>]\nChecks the production wallpaper, dialogue, workbench, voices and ambience in isolated Electron. Without --media, creates four tiny synthetic clips. With --media, copies the six hash-checked runtime assets and enables the normal GPU path for 4K video; records the actual OS-assigned viewport. No account or remote/microphone hardware acceptance. Default: help only; no files or processes.');
  process.exit(0);
}
const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2), mediaArgs = args.filter(arg => arg.startsWith('--media='));
if (args.some(arg => arg !== '--run' && !arg.startsWith('--media=')) || mediaArgs.length > 1 || mediaArgs.some(arg => !arg.slice(8))) throw new Error('Use --run and at most one nonempty --media directory.');
const output = join(root, 'work/qa/motion-desktop-' + new Date().toISOString().replace(/[:.]/g, '-')), media = join(output, 'media');
if (mediaArgs.length) await copyMotionAssets(resolve(root, mediaArgs[0].slice(8)), media);
else {
await mkdir(media, { recursive: true });
const ids = ['work-loop', 'work-user', 'user-loop', 'user-work'];
await command('ffmpeg', ['-hide_banner','-loglevel','error','-n','-f','lavfi','-i','testsrc2=size=640x360:rate=24:duration=1.25',
  '-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',join(media,'work-loop.mp4')]);
for (const id of ids.slice(1)) await copyFile(join(media,'work-loop.mp4'), join(media,id+'.mp4'));
await command('ffmpeg', ['-hide_banner','-loglevel','error','-n','-i',join(media,'work-loop.mp4'),'-frames:v','1',join(media,'work.png')]);
await copyFile(join(media,'work.png'),join(media,'user.png'));
await writeFile(join(media,'manifest.json'), JSON.stringify({format:1,synthetic:true,clips:ids.map(id=>({id,file:id+'.mp4',duration:1.25,fps:24})),posters:{work:'work.png',user:'user.png'}}));
}
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
await command(join(root,'prototypes/live2d-codex/node_modules/electron/dist/electron.exe'),[join(import.meta.dirname,'still-fixture.cjs'),output,'--motion',...(mediaArgs.length ? ['--actual-motion'] : [])],env);
console.log(JSON.stringify({output,syntheticMedia:!mediaArgs.length,accounts:false,hardware:false}));
function command(exe,args,env=process.env) {
  return new Promise((resolve,reject)=>{const child=spawn(exe,args,{env,windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${exe} exited ${code}`)));});
}
