import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PoseDissolve } from '../prototypes/live2d-codex/renderer/pose-dissolve.mjs';
import { POSE_IDS, validatePoses } from '../prototypes/live2d-codex/renderer/pose-assets.mjs';

function settle(motion) {
  const frames = [];
  for (let i = 0; i < 180; i++) {
    const frame = motion.step(1 / 60);
    frames.push(frame);
    assert.ok(frame.opacity >= 0 && frame.opacity <= 1);
    if (frame.phase === 'steady') return frames;
  }
  assert.fail('a pose switch must settle within 3 seconds of active rendering');
}

test('every pair switches invisibly and uses the selected 2.8-second pixel transition', () => {
  for (const from of POSE_IDS)
    for (const to of POSE_IDS) {
      const motion = new PoseDissolve(from);
      motion.request(to);
      const frames = settle(motion);
      let previous = from;
      for (const frame of frames) {
        if (frame.pose !== previous) assert.equal(frame.opacity, 0, `${from} → ${to} must not flash`);
        previous = frame.pose;
      }
      assert.equal(frames.at(-1).pose, to);
      assert.equal(frames.at(-1).opacity, 1);
      assert.ok(frames.every((frame) => frame.effect === 'pixels'));
      assert.ok(frames.length / 60 <= 2.84);
      if (from !== to) {
        assert.ok(frames.length / 60 >= 2.79);
        assert.ok(frames.filter((frame) => frame.phase === 'hold').length >= 5);
      }
      if (from === to) assert.equal(frames.length, 1, 'same-pose request never fades');
    }
});

test('wake interrupts a requested resting pose without finishing a cup or arm sequence', () => {
  const motion = new PoseDissolve('cup');
  motion.request('window');
  motion.step(0.08);
  motion.request('thinking');
  motion.step(0.05);
  motion.request('attention');
  const frames = settle(motion);
  assert.ok(
    frames.every((frame) => ['cup', 'attention'].includes(frame.pose)),
    'obsolete requests are coalesced',
  );
  assert.equal(frames.at(-1).pose, 'attention');
});

test('changing the target during fade-in fades the current painting back out without a jump', () => {
  const motion = new PoseDissolve('work');
  motion.request('cup');
  while (motion.snapshot().phase !== 'in') motion.step(0.05);
  motion.step(0.08);
  const before = motion.snapshot();
  motion.request('attention');
  assert.equal(motion.snapshot().opacity, before.opacity);
  const frames = settle(motion);
  assert.ok(frames[0].opacity < before.opacity);
  assert.equal(frames.find((frame) => frame.pose === 'attention').opacity, 0);
  assert.equal(frames.at(-1).pose, 'attention');
});

test('returning to the current painting reverses fading smoothly; zero-time steps freeze', () => {
  const motion = new PoseDissolve('cup');
  motion.request('attention');
  motion.step(0.08);
  const faded = motion.snapshot();
  motion.request('cup');
  assert.equal(motion.snapshot().opacity, faded.opacity);
  const frozen = motion.snapshot();
  for (const dt of [0, -1, NaN, Infinity]) assert.deepEqual(motion.step(dt), frozen);
  assert.ok(motion.step(0.03).opacity > faded.opacity);
  assert.ok(settle(motion).every((frame) => frame.pose === 'cup'));
});

test('reduced motion selects the latest whole pose immediately and subsequent switches remain valid', () => {
  const motion = new PoseDissolve('work');
  motion.request('cup');
  motion.step(0.05);
  motion.request('window');
  const reduced = motion.step(0, { reduced: true });
  assert.deepEqual([reduced.pose, reduced.opacity, reduced.phase], ['window', 1, 'steady']);
  motion.request('attention');
  assert.equal(settle(motion).at(-1).pose, 'attention');
});

test('requests in the empty gap coalesce without restarting it or showing an obsolete pose', () => {
  const motion = new PoseDissolve('cup');
  motion.request('work');
  for (let i = 0; i < 66; i++) motion.step(1 / 60);
  assert.equal(motion.snapshot().phase, 'hold');
  motion.step(0.04);
  motion.request('thinking');
  motion.request('attention');
  assert.equal(motion.snapshot().opacity, 0);
  motion.step(0.07);
  assert.equal(motion.snapshot().phase, 'in');
  assert.ok(settle(motion).every((frame) => frame.pose === 'attention'));
});

test('30fps and 60fps use the same duration and a suspended clock cannot skip the transition', () => {
  for (const fps of [30, 60]) {
    const motion = new PoseDissolve('work');
    motion.request('cup');
    for (let i = 0; i < Math.round(2.8 * fps); i++) motion.step(1 / fps);
    assert.equal(motion.snapshot().phase, 'steady');
    assert.equal(motion.snapshot().pose, 'cup');
  }
  const motion = new PoseDissolve('work');
  motion.request('attention');
  const frame = motion.step(120);
  assert.equal(frame.pose, 'work');
  assert.equal(frame.phase, 'out');
  assert.ok(frame.opacity > 0.9);
});

test('unknown poses and invalid facial regions are rejected before creating textures', async () => {
  assert.throws(() => new PoseDissolve('../other'));
  assert.throws(() => new PoseDissolve('work', { fadeOut: 0 }));
  assert.throws(() => new PoseDissolve('work', { hold: -1 }));
  assert.throws(() => new PoseDissolve().request('nod'));
  const source = JSON.parse(
    await readFile(
      new URL('../prototypes/live2d-codex/assets/scene/rin-poses/poses.json', import.meta.url),
      'utf8',
    ),
  );
  validatePoses(source);
  for (const change of [
    (value) => (value.poses[0] = null),
    (value) => (value.poses[1] = value.poses[0]),
    (value) => (value.poses[0].face[0] = 2000),
    (value) => (value.poses[0].eyes[0][2] = 0),
    (value) => (value.poses[0].mouth[0] = -1),
    (value) => (value.poses[0].mouth[3] = Infinity),
    (value) => (value.poses[1].mouth = [0, 0, 1, 1, 0]),
  ]) {
    const value = structuredClone(source);
    change(value);
    assert.throws(() => validatePoses(value), /配置无效/);
  }
});
