import sharp from 'sharp';
import { mkdir, readFile, writeFile, copyFile, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRunDirectory } from '../qa/run-output.mjs';
import { inspectPuppetAssets } from '../release/puppet-assets.mjs';
import {
  POSE_IDS,
  POSE_FILES,
  POSE_SIZE,
  REPLY_THINKING_POSE,
  validatePoses,
} from '../../prototypes/live2d-codex/renderer/pose-assets.mjs';

const args = process.argv.slice(2);
if (!args.includes('--run') || args.some((arg) => !['--run', '--install', '--reply-thinking-only'].includes(arg)))
  throw Error('Use npm run art:pose-avatar -- --run [--install] [--reply-thinking-only] for local authored artwork only.');
const replyOnly = args.includes('--reply-thinking-only');
const root = resolve(import.meta.dirname, '../..'),
  art = join(root, 'artwork/rin-poses-v1');
const run = await createRunDirectory('pose-authoring');
const output = join(run, 'assets'),
  destination = join(root, 'prototypes/live2d-codex/assets/scene/rin-poses'),
  [W, H] = POSE_SIZE;
await mkdir(output, { recursive: true });
const oldRoot = join(root, 'prototypes/live2d-codex/assets/scene/rin');
const oldRig = JSON.parse(await readFile(join(oldRoot, 'rig.json'), 'utf8'));
const cup = oldRig.layers.find(layer => layer.name === 'cup');
const cupLayer = { input: join(oldRoot, 'cup.png'), left: cup.rect[0], top: cup.rect[1] };
const replyFile = REPLY_THINKING_POSE + '.png';
const blinkFile = REPLY_THINKING_POSE + '-blink.png';
const updatedFiles = ['poses.json', replyFile, blinkFile];
const retained = new Map();
let previousConfigHash;
const replyFace = {
  id: REPLY_THINKING_POSE,
  face: [960, 174, 220, 220],
  eyes: [
    [158, 214, 59, 35, 0.22],
    [321, 187, 68, 37, -0.25],
  ],
  mouth: null,
};
const poses = validatePoses({
  format: 1,
  size: POSE_SIZE,
  poses: [
    {
      id: 'attention',
      face: [1030.6, 124, 211.47, 211.63],
      eyes: [
        [272, 246, 67, 38, -0.25],
        [425, 200, 66, 36, -0.25],
      ],
      mouth: [378, 341, 65, 37, -0.25],
    },
    {
      id: 'cup',
      face: [1120, 180, 230, 230],
      eyes: [
        [150, 174, 57, 38, 0.25],
        [286, 149, 65, 39, -0.15],
      ],
      mouth: null,
    },
    {
      id: 'work',
      face: [1000, 170, 235, 220],
      eyes: [
        [167, 195, 48, 32, 0.25],
        [302, 171, 67, 39, -0.3],
      ],
      mouth: null,
    },
    {
      id: 'thinking',
      face: [960, 165, 225, 235],
      eyes: [
        [110, 149, 20, 29, 0.1],
        [181, 149, 59, 35, 0.02],
      ],
      mouth: null,
    },
    {
      id: 'window',
      face: [1080, 138, 230, 230],
      eyes: [
        [102, 155, 13, 22, 0],
        [166, 157, 56, 36, -0.02],
      ],
      mouth: null,
    },
    replyFace,
  ],
});
if (!replyOnly) {
  const registrations = JSON.parse(await readFile(join(art, 'registration.json'), 'utf8'));
  const original = (id) =>
    join(
      root,
      'prototypes/live2d-codex/assets/stills',
      id === 'thinking' ? 'scene-v3' : 'female-v2',
      id + '.png',
    );
  const foreground = oldRig.layers.find((layer) => layer.name === 'foreground');
  const clear = () => sharp({ create: { width: W, height: H, channels: 4, background: '#00000000' } });
  await sharp(join(art, 'room-no-cup.png')).resize(W, H).png().toFile(join(output, 'background.png'));
  await clear()
    .composite([{ input: join(oldRoot, 'foreground.png'), left: foreground.rect[0], top: foreground.rect[1] }])
    .png()
    .toFile(join(output, 'foreground.png'));
  const front = await readFile(join(output, 'foreground.png'));
  const background = await readFile(join(output, 'background.png'));

  for (const id of POSE_IDS) {
    if (id === REPLY_THINKING_POSE) continue;
    const input = await sharp(original(id)).resize(W, H).ensureAlpha().raw().toBuffer();
    const generated = await sharp(join(art, id + '-matte.png'))
      .resize(W, H)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const registration = registrations[id];
    if (!registration || registration.inliers < 30 || registration.medianError > 1.5)
      throw Error('Unverified matte alignment: ' + id);
    const m = registration.matrix;
    // The original legs continue beyond the bottom canvas edge. Registration can
    // sample just below the generated image; extend its edge instead of cutting
    // an artificial transparent strip through the visible lower legs.
    const alpha = (x, y) => (x < 0 || y < 0 || x >= W ? 0 : generated[(Math.min(H - 1, y) * W + x) * 4 + 3]);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const px = m[0][0] * x + m[0][1] * y + m[0][2],
          py = m[1][0] * x + m[1][1] * y + m[1][2];
        const ix = Math.floor(px),
          iy = Math.floor(py),
          u = px - ix,
          v = py - iy;
        const opacity = Math.round(
          alpha(ix, iy) * (1 - u) * (1 - v) +
            alpha(ix + 1, iy) * u * (1 - v) +
            alpha(ix, iy + 1) * (1 - u) * v +
            alpha(ix + 1, iy + 1) * u * v,
        );
        // Discard 1/255 quantization noise in otherwise transparent background.
        input[(y * W + x) * 4 + 3] = opacity <= 1 ? 0 : opacity;
      }
    // Only alpha is taken from the generated matte: original RGB and geometry stay intact.
    let pose = sharp(input, { raw: { width: W, height: H, channels: 4 } });
    if (id !== 'cup')
      pose = pose.composite([cupLayer]);
    const bytes = await pose.png().toBuffer();
    await writeFile(join(output, id + '.png'), bytes);
    await sharp(background)
      .composite([{ input: bytes }, { input: front }])
      .png()
      .toFile(join(output, 'preview-' + id + '.png'));
    if (id === 'attention') await copyFile(join(oldRoot, 'blink.png'), join(output, id + '-blink.png'));
    else
      await sharp(join(art, id + '-blink.png'))
        .resize(512, 512)
        .png()
        .toFile(join(output, id + '-blink.png'));
  }
  await copyFile(join(oldRoot, 'halfBlink.png'), join(output, 'attention-halfBlink.png'));
  await copyFile(join(oldRoot, 'mouth.png'), join(output, 'attention-mouth.png'));
  await copyFile(join(oldRoot, 'scene.png'), join(output, 'scene.png'));
  await sharp(join(output, 'preview-attention.png'))
    .resize(640)
    .webp({ quality: 85 })
    .toFile(join(output, 'cover.webp'));
} else {
  const { manifest } = await inspectPuppetAssets(destination, { replacingReplyArt: true });
  previousConfigHash = manifest.assets.find(entry => entry.file === 'poses.json').sha256;
  const installed = JSON.parse(await readFile(join(destination, 'poses.json'), 'utf8'));
  poses.poses = [...installed.poses.filter(pose => pose.id !== REPLY_THINKING_POSE), replyFace];
  validatePoses(poses);
  for (const entry of manifest.assets) {
    if (updatedFiles.includes(entry.file)) continue;
    retained.set(entry.file, entry);
    await copyFile(join(destination, entry.file), join(output, entry.file));
  }
}
const replyArt = join(root, 'artwork/rin-reply-thinking');
const sprite = await sharp(join(replyArt, replyFile)).metadata();
if (!sprite.hasAlpha || sprite.width !== W || sprite.height !== H)
  throw Error('Reply thinking needs a registered 1586×992 sprite with transparency.');
