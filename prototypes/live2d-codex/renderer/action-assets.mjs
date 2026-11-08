export const RIG_SIZE = Object.freeze([1586, 992]);
export const SCENE_SIZE = Object.freeze([3840, 2400]);
export const LAYER_NAMES = Object.freeze([
  'upper',
  'hand',
  'farUpper',
  'farHand',
  'waveFore',
  'waveHand',
  'chinFore',
  'chinHand',
  'drinkFore',
  'cupHand',
  'typeNear',
  'typeFar',
  'foreground',
  'cup',
]);
export const ASSET_FILES = Object.freeze([
  'scene.png',
  'cover.webp',
  'base.png',
  'bodyFront.png',
  'blink.png',
  'halfBlink.png',
  'mouth.png',
  'rig.json',
  ...LAYER_NAMES.map((name) => name + '.png'),
]);

// Validate local authoring data before it can allocate buffers or drive a mesh.
export function validateRig(rig) {
  const fail = () => {
    throw new Error('角色动作配置无效。');
  };
  if (
    !rig ||
    rig.format !== 1 ||
    rig.width !== RIG_SIZE[0] ||
    rig.height !== RIG_SIZE[1] ||
    !Array.isArray(rig.layers) ||
    rig.layers.length !== LAYER_NAMES.length
  )
    fail();
  const seen = new Set();
  for (const layer of rig.layers) {
    if (!layer || !LAYER_NAMES.includes(layer.name) || seen.has(layer.name)) fail();
    seen.add(layer.name);
    const r = layer.rect;
    if (
      !Array.isArray(r) ||
      r.length !== 4 ||
      !r.every(Number.isSafeInteger) ||
      r[0] < 0 ||
      r[1] < 0 ||
      r[2] < 1 ||
      r[3] < 1 ||
      r[0] + r[2] > RIG_SIZE[0] ||
      r[1] + r[3] > RIG_SIZE[1]
    )
      fail();
    if (['cup', 'foreground'].includes(layer.name)) {
      if (layer.bone !== null) fail();
    } else {
      const b = layer.bone;
      if (
        !Array.isArray(b) ||
        b.length !== 2 ||
        b.some(
          (p) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            p.some((v, axis) => !Number.isFinite(v) || v < 0 || v > RIG_SIZE[axis])
        ) ||
        Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]) < 1
      )
        fail();
    }
  }
  return rig;
}

export function textureLayers(rig) {
  validateRig(rig);
  return [
    { name: 'base', rect: [0, 0, ...RIG_SIZE], size: SCENE_SIZE },
    { name: 'bodyFront', rect: [0, 0, ...RIG_SIZE], size: RIG_SIZE },
    ...['blink', 'halfBlink', 'mouth'].map((name) => ({ name, rect: [0, 0, 512, 512], size: [512, 512] })),
    ...rig.layers.map((layer) => ({ ...layer, size: layer.rect.slice(2) })),
  ];
}
