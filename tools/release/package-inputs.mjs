import { execFileSync } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isPrivateProjectPath } from '../project/public-path.mjs';
import { sourceAvatarAsset } from './resource-assets.mjs';

const appPrefix = 'prototypes/live2d-codex/';
const unusedRenderer = /^renderer\/anime-(catalog|player|wallpaper)\.mjs$/;
const ownedInputs = /^(?:main\.cjs|preload\.cjs|voice-resources\.json|backend\/(?:[^/]+\.[cm]js|qwen-worker\.py|qwen-(?:build-constraints|requirements)\.txt)|renderer\/[^/]+\.(?:[cm]?js|html|css)|scripts\/(?:wallpaper-host\.ps1|wallpaper-pose-input\.cs)|assets\/ambience\/(?:README\.md|sources\.json|light-rain\.ogg|soft-keyboard\.ogg))$/;

export function releaseGit(root, args) {
  return execFileSync('git', ['-c', `safe.directory=${root}`, ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  }).trimEnd();
}

export function trackedPackageInputs(root) {
  const tracked = releaseGit(root, ['ls-files', '-z', '--cached', '--', appPrefix]).split('\0').filter(Boolean);
  const ignored = new Set(releaseGit(root, ['ls-files', '-z', '--cached', '--ignored', '--exclude-standard', '--', appPrefix]).split('\0'));
  return tracked.filter(name => {
    const local = name.slice(appPrefix.length);
    return !ignored.has(name) && !isPrivateProjectPath(name) && !sourceAvatarAsset(`resources/app/${local}`) &&
      !unusedRenderer.test(local) && (ownedInputs.test(local) || (local.startsWith('licenses/') && !sourceAvatarAsset(local)));
  }).map(name => name.slice(appPrefix.length));
}

export async function checkedSourcePath(root, name) {
  // Windows can supply the checkout root as a DOS short path. Normalize the
  // root once per lookup while still checking paths below it for redirects.
  const file = join(await realpath(root), name);
  if (!(await lstat(file)).isFile() || relative(file, await realpath(file)) !== '') {
    throw new Error(`Source input must be an ordinary file without linked ancestors: ${name}`);
  }
  return file;
}
