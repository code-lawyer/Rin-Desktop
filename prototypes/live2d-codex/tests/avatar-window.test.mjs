import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { avatarBounds, avatarScale } = createRequire(import.meta.url)('../backend/avatar-window.cjs');
test('movement uses canonical character dimensions even if a native window reports a larger height', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1152 };
  let reported = { ...avatarBounds(null, area), height: 423 };
  for (let step = 0; step < 64; step++) { const next = avatarBounds({ ...reported, x: reported.x - 2, y: reported.y - 1 }, area, 1); assert.equal(next.width, 300); assert.equal(next.height, 420); reported = { ...next, height: next.height + 1 }; }
});
test('explicit size adjustment has limits and remains reachable on another monitor', () => {
  assert.equal(avatarScale(100), 1.5); assert.equal(avatarScale(.1), .6); assert.equal(avatarScale(NaN), 1);
  const area = { x: -1280, y: -100, width: 1280, height: 720 };
  for (const scale of [.6, 1, 1.5]) { const b = avatarBounds({ x: 9000, y: -9000 }, area, scale); assert.ok(b.x >= area.x && b.x + b.width <= area.x + area.width); assert.ok(b.y >= area.y && b.y + b.height <= area.y + area.height); }
  const small = avatarBounds(null, { x: 0, y: 0, width: 320, height: 300 }, 1.5); assert.ok(small.height <= 284 && small.width <= 304);
});
