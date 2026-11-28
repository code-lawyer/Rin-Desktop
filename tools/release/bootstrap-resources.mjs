import { readFile, mkdir, mkdtemp, rename, stat, symlink, access, unlink, copyFile, rmdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fillMissingAssets } from './resource-assets.mjs';
import { inspectMotionAssets } from './motion-assets.mjs';
const root = resolve(import.meta.dirname, '../..');
const repository = 'code-lawyer/Rin-Desktop';

export function validateResourceLock(manifest) {
  const version = manifest?.version;
  if (manifest?.repository !== repository || typeof version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) ||
      !Array.isArray(manifest.files) || manifest.files.length !== 1) throw new Error('Invalid resource lock.');
  const file = `Rin-Desktop-${version}-Setup.exe`, entry = manifest.files[0];
  const url = `https://github.com/${repository}/releases/download/v${version}/${file}`;
  if (entry?.file !== file || entry.url !== url || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 ||
      typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Invalid locked installer.');
  return { version, entry };
}

async function valid(file, entry) {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size !== entry.bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === entry.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function cacheInstaller(file, entry, localInstaller) {
  if (localInstaller && !await valid(localInstaller, entry)) throw new Error('The local installer does not match the locked size and SHA-256.');
  if (await valid(file, entry)) return;
  const temporary = await mkdtemp(join(dirname(file), 'download-'));
  const partial = join(temporary, entry.file);
  try {
    if (localInstaller) await copyFile(localInstaller, partial);
    else {
      console.log(`Downloading ${entry.file}`);
      try {
        execFileSync('curl.exe', ['-fL', '--retry', '3', '--output', partial, entry.url], { windowsHide: true, stdio: 'inherit' });
      } catch (error) {
        throw new Error('Locked installer download failed. For a retired release, use the current main resource lock with --manifest (see docs/build.md).', { cause: error });
      }
    }
    if (!await valid(partial, entry)) throw new Error(`Integrity check failed: ${entry.file}`);
    await rename(partial, file);
  } finally {
    await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(temporary);
  }
}

async function main(args) {
  if (args.includes('--help')) {
    console.log('Usage: npm run resources -- [--manifest=<resource-lock.json>] [--installer=<local-setup.exe>]\nRestore locked runtime/artwork files. Older checkouts can explicitly use a resource lock from main. An explicit installer is hash-checked and used without downloading; existing assets are preserved.');
    return;
  }
  const options = Object.fromEntries(args.map(arg => {
    const match = /^--(manifest|installer)=(.+)$/.exec(arg);
    if (!match) throw new Error('Use --manifest=<resource-lock.json>, --installer=<local-setup.exe> or --help.');
    return [match[1], resolve(match[2])];
  }));
  if (Object.keys(options).length !== args.length) throw new Error('Duplicate resource option.');
  if (process.platform !== 'win32') throw new Error('Runtime resources are for Windows x64. Unit tests do not need these resources.');
  const lock = options.manifest ?? join(root, 'tools/release/resource-manifest.json');
  const { version, entry } = validateResourceLock(JSON.parse(await readFile(lock, 'utf8')));
  const cache = join(root, 'work/resource-downloads', version), target = join(root, 'work/release-resources', version);
  await mkdir(cache, { recursive: true });
  const file = join(cache, entry.file);
  await cacheInstaller(file, entry, options.installer);
  await mkdir(target, { recursive: true });
  execFileSync(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/PORTABLE=1', '/TASKS=', `/DIR=${target}`], { windowsHide: true, stdio: 'inherit' });
  for (const name of ['runtime', 'vendor']) {
    const dest = join(root, 'prototypes/live2d-codex', name), source = join(target, 'resources/app', name);
    if (name === 'vendor') {
      try { await access(source); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    }
    try { await access(dest); } catch (error) { if (error.code !== 'ENOENT') throw error; await symlink(source, dest, 'junction'); }
  }
  const assets = join(root, 'prototypes/live2d-codex/assets');
  console.log(JSON.stringify(await fillMissingAssets(join(target, 'resources/app/assets'), assets)));
  await inspectMotionAssets(join(assets, 'motion/female'));
  console.log(`Resources ready. Set VIBE_RESOURCE_APP=${join(target, 'resources/app')} before packaging.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
