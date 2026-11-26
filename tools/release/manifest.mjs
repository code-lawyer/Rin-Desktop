import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { publicTextEncoding, publicTextProblems } from './audit-public.mjs';
import { retiredWallpaperAsset, sourceAvatarAsset } from './resource-assets.mjs';

const root = resolve(import.meta.dirname, '../..');
const privatePart = /(?:^|\/)(?:\.[^/]+|models|__pycache__|voice-resources|profile|work)(?:\/|$)/i;
const privateFile = /(?:^|\/)(?:(?:auth|session|workspaces|appearance|provider)\.json|custom-agents\.json(?:\..*)?|(?:codex|claude|grok|agy|dsh|opencode)\.exe)$|\.(?:log|tmp|bak|wav|pcm|onnx|safetensors|zip|7z|py[co]|partial|pem|key|pfx)$/i;
const retiredAgent = /(?:^|\/)(?:dots\.mjs|(?:custom-agents|custom-agent-settings|agent-setup-prompt)\.mjs)$|(?:^|\/)@anthropic-ai\/claude-agent-sdk(?:[-/]|$)/i;
const appDist = 'resources/app/dist';

function checkPackagePath(name) {
  const lower = name.toLowerCase(), local = lower.replace(/^resources\/app\//, '');
  if (/[:\\]/.test(name) || privatePart.test(name) || privateFile.test(name) || retiredAgent.test(name) ||
      sourceAvatarAsset(lower) || retiredWallpaperAsset(local.replace(/^assets\//, '')) ||
      /^(?:assets\/(?:motion\/anime|stills|character-previews|livliv)|runtime\/qwen|agents)(?:\/|$)|^renderer\/anime-(?:catalog|player|wallpaper)\.mjs$/.test(local) ||
      (lower.startsWith(`${appDist}/`) && !/^dist\/(?:app\.js|workbench\.js|chunks(?:\/chunk-[a-z0-9]+\.js)?)$/.test(local))) {
    throw new Error(`Non-public or unexpected package path: ${name}`);
  }
}

async function inspectFile(path, name, size) {
  const hash = createHash('sha256');
  // Electron includes a large Chromium license document. Read text in full,
  // while hashing executable/media files in a bounded stream.
  const file = await open(path);
  let binary;
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(8192), 0, 8192, 0);
    binary = !publicTextEncoding(buffer.subarray(0, bytesRead));
  }
  finally { await file.close(); }
  if (binary) {
    for await (const chunk of createReadStream(path)) hash.update(chunk);
  } else {
    if (size > 32 * 1024 * 1024) throw new Error(`Unexpected large text in package: ${name}`);
    const data = await readFile(path), problems = publicTextProblems(data, root);
    if (problems.length) throw new Error(`Package file ${name}: ${problems.join(', ')}`);
    hash.update(data);
  }
  return { file: name, bytes: size, sha256: hash.digest('hex') };
}

// Inspect the actual output, independently of the paths written to a manifest.
export async function inspectPackage(output, { installed = false } = {}) {
  if (!(await lstat(output)).isDirectory()) throw new Error('Package root must be an ordinary directory.');
  const files = [], seen = new Set();
  async function collect(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name), name = prefix + entry.name, key = name.toLowerCase();
      if (seen.has(key)) throw new Error(`Duplicate package path: ${name}`);
      seen.add(key);
      checkPackagePath(name);
      if (entry.isDirectory()) await collect(path, `${name}/`);
      else {
        if (!entry.isFile()) throw new Error(`Package entry must be an ordinary file: ${name}`);
        if (name === 'manifest.json' || (installed && /^unins\d+\.(exe|dat|msg)$/i.test(name))) continue;
        files.push(await inspectFile(path, name, (await lstat(path)).size));
      }
    }
  }
  await collect(output, '');
  return { bytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
}

export async function checkPackageGuides(output, files) {
  const names = new Set(files.map(file => file.file));
  for (const name of ['CLI-AGENTS.md', 'USER-GUIDE.md', 'TEST-ACCEPTANCE.md']) {
    if (!names.has(name)) continue;
    const guide = await readFile(join(output, name), 'utf8');
    for (const [, target] of guide.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if (/^(https?:\/\/|#)/i.test(target)) continue;
      const local = relative(output, resolve(output, target.split('#')[0])).replaceAll('\\', '/');
      if (!local || isAbsolute(local) || !names.has(local)) throw new Error(`Missing or external link in ${name}: ${target}`);
    }
  }
}

export async function writeManifest(output, version) {
  const { bytes, files } = await inspectPackage(output);
  await checkPackageGuides(output, files);
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ version, platform: 'win32-x64', bytes, files }, null, 2));
  return { bytes, files: files.length };
}
