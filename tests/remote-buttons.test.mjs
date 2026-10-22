import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RemoteButtonState} from '../tools/remote-diagnostics/button-state.mjs';
const edge=(key,direction,generation=1,source='rc003')=>({key,edge:direction,generation,source});

test('observed long voice hold produces one press/release despite 168 key-downs',()=>{
  const buttons=new RemoteButtonState(1);
  const input=[...Array.from({length:168},()=>edge('F5','down')),edge('F5','up')];
  assert.deepEqual(input.map(event=>buttons.accept(event)).filter(Boolean),[
    {button:'voice',phase:'press',generation:1},{button:'voice',phase:'release',generation:1}
  ]);
  assert.equal(buttons.suppressed,167);
});
test('a computer keyboard or a stale connection cannot trigger remote actions',()=>{
  const buttons=new RemoteButtonState(2);
  assert.equal(buttons.accept(edge('F5','down',2,'keyboard')),null);
  assert.equal(buttons.accept(edge('F5','down',1)),null);
  assert.equal(buttons.held.size,0);
});
test('disconnect cancels a held voice button and ignores the old release',()=>{
  const buttons=new RemoteButtonState(1);buttons.accept(edge('F5','down'));
  assert.deepEqual(buttons.disconnect(2),[{button:'voice',phase:'cancel',generation:1}]);
  assert.equal(buttons.accept(edge('F5','up',1)),null);
  assert.deepEqual(buttons.accept(edge('F5','down',2)),{button:'voice',phase:'press',generation:2});
});
test('an orphan release or unknown key cannot create a button press',()=>{
  const buttons=new RemoteButtonState(1);
  assert.equal(buttons.accept(edge('Return','up')),null);
  assert.equal(buttons.accept(edge('F12','down')),null);
  assert.equal(buttons.held.size,0);
});
test('each real confirm click stays distinct, while held repeats are discarded',()=>{
  const buttons=new RemoteButtonState(1);const output=[];
  for(let i=0;i<3;i++)for(const event of [edge('Return','down'),edge('Return','down'),edge('Return','up')]){
    const action=buttons.accept(event);if(action)output.push(action);
  }
  assert.equal(output.filter(event=>event.phase==='press'&&event.button==='confirm').length,3);
  assert.equal(buttons.suppressed,3);
});
