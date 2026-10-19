import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { currentReply } from '../renderer/current-reply.mjs';
import { measureAvatarAnchor } from '../renderer/avatar-anchor.mjs';
const { bubbleLayout } = createRequire(import.meta.url)('../backend/bubble-layout.cjs');

test('a newly submitted task clears the previous reply without removing conversation history', () => {
  const messages = [{ id: 'u1', role: 'user', turnId: 't1', text: 'first' }, { id: 'a1', role: 'assistant', turnId: 't1', text: 'old reply' }, { id: 'local-u2', role: 'user', turnId: null, text: 'follow up' }];
  assert.equal(currentReply(messages).text, ''); assert.equal(messages.length, 3);
  messages.push({ id: 'a2', role: 'assistant', turnId: 't2', text: 'new reply', complete: false });
  assert.equal(currentReply(messages).text, 'new reply'); assert.equal(currentReply(messages).complete, false);
});
test('final response replaces tool commentary and full long responses are preserved', () => {
  const full = '完整回复'.repeat(80_000);
  const messages = [{ id: 'u', role: 'user', turnId: 't' }, { id: 'progress', role: 'assistant', turnId: 't', text: 'processing', phase: 'commentary' }, { id: 'final', role: 'assistant', turnId: 't', text: full, phase: 'final_answer', complete: true }];
  assert.equal(currentReply(messages).text, full); assert.equal(currentReply(messages).messageId, 'final');
});
test('restored history displays only its latest turn and ignores a late earlier-turn item', () => {
  const messages = [{ id: 'u1', role: 'user', turnId: 't1' }, { id: 'a1', role: 'assistant', turnId: 't1', text: 'old' }, { id: 'u2', role: 'user', turnId: 't2' }, { id: 'a2', role: 'assistant', turnId: 't2', text: 'current' }, { id: 'late', role: 'assistant', turnId: 't1', text: 'old late' }];
  assert.equal(currentReply(messages).text, 'current');
});
test('bubble is placed at the head and flips its tail near the left screen edge', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const right = bubbleLayout({ x: 1600, y: 500, width: 300, height: 475 }, area, { width: 440, height: 220 });
  const left = bubbleLayout({ x: 0, y: 500, width: 300, height: 475 }, area, { width: 440, height: 220 });
  assert.equal(right.side, 'right'); assert.equal(left.side, 'left');
  assert.ok(right.x + right.width < 1600 + 150); assert.ok(left.x > 150);
  assert.ok(Math.abs(right.y + right.tailY - 595) < 2);
});
test('content expands to the work area and flags overflow for full-screen reading', () => {
  const area = { x: 0, y: 40, width: 1280, height: 680 };
  const bubble = bubbleLayout({ x: 950, y: 200, width: 300, height: 475 }, area, { width: 560, height: 6000 });
  assert.equal(bubble.overflowing, true); assert.ok(bubble.y >= area.y); assert.ok(bubble.y + bubble.height <= area.y + area.height);
});
test('negative monitor coordinates and top/bottom corners remain inside their monitor', () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1080 };
  for (const avatar of [{ x: -1920, y: -200, width: 300, height: 475 }, { x: -300, y: 700, width: 300, height: 475 }]) {
    const b = bubbleLayout(avatar, area, { width: 440, height: 450 });
    assert.ok(b.x >= area.x && b.x + b.width <= area.x + area.width);
    assert.ok(b.y >= area.y && b.y + b.height <= area.y + area.height);
    assert.ok(b.tailY >= 42 && b.tailY <= b.height - 42);
  }
});
test('head anchor excludes transparent canvas padding and lower-body width', () => {
  const width = 100, height = 200, pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 20; y <= 190; y++) for (let x = 30; x <= 70; x++) pixels[(y * width + x) * 4 + 3] = 255;
  for (let y = 100; y <= 160; y++) for (let x = 10; x <= 90; x++) pixels[(y * width + x) * 4 + 3] = 255;
  const view = { windowWidth: 300, windowHeight: 475, canvasWidth: 280, canvasHeight: 419, canvasLeft: 10, canvasTop: 6 };
  const anchor = measureAvatarAnchor(pixels, width, height, view);
  assert.equal(anchor.x, .5);
  assert.equal(anchor.left, (10 + .3 * 280) / 300);
  assert.equal(anchor.right, (10 + .7 * 280) / 300);
  assert.equal(anchor.y, (6 + (20 + 170 * .12) / 200 * 419) / 475);
  const zoomedView = Object.fromEntries(Object.entries(view).map(([key, value]) => [key, value / 1.25]));
  const zoomed = measureAvatarAnchor(pixels, width, height, zoomedView);
  for (const key of ['x', 'y', 'left', 'right']) assert.ok(Math.abs(anchor[key] - zoomed[key]) < 1e-12);
  assert.equal(measureAvatarAnchor(new Uint8ClampedArray(pixels.length), width, height, view), null);
});
test('bubble tail targets the rendered head instead of a fixed fraction of window height', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1080 };
  const avatar = { x: -500, y: 480, width: 300, height: 475 };
  const anchor = { x: .5, y: .13, left: .34, right: .66 };
  for (const height of [220, 800]) {
    const bubble = bubbleLayout(avatar, area, { width: 440, height }, anchor);
    assert.ok(Math.abs(bubble.y + bubble.tailY - (avatar.y + avatar.height * anchor.y)) < 1);
    assert.ok(Math.abs(bubble.x + bubble.width - (avatar.x + avatar.width * anchor.left - 12)) < 1);
  }
});
