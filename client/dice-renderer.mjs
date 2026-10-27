import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as CANNON from 'cannon-es';
import {loadDiceAsset,createDieTemplate,convexCollider,disposeDiceObject,percentileParts} from './dice-models.mjs';
import {createHomeDice} from './home-dice.mjs';

// The server owns the result. A fixed-step, seeded rigid-body simulation gives
// every participant the same bounce; the final pose presents that result.
export function seeded(seed) {let value=Number(seed)>>>0;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}

function fallbackGeometry(sides) {
  if(sides===4)return new THREE.TetrahedronGeometry(.65);
  if(sides===6)return new THREE.BoxGeometry(.8,.8,.8);
  if(sides===8)return new THREE.OctahedronGeometry(.6);
  if(sides===12)return new THREE.DodecahedronGeometry(.58);
  return new THREE.IcosahedronGeometry(.58);
}
const fallbackColliders=new Map();
function defaultCollider(sides) {
  if(!fallbackColliders.has(sides)) {
    const geometry=fallbackGeometry(sides),position=geometry.attributes.position,points=[];
    for(let i=0;i<position.count;i++)points.push(new THREE.Vector3().fromBufferAttribute(position,i));
    fallbackColliders.set(sides,convexCollider(points));geometry.dispose();
  }
  return fallbackColliders.get(sides);
}

export function simulateDice(seed,definitions) {
  const random=seeded(seed),world=new CANNON.World({gravity:new CANNON.Vec3(0,-14,0),allowSleep:true});
  world.defaultContactMaterial.friction=.45;world.defaultContactMaterial.restitution=.48;
  const ground=new CANNON.Body({mass:0,shape:new CANNON.Plane()});ground.quaternion.setFromEuler(-Math.PI/2,0,0);world.addBody(ground);
  for(const [x,z]of [[-3.2,0],[3.2,0],[0,-2.1],[0,2.1]]) {
    const wall=new CANNON.Body({mass:0,shape:new CANNON.Plane(),position:new CANNON.Vec3(x,0,z)});
    if(x)wall.quaternion.setFromEuler(0,x<0?Math.PI/2:-Math.PI/2,0);else if(z>0)wall.quaternion.setFromEuler(0,Math.PI,0);
    world.addBody(wall);
  }
  const bodies=definitions.map((definition,index)=>{
    const collider=definition.collider||defaultCollider(definition.sides||20);
    const shape=new CANNON.ConvexPolyhedron({vertices:collider.vertices.map(vertex=>new CANNON.Vec3(...vertex)),faces:collider.faces});
    const body=new CANNON.Body({mass:1,shape,position:new CANNON.Vec3(-1.5+random()+index*1.2,3.5+random(),-.4+random()*.8),linearDamping:.2,angularDamping:.24,sleepSpeedLimit:.15,sleepTimeLimit:.5});
    body.velocity.set(1.5+random()-index,-1,(random()-.5)*2);body.angularVelocity.set(5+random()*8,5+random()*8,4+random()*7);body.quaternion.setFromEuler(random()*6,random()*6,random()*6);world.addBody(body);return body;
  });
  const frames=bodies.map(()=>[]);
  for(let i=0;i<=480;i++){world.step(1/120);bodies.forEach((body,index)=>frames[index].push({position:[body.position.x,body.position.y,body.position.z],quaternion:[body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w]}));}
  return frames;
}
export function physicsFrames(seed,sides=20,collider) {return simulateDice(seed,[{sides,collider}])[0];}

