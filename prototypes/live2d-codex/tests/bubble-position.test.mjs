import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { bubbleLayout } = createRequire(import.meta.url)('../backend/bubble-layout.cjs');
const avatar = {x:1500,y:600,width:300,height:420}, area = {x:0,y:0,width:1920,height:1152};
test('a detached bubble keeps its chosen position across content and avatar changes', () => {
  const position = {x:125,y:96};
  for (const height of [220,550,900,220]) {
    const result = bubbleLayout({...avatar,x:450},area,{width:440,height},null,position);
    assert.equal(result.x,125); assert.equal(result.y,96); assert.equal(result.detached,true);
  }
  assert.equal(bubbleLayout(avatar,area,{},null,null).detached,false);
});
test('dragging and restoring on a smaller monitor keeps the whole bubble reachable', () => {
  const screen = {x:-1280,y:0,width:1280,height:720};
  const result = bubbleLayout(avatar,screen,{width:440,height:10000},null,{x:3000,y:4000});
  assert.ok(result.x >= screen.x && result.x + result.width <= screen.x + screen.width);
  assert.ok(result.y >= screen.y && result.y + result.height <= screen.y + screen.height);
  assert.equal(result.overflowing,true);
});
