import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ASSET_FILES, validateRig } from '../../prototypes/live2d-codex/renderer/action-assets.mjs';
const root = resolve(import.meta.dirname, '../..'),
  W = 1586,
  H = 992;
if (!process.argv.includes('--run')) {
  console.log('npm run art:action-avatar -- --run [--install]');
  process.exit(0);
}
if (process.argv.slice(2).some((arg) => !['--run', '--install'].includes(arg)))
  throw Error('Use --run and optionally --install');
const output = join(root, 'work/qa/action-authoring/assets');
await mkdir(output, { recursive: true });
const source = {
  neutral: 'prototypes/live2d-codex/assets/stills/female-v2/attention.png',
  work: 'prototypes/live2d-codex/assets/stills/female-v2/work.png',
  wave: 'artwork/rin-actions-v3/wave-key.png',
  clean: 'artwork/rin-actions-v3/arms-clean.png',
  empty: 'artwork/rin-actions-v3/empty-upper.png',
  window: 'artwork/rin-actions-v3/window-key.png',
  chin: 'artwork/rin-actions-v3/chin-key.png',
  drink: 'artwork/rin-actions-v3/drink-key.png',
};
const images = {};
for (const [name, path] of Object.entries(source))
  images[name] = await sharp(join(root, path)).resize(W, H).ensureAlpha().png().toBuffer();
