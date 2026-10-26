import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {physicsFrames} from '../client/dice-renderer.mjs';
const context={window:{}};vm.runInNewContext(readFileSync('public/sheet-tools.js','utf8'),context);
const {merge,damage}=context.window.GrimorioSheetTools;
test('concurrent character edits merge different fields and preserve conflicting local drafts',()=>{
  const base={name:'Mage',resources:{hp:10,mp:8},abilities:[]};
  const result=merge(base,{...base,resources:{hp:9,mp:8}},{...base,name:'Aria'});
  assert.equal(result.value.name,'Aria');assert.equal(result.value.resources.hp,9);assert.equal(result.conflicts.length,0);
  const conflict=merge(base,{...base,resources:{hp:6,mp:8}},{...base,resources:{hp:9,mp:8}});
  assert.equal(conflict.value.resources.hp,6);assert.deepEqual(Array.from(conflict.conflicts),['resources.hp']);
});
test('damage notation supports modifiers and rejects unbounded or non-dice expressions',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(damage('2d6 + 3'))),{count:2,sides:6,modifier:3});
  for(const expression of ['100d20','d3','Math.random()','21d6'])assert.equal(damage(expression),null);
});
test('custom dice physics is deterministic, bounces on the table and finishes inside its bounds',()=>{
  const frames=physicsFrames(12345);assert.deepEqual(frames,physicsFrames(12345));assert.notDeepEqual(frames,physicsFrames(54321));
  assert.ok(frames.some((frame,index)=>index>0&&frame.position[1]>frames[index-1].position[1]),'The falling die bounces');
  assert.ok(frames.every(frame=>frame.position.every(Number.isFinite)&&frame.quaternion.every(Number.isFinite)));
  assert.ok(Math.abs(frames.at(-1).position[0])<3.3);assert.ok(frames.at(-1).position[1]>.1&&frames.at(-1).position[1]<1);
});