const rgba = await sharp(join(replyArt, replyFile)).toColourspace('srgb').ensureAlpha().raw().toBuffer();
// Match the existing texture export: drop 1/255 alpha noise in the fixed room.
for (let i = 3; i < rgba.length; i += 4) {
  if (rgba[i] === 1) rgba[i] = 0;
}
// The cup stays on the side table, at the same room coordinates as the
// other desk poses. The figure pixels come entirely from the new drawing.
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .composite([cupLayer])
  .png()
  .toFile(join(output, replyFile));
const [left, top, width, height] = replyFace.face;
await sharp(join(replyArt, blinkFile))
  .extract({ left, top, width, height })
  .resize(512, 512)
  .png()
  .toFile(join(output, blinkFile));
await sharp(join(output, 'background.png'))
  .composite([{ input: join(output, replyFile) }, { input: join(output, 'foreground.png') }])
  .png()
  .toFile(join(output, 'preview-' + replyFile));
await writeFile(join(output, 'poses.json'), JSON.stringify(poses, null, 2) + '\n');
const assets = [];
for (const file of POSE_FILES) {
  const bytes = await readFile(join(output, file));
  const entry = { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const previous = retained.get(file);
  if (previous && (previous.bytes !== entry.bytes || previous.sha256 !== entry.sha256))
    throw Error('Retained texture changed while preparing: ' + file);
  assets.push(previous ?? entry);
}
const manifest = {
  format: 4,
  renderer: 'complete-pose-dissolve',
  sourceSize: [3840, 2400],
  poseSize: POSE_SIZE,
  assets,
};
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (args.includes('--install')) {
  const lockPath = join(run, '..', 'install.lock');
  const lock = await open(lockPath, 'wx');
  try {
    await mkdir(destination, { recursive: true });
    if (replyOnly) {
      const latest = (await inspectPuppetAssets(destination, { replacingReplyArt: true })).manifest;
      const changed = latest.assets.some(entry => {
        const expected = entry.file === 'poses.json' ? previousConfigHash : retained.get(entry.file)?.sha256;
        return expected && expected !== entry.sha256;
      });
      if (changed)
        throw Error('Original assets changed after preparation. Generate a fresh preview before installing.');
    }
    for (const file of [...(replyOnly ? updatedFiles : POSE_FILES), 'manifest.json'])
      await copyFile(join(output, file), join(destination, file));
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
console.log(
  JSON.stringify({ output, poses: POSE_IDS, files: assets.length, installed: args.includes('--install') }),
);