const paths = {
  body: 'M1045 113 L1078 109 Q1106 68 1175 69 L1235 79 L1249 60 L1267 82 L1285 58 L1281 96 Q1321 91 1339 152 L1341 218 Q1344 307 1375 364 Q1412 408 1443 467 Q1452 503 1429 533 L1415 562 L1398 587 L1351 614 L1303 617 L1275 615 L1100 618 L1080 583 L1014 577 L972 550 L938 545 L955 503 Q974 450 1023 390 L1027 330 L1029 251 Q1016 190 1053 139Z',
  upper:
    'M1295 335 C1328 319 1369 334 1378 369 C1388 420 1364 495 1344 552 Q1337 578 1304 579 Q1272 580 1262 558 Q1287 524 1300 481 L1300 413 Q1280 375 1295 335Z',
  hand: 'M1197 606 Q1215 613 1213 635 Q1191 651 1152 662 Q1136 666 1124 659 L1101 653 L1080 651 L1080 640 Q1101 624 1124 625 L1172 615Z',
  farUpper:
    'M1050 362 Q1088 356 1097 400 L1094 489 L1105 533 L1094 567 L1030 563 Q1008 535 1027 497 L1034 421Z',
  farHand:
    'M1083 616 Q1107 610 1136 641 Q1156 656 1172 678 Q1177 691 1166 687 L1157 676 Q1154 691 1145 681 L1129 664 L1107 660 L1081 648Z',
  waveFore:
    'M1311 383 Q1329 400 1347 380 L1367 453 Q1380 507 1350 544 Q1334 568 1311 545 Q1290 525 1298 484 L1292 413Z',
  waveHand:
    'M1306 391 L1304 365 Q1290 348 1294 324 L1297 291 Q1299 272 1305 274 Q1311 276 1310 300 L1314 310 L1327 280 L1341 247 Q1346 237 1351 241 Q1355 246 1348 263 L1338 292 L1354 263 Q1367 241 1373 247 Q1378 252 1366 273 L1351 303 L1374 278 Q1386 264 1391 270 Q1395 274 1381 290 L1361 316 L1383 299 Q1395 287 1400 292 Q1405 297 1390 309 L1371 326 Q1361 350 1347 364 L1338 389 Q1323 400 1306 391Z',
  chinFore:
    'M1182 352 L1229 338 Q1235 363 1245 388 L1284 438 Q1306 465 1294 506 Q1289 532 1260 537 Q1234 538 1225 510 L1203 438 L1194 389Z',
  chinHand:
    'M1193 347 L1191 320 Q1190 303 1205 292 L1216 282 Q1213 275 1219 260 Q1224 251 1232 254 L1235 252 Q1244 252 1247 260 L1251 260 L1259 278 Q1266 286 1260 293 L1231 315 L1225 341Z',
  drinkFore:
    'M1215 420 L1252 397 Q1265 425 1283 443 L1324 487 Q1350 518 1322 558 Q1306 581 1283 571 Q1260 554 1250 518 L1231 461Z',
  cupHand:
    'M1178 294 Q1217 296 1229 320 Q1243 345 1242 379 L1255 399 L1220 424 Q1202 398 1200 370 Q1182 364 1167 357 Q1153 348 1167 342 Q1148 334 1157 323 L1163 319 Q1151 313 1159 307 L1175 307 Q1167 301 1178 294Z',
  typeNear:
    'M1129 553 Q1137 572 1128 591 L1104 589 L1060 578 Q1026 572 1007 563 L982 554 L964 562 L956 577 Q949 582 945 578 L950 562 L942 573 Q935 580 931 576 L939 555 L938 544 Q947 531 963 529 L985 534 Q1004 528 1021 538 L1064 550Z',
  typeFar:
    'M987 531 L985 550 Q966 550 955 548 L943 557 L931 560 L925 543 L922 527 Q929 518 938 525 L951 526 L961 521Z',
  foreground:
    'M615 387 Q616 384 624 384 L844 384 Q851 385 854 397 L941 585 L937 593 L687 581 Q679 580 677 572Z M541 582 L679 581 L690 589 L1128 591 L1128 611 L547 617 L540 608Z',
  cup: 'M1493 673 Q1491 666 1508 663 Q1543 656 1584 665 L1585 745 Q1585 770 1555 776 Q1516 778 1503 765 L1498 743 Q1479 738 1479 708 Q1478 687 1497 687Z M1497 698 Q1487 696 1488 711 Q1488 727 1499 731Z',
};
const svg = (path) =>
  Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><path d="${path}" fill="white" fill-rule="evenodd"/></svg>`
  );
const mask = async (path, blur = 0) => {
  let p = sharp(svg(path));
  if (blur) p = p.blur(blur);
  return p.png().toBuffer();
};
const masked = async (image, path, blur = 0) =>
  sharp(image)
    .composite([{ input: await mask(path, blur), blend: 'dest-in' }])
    .png()
    .toBuffer();
// Repair the original upper-body footprint; keep lower-body contact coordinates.
const cleared = await masked(images.empty, 'M926 48 H1468 V703 Q1280 726 1080 704 L926 585Z', 7);
let base = await sharp(images.neutral)
  .composite([{ input: cleared }])
  .png()
  .toBuffer();
const emptyCup = await masked(images.drink, 'M1470 648 H1586 V790 H1470Z', 4);
base = await sharp(base)
  .composite([{ input: emptyCup }])
  .png()
  .toBuffer();
await sharp(base).resize(3840, 2400).png().toFile(join(output, 'base.png'));
const headMask = Buffer.from(
  `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="1180" cy="207" rx="158" ry="188" fill="white"/></svg>`
);
const head = async (image) =>
  sharp(image)
    .composite([{ input: await sharp(headMask).blur(6).png().toBuffer(), blend: 'dest-in' }])
    .png()
    .toBuffer();
const front = await sharp(images.clean)
  .composite([{ input: await head(images.neutral) }])
  .png()
  .toBuffer();
// The generated cutouts supply alpha only. Register that alpha to the original
// painting, retaining the original face and clothing pixels in the runtime.
const registrations = JSON.parse(
  await readFile(join(root, 'artwork/rin-actions-v3/matte-registration.json'), 'utf8')
);
const matte = await sharp(join(root, 'artwork/rin-actions-v3/body-cutout.png'))
  .resize(W, H)
  .ensureAlpha()
  .raw()
  .toBuffer();
const sampleAlpha = (data, matrix, x, y) => {
  const nx = matrix[0][0] * x + matrix[0][1] * y + matrix[0][2],
    ny = matrix[1][0] * x + matrix[1][1] * y + matrix[1][2],
    ix = Math.floor(nx),
    iy = Math.floor(ny),
    fx = nx - ix,
    fy = ny - iy;
  if (ix < 0 || iy < 0 || ix >= W - 1 || iy >= H - 1) return 0;
  const at = (a, b) => data[(b * W + a) * 4 + 3];
  return (
    at(ix, iy) * (1 - fx) * (1 - fy) +
    at(ix + 1, iy) * fx * (1 - fy) +
    at(ix, iy + 1) * (1 - fx) * fy +
    at(ix + 1, iy + 1) * fx * fy
  );
};
const body = await sharp(front).ensureAlpha().raw().toBuffer();
for (let i = 0; i < W * H; i++) {
  const x = i % W,
    y = Math.floor(i / W),
    a = sampleAlpha(matte, registrations.front.matrix, x, y),
    waist = Math.max(0, Math.min(1, (631 - y) / 20));
  body[i * 4 + 3] = Math.round(a * waist);
}
await sharp(body, { raw: { width: W, height: H, channels: 4 } })
  .png()
  .toFile(join(output, 'bodyFront.png'));
const layers = [];
const entries = [
  [
    'upper',
    'neutral',
    [
      [1332, 368],
      [1300, 558],
    ],
  ],
  [
    'hand',
    'neutral',
    [
      [1196, 628],
      [1134, 650],
    ],
  ],
  [
    'farUpper',
    'neutral',
    [
      [1066, 383],
      [1050, 546],
    ],
  ],
  [
    'farHand',
    'wave',
    [
      [1093, 634],
      [1145, 674],
    ],
  ],
  [
    'waveFore',
    'wave',
    [
      [1333, 531],
      [1321, 389],
    ],
  ],
  [
    'waveHand',
    'wave',
    [
      [1321, 389],
      [1343, 323],
    ],
  ],
  [
    'chinFore',
    'chin',
    [
      [1264, 514],
      [1208, 344],
    ],
  ],
  [
    'chinHand',
    'chin',
    [
      [1208, 344],
      [1230, 284],
    ],
  ],
  [
    'drinkFore',
    'drink',
    [
      [1304, 535],
      [1235, 407],
    ],
  ],
  [
    'cupHand',
    'drink',
    [
      [1235, 407],
      [1193, 329],
    ],
  ],
  [
    'typeNear',
    'work',
    [
      [1124, 569],
      [1010, 549],
    ],
  ],
  [
    'typeFar',
    'work',
    [
      [986, 539],
      [938, 539],
    ],
  ],
  ['foreground', 'neutral', null],
  ['cup', 'neutral', null],
];
for (const [name, sourceName, bone] of entries) {
  let bytes = await masked(images[sourceName], paths[name]);
  if (/Hand$|^hand$|^type/.test(name)) {
    const raw = await sharp(bytes).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < raw.length; i += 4) {
      const r = raw[i],
        g = raw[i + 1],
        b = raw[i + 2];
      const skin = Math.min((r - g - 7) / 10, (r - b - 14) / 10, (r - 45) / 20);
      raw[i + 3] *= Math.max(0, Math.min(1, skin));
    }
    bytes = await sharp(raw, { raw: { width: W, height: H, channels: 4 } })
      .png()
      .toBuffer();
  }
  const { info, data } = await sharp(bytes).trim({ threshold: 0 }).toBuffer({ resolveWithObject: true });
  const rect = [-info.trimOffsetLeft, -info.trimOffsetTop, info.width, info.height];
  await writeFile(join(output, name + '.png'), data);
  layers.push({ name, bone, rect });
}
for (const [name, path] of Object.entries({
  blink: 'artwork/rin-scene-v2/blink-edit.png',
  halfBlink: 'artwork/rin-scene-v2/half-blink-edit.png',
  mouth: 'artwork/rin-scene-v2/mouth-edit.png',
}))
  await sharp(join(root, path))
    .resize(512, 512)
    .png()
    .toFile(join(output, name + '.png'));
const rig = validateRig({ format: 1, width: W, height: H, layers });
await writeFile(join(output, 'rig.json'), JSON.stringify(rig) + '\n');
await copyFile(
  join(root, 'prototypes/live2d-codex/assets/stills/female-v2-4k/attention.png'),
  join(output, 'scene.png')
);
await sharp(images.neutral).resize(640, 400).webp({ quality: 88 }).toFile(join(output, 'cover.webp'));
const assets = [];
for (const file of ASSET_FILES) {
  const b = await readFile(join(output, file));
  assets.push({ file, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') });
}
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(
    { format: 3, renderer: 'layered-scene-rig', sourceSize: [3840, 2400], rigSize: [W, H], assets },
    null,
    2
  ) + '\n'
);
if (process.argv.includes('--install')) {
  const destination = join(root, 'prototypes/live2d-codex/assets/scene/rin');
  await mkdir(destination, { recursive: true });
  for (const file of [...ASSET_FILES, 'manifest.json'])
    await copyFile(join(output, file), join(destination, file));
}
console.log(JSON.stringify({ output, assets: assets.length }));
