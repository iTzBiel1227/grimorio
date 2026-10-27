import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {physicsFrames} from '../client/dice-renderer.mjs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createDieTemplate,disposeDiceObject,percentileParts} from '../client/dice-models.mjs';
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
test('the supplied collection contains every requested die, with numbered faces and deterministic mesh collisions',async()=>{
  const bytes=readFileSync('public/assets/grimorio-dice-set.glb');
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  for(const sides of [4,6,8,10,12,100]) {
    const source=gltf.scene.getObjectByName('GRIMUR_D'+sides);assert.ok(source,`User model D${sides} is included`);
    const die=createDieTemplate(source,sides,{labels:false}),expected=sides===100?10:sides;
    assert.equal(die.normals.size,expected);assert.ok(die.collider.vertices.length>=4);
    for(const normal of die.normals.values())assert.ok(Math.abs(normal.length()-1)<.00001);
    const frames=physicsFrames(789,sides,die.collider);assert.deepEqual(frames,physicsFrames(789,sides,die.collider));
    assert.ok(frames.every(frame=>frame.position.every(Number.isFinite)&&frame.quaternion.every(Number.isFinite)));
    assert.ok(Math.abs(frames.at(-1).position[0])<3.3);assert.ok(Math.abs(frames.at(-1).position[2])<2.2);
    disposeDiceObject(die.object);
  }
});
test('percentile dice represent every server result, including 00 and 0 as 100',()=>{
  for(let value=1;value<=100;value++){const parts=percentileParts(value);assert.ok(parts.tens>=0&&parts.tens<=90&&parts.tens%10===0);assert.ok(parts.units>=0&&parts.units<=9);assert.equal((parts.tens+parts.units)||100,value);}
  assert.deepEqual(percentileParts(100),{tens:0,units:0});assert.deepEqual(percentileParts(63),{tens:60,units:3});
  for(const value of [0,101,3.4,NaN])assert.throws(()=>percentileParts(value),RangeError);
});
