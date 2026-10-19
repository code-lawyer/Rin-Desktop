import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { wallpaperState } = createRequire(import.meta.url)('../backend/wallpaper-state.cjs');
test('opening a quiet conversation stops typing and looks at the user', () => {
  assert.deepEqual(wallpaperState({status:'idle'}, {chatVisible:true}), {pose:'attention',typing:false,paused:false});
  assert.equal(wallpaperState({status:'idle'}, {chatVisible:false}).typing, true);
});
test('active work takes precedence over the open bubble', () => {
  for (const status of ['starting','working','stopping']) assert.equal(wallpaperState({status}, {chatVisible:true}).pose,'typing');
});
test('confirmation and error states stop typing even with a hidden bubble', () => {
  for (const status of ['waiting','error']) assert.equal(wallpaperState({status}, {chatVisible:false}).typing,false);
  assert.equal(wallpaperState({status:'working',connection:'error'}).pose,'attention');
});
test('pausing the renderer preserves the current conversational pose', () => {
  assert.deepEqual(wallpaperState({status:'working'}, {paused:true,chatVisible:true}), {pose:'typing',typing:true,paused:true});
});