export function createDice(canvas,label) {
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});}catch{return {play:roll=>{label.textContent=description(roll);},destroy(){}};}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setClearColor(0,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.6;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,50);camera.position.set(0,7,9);camera.lookAt(0,.3,0);
  const light=new THREE.DirectionalLight(0xffe0bb,4);light.position.set(-3,8,5);light.castShadow=true;light.shadow.mapSize.set(1024,1024);scene.add(light,new THREE.HemisphereLight(0xd9e8ff,0x4f2222,2.3));
  const fill=new THREE.DirectionalLight(0xef5d4d,2.3);fill.position.set(4,4,-3);scene.add(fill);
  const environment=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),environmentMap=environment.fromScene(room,.04);scene.environment=environmentMap.texture;room.dispose();environment.dispose();
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.ShadowMaterial({opacity:.4}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const templates=new Map(),holders=[new THREE.Group(),new THREE.Group()];holders.forEach(holder=>scene.add(holder));
  let frameId=0,timer=0,destroyed=false,active=false;
  const queue=[],seen=new Set(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const ready=Promise.allSettled([
    loadDiceAsset('d20').then(gltf=>{if(!destroyed)templates.set(20,createDieTemplate(gltf.scene.getObjectByName('GRIMUR_D20')||gltf.scene,20));}),
    loadDiceAsset('set').then(gltf=>{
      if(destroyed)return;
      for(const sides of [4,6,8,10,12,100]){const source=gltf.scene.getObjectByName(`GRIMUR_D${sides}`);if(source)templates.set(sides,createDieTemplate(source,sides));}
      const units=gltf.scene.getObjectByName('GRIMUR_D10');if(units)templates.set('units',createDieTemplate(units,10,{units:true}));
    })
  ]);
  function templateFor(key) {
    if(!templates.has(key)){
      const sides=key==='units'?10:key,mesh=new THREE.Mesh(fallbackGeometry(sides),new THREE.MeshStandardMaterial({color:0x41171e,metalness:.6,roughness:.32}));mesh.name='fallback';
      templates.set(key,createDieTemplate(mesh,sides,{units:key==='units'}));mesh.geometry.dispose();mesh.material.dispose();
    }
    return templates.get(key);
  }
  function render(){const width=canvas.clientWidth||640,height=canvas.clientHeight||400;if(canvas.width!==Math.round(width*renderer.getPixelRatio())||canvas.height!==Math.round(height*renderer.getPixelRatio()))renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();renderer.render(scene,camera);}
  async function next() {
    if(destroyed||!queue.length){active=false;return;}active=true;const roll=queue.shift();await ready;if(destroyed)return;
    const parts=roll.sides===100?percentileParts(roll.value):null;
    const dice=parts?[{template:templateFor(100),value:parts.tens},{template:templateFor('units'),value:parts.units}]:[{template:templateFor(roll.sides),value:roll.value}];
    const simulations=simulateDice(roll.seed??0,dice.map(die=>die.template)),random=seeded(roll.seed??0);
    holders.forEach(holder=>{holder.clear();holder.visible=false;});
    for(const [index,die]of dice.entries()) {
      const holder=holders[index],normal=die.template.normals.get(die.value),last=simulations[index].at(-1);
      holder.add(die.template.object);holder.visible=true;
      die.desired=normal?new THREE.Quaternion().setFromUnitVectors(normal,new THREE.Vector3(0,1,0)):new THREE.Quaternion().fromArray(last.quaternion);
      die.desired.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),random()*Math.PI*2));
      die.height=Math.max(...die.template.points.map(point=>-point.clone().applyQuaternion(die.desired).y))+.006;
      die.finalX=dice.length===2?(index===0?-.8:.8):last.position[0];die.finalZ=dice.length===2?0:last.position[2];
    }
    canvas.classList.add('dice-visible');canvas.dataset.rollId=roll.id;canvas.dataset.result=String(roll.value);canvas.dataset.sides=String(roll.sides);canvas.dataset.model=dice.map(die=>die.template.source).join(',');canvas.dataset.diceCount=String(dice.length);label.textContent=description(roll);
    // Small network delays join the existing timeline instead of starting a new roll.
    const age=Math.max(0,Math.min(1200,Date.now()-Date.parse(roll.createdAt||roll.at||new Date().toISOString()))),start=performance.now()-age;
    function tick(now) {
      if(destroyed)return;
      const elapsed=reduced.matches?4650:now-start,index=Math.min(480,Math.max(0,Math.floor(elapsed/1000*120)));
      for(const [dieIndex,die]of dice.entries()) {
        const holder=holders[dieIndex],frame=simulations[dieIndex][index];holder.position.fromArray(frame.position);holder.quaternion.fromArray(frame.quaternion);
        if(elapsed>3800){const progress=Math.min(1,(elapsed-3800)/650),eased=progress*progress*(3-2*progress);holder.quaternion.slerp(die.desired,eased);holder.position.y=THREE.MathUtils.lerp(holder.position.y,die.height,eased);holder.position.x=THREE.MathUtils.lerp(holder.position.x,die.finalX,eased);holder.position.z=THREE.MathUtils.lerp(holder.position.z,die.finalZ,eased);}
      }
      render();
      if(elapsed<4650)frameId=requestAnimationFrame(tick);
      else timer=setTimeout(()=>{canvas.classList.remove('dice-visible');renderer.clear();next();},1000);
    }
    frameId=requestAnimationFrame(tick);
  }
  return {play(roll){if(!roll?.id||seen.has(roll.id)||destroyed)return;seen.add(roll.id);if(seen.size>1000)seen.delete(seen.values().next().value);queue.push(roll);if(!active)next();},destroy(){destroyed=true;cancelAnimationFrame(frameId);clearTimeout(timer);queue.length=0;holders.forEach(holder=>holder.clear());for(const template of templates.values())disposeDiceObject(template.object);disposeDiceObject(floor);environmentMap.dispose();renderer.dispose();}};
}
function description(roll) {const parts=roll.sides===100?percentileParts(roll.value):null;return `${roll.characterName||roll.player||'Jogador'} · ${roll.label||'Rolagem'} — D${roll.sides}: ${roll.value}${parts?` (${String(parts.tens).padStart(2,'0')} + ${parts.units}${roll.value===100?' = 100':''})`:''} · Bônus: ${roll.modifier>=0?'+':''}${roll.modifier} · Total: ${roll.total}`;}
if(typeof window!=='undefined')window.GrimorioDice={create:createDice,simulate:physicsFrames,createHome:createHomeDice};
