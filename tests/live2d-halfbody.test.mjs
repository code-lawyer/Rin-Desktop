import test from 'node:test';
import assert from 'node:assert/strict';
import { blinkOpen, speechOpening, HairSpring, approach } from '../prototypes/live2d-halfbody/motion.mjs';

test('blink fully closes and reopens without leaving its parameter range',()=>{
  assert.equal(blinkOpen(-1),1);assert.equal(blinkOpen(.1),0);assert.equal(blinkOpen(.25),1);
  for(let t=0;t<.3;t+=.001)assert.ok(blinkOpen(t)>=0&&blinkOpen(t)<=1);
});
test('mouth follows speech energy and rejects silence/background noise',()=>{
  assert.equal(speechOpening(new Float32Array(1024)),0);
  assert.equal(speechOpening(new Float32Array(1024).fill(.008)),0);
  const quiet=speechOpening(new Float32Array(1024).fill(.035));
  const loud=speechOpening(new Float32Array(1024).fill(.2));
  assert.ok(quiet>0&&quiet<loud);assert.ok(loud<=1);
  assert.equal(speechOpening([]),0);
});
test('hair spring stays bounded after a head impulse and settles when wind stops',()=>{
  const spring=new HairSpring();
  for(let i=0;i<90;i++)assert.ok(Math.abs(spring.update(.8,1/60))<=1);
  assert.ok(spring.value>.5);
  for(let i=0;i<600;i++)spring.update(0,1/60);
  assert.ok(Math.abs(spring.value)<.0001&&Math.abs(spring.velocity)<.0001);
  assert.ok(Number.isFinite(spring.update(1,30)));
});
test('smoothing is independent of ordinary frame subdivision',()=>{
  const whole=approach(0,1,.1,.2);
  const halves=approach(approach(0,1,.05,.2),1,.05,.2);
  assert.ok(Math.abs(whole-halves)<1e-10);
});
