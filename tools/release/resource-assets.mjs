import { readdir, lstat, mkdir, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative } from 'node:path';

// Older locked installers still contain retired artwork. Never restore it into
// the current checkout, even when the runtime archive itself is historical.
export const retiredWallpaperAsset = path => /^(?:rainy-window-male(?:\/|$)|stills\/male(?:\/|$)|character-previews\/male\.png$)/i.test(path.replaceAll('\\', '/'));

const sourceAvatarFiles = new Set([
  'resources/app/backend/video-catalog.mjs',
  'resources/app/backend/video-media.mjs',
  'resources/app/backend/wallpaper-state.cjs',
  'resources/app/renderer/action-assets.mjs',
  'resources/app/renderer/action-motion.mjs',
  'resources/app/renderer/action-rig.mjs',
  'resources/app/renderer/avatar.js',
  'resources/app/renderer/pixi-compat.js',
  'resources/app/renderer/rig-warp.mjs',
  'resources/app/renderer/scene-player.mjs',
  'resources/app/renderer/still-preview.css',
  'resources/app/renderer/still-preview.html',
  'resources/app/renderer/still-preview.mjs',
  'resources/app/renderer/still-scene-compose.mjs',
  'resources/app/renderer/still-scene-preview.css',
  'resources/app/renderer/still-scene-preview.html',
  'resources/app/renderer/still-scene-preview.mjs',
  'resources/app/renderer/typing-motion.mjs',
  'resources/app/renderer/video-state.mjs',
  'resources/app/renderer/video-wallpaper.js',
  'resources/app/renderer/wallpaper-scenes.mjs',
  'resources/app/renderer/wallpaper.js',
  'resources/app/dist/avatar.js',
  'licenses/agent-avatar-LICENSE',
  'licenses/live2d-proprietary-agreement.html',
  'licenses/pixi-LICENSE',
  'licenses/pixi-live2d-LICENSE',
].map(name => name.toLowerCase()));
export function sourceAvatarAsset(path) {
  const name = path.replaceAll('\\', '/').toLowerCase();
  return (
    name === 'resources/app/vendor' ||
    name.startsWith('resources/app/vendor/') ||
    name === 'resources/app/assets/rainy-window-v2-4k' ||
    name.startsWith('resources/app/assets/rainy-window-v2-4k/') ||
    sourceAvatarFiles.has(name)
  );
}

async function inspect(path) {
  try { return await lstat(path); }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
}

// The checkout already contains manifests and some artwork. Fill nested holes
// without replacing source-owned files or traversing existing directory links.
export async function fillMissingAssets(source, destination) {
  const result={copied:0,preserved:0,skippedLinks:0};
  async function visit(from,to){
    if (retiredWallpaperAsset(relative(source, from))) return;
    const origin=await lstat(from), existing=await inspect(to);
    if(origin.isSymbolicLink())throw new Error('Resource archives must contain ordinary files and directories.');
    if(existing?.isSymbolicLink()){result.skippedLinks++;return;}
    if(origin.isDirectory()){
      if(existing&&!existing.isDirectory())throw new Error('An asset directory is occupied by a file: '+to);
      await mkdir(to,{recursive:true});
      for(const entry of await readdir(from))await visit(join(from,entry),join(to,entry));
    }else if(origin.isFile()){
      if(existing){result.preserved++;return;}
      try { await copyFile(from,to,constants.COPYFILE_EXCL);result.copied++; }
      catch(error){if(error.code==='EEXIST')result.preserved++;else throw error;}
    }else throw new Error('Unsupported resource archive entry: '+from);
  }
  await visit(source,destination);
  return result;
}
