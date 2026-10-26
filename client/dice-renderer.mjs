import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as CANNON from 'cannon-es';

// The server owns the result. A fixed-step, seeded rigid-body simulation gives
// every participant the same bounce; the final pose presents that result.
export function seeded(seed) { let value=Number(seed)>>>0;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;}; }
export function physicsFrames(seed) {
  const random=seeded(seed),world=new CANNON.World({gravity:new CANNON.Vec3(0,-14,0),allowSleep:true});
  world.defaultContactMaterial.friction=.45;world.defaultContactMaterial.restitution=.48;
  const ground=new CANNON.Body({mass:0,shape:new CANNON.Plane()});ground.quaternion.setFromEuler(-Math.PI/2,0,0);world.addBody(ground);
  for(const [x,z,rx,rz]of [[-3.2,0,0,-Math.PI/2],[3.2,0,0,Math.PI/2],[0,-2.1,-Math.PI/2,0],[0,2.1,Math.PI/2,0]]) {
    const wall=new CANNON.Body({mass:0,shape:new CANNON.Plane(),position:new CANNON.Vec3(x,0,z)});
    if(x)wall.quaternion.setFromEuler(0,x<0?Math.PI/2:-Math.PI/2,0);else if(z>0)wall.quaternion.setFromEuler(0,Math.PI,0);
    world.addBody(wall);
  }
  const geometry=new THREE.IcosahedronGeometry(.58,0),positions=geometry.attributes.position,vertices=[],faces=[],lookup=new Map();
  for(let i=0;i<positions.count;i+=3){const face=[];for(let j=0;j<3;j++){const point=new THREE.Vector3().fromBufferAttribute(positions,i+j),key=point.toArray().map(v=>v.toFixed(5)).join(',');if(!lookup.has(key)){lookup.set(key,vertices.length);vertices.push(new CANNON.Vec3(point.x,point.y,point.z));}face.push(lookup.get(key));}faces.push(face);}
  geometry.dispose();
  const body=new CANNON.Body({mass:1,shape:new CANNON.ConvexPolyhedron({vertices,faces}),position:new CANNON.Vec3(-1.5+random(),3.5+random(),-.4+random()*.8),linearDamping:.2,angularDamping:.24,sleepSpeedLimit:.15,sleepTimeLimit:.5});
  body.velocity.set(1.5+random(),-1,(random()-.5)*2);body.angularVelocity.set(5+random()*8,5+random()*8,4+random()*7);body.quaternion.setFromEuler(random()*6,random()*6,random()*6);world.addBody(body);
  const frames=[];
  for(let i=0;i<=480;i++){world.step(1/120);frames.push({position:[body.position.x,body.position.y,body.position.z],quaternion:[body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w]});}
  return frames;
}
let modelPromise;
function loadModel(){return modelPromise??=new GLTFLoader().loadAsync('/assets/grimorio-d20.glb');}
export function createDice(canvas,label){
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});}catch{return {play:roll=>{label.textContent=description(roll);},destroy(){}};}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setClearColor(0,0);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.6;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,50);camera.position.set(0,7,9);camera.lookAt(0,.3,0);
  const light=new THREE.DirectionalLight(0xffe0bb,4);light.position.set(-3,8,5);light.castShadow=true;light.shadow.mapSize.set(1024,1024);scene.add(light,new THREE.HemisphereLight(0xd9e8ff,0x4f2222,2.3));
  const fill=new THREE.DirectionalLight(0xef5d4d,2.3);fill.position.set(4,4,-3);scene.add(fill);
  const environment=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),environmentMap=environment.fromScene(room,.04);scene.environment=environmentMap.texture;room.dispose();environment.dispose();
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.ShadowMaterial({opacity:.4}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const holder=new THREE.Group();scene.add(holder);
  let custom=null,normals=new Map(),frameId=0,timer=0,destroyed=false,active=false;
  const queue=[],seen=new Set(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const fallback=new THREE.Mesh(new THREE.IcosahedronGeometry(.58,0),new THREE.MeshStandardMaterial({color:0x41171e,metalness:.6,roughness:.32}));fallback.castShadow=true;holder.add(fallback);
  const ready=loadModel().then(gltf=>{
    if(destroyed)return;
    const model=gltf.scene.clone(true);model.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),scale=1.16/Math.max(size.x,size.y,size.z);
    model.traverse(object=>{if(object.isMesh){object.castShadow=true;object.material=object.material.clone();if(object.name.startsWith('GRIMUR_Number')){object.material.emissive=new THREE.Color(0x6b080a);object.material.emissiveIntensity=.65;const number=Number(object.name.match(/\d+$/)?.[0]);const normal=new THREE.Vector3(0,0,1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion())).normalize();const point=new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()).sub(center);if(normal.dot(point)<0)normal.negate();normals.set(number,normal);}}});
    model.position.sub(center);const normalized=new THREE.Group();normalized.scale.setScalar(scale);normalized.add(model);custom=normalized;custom.visible=false;holder.add(custom);
  }).catch(()=>{label.dataset.model='fallback';});
  function render(){const width=canvas.clientWidth||640,height=canvas.clientHeight||400;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();renderer.render(scene,camera);}
  async function next(){
    if(destroyed||!queue.length){active=false;return;}active=true;const roll=queue.shift();await ready;if(destroyed)return;
    const frames=physicsFrames(roll.seed??0),random=seeded(roll.seed??0),last=frames.at(-1),lastQuaternion=new THREE.Quaternion().fromArray(last.quaternion);
    const desired=roll.sides===20&&normals.get(roll.value)?new THREE.Quaternion().setFromUnitVectors(normals.get(roll.value),new THREE.Vector3(0,1,0)):lastQuaternion.clone();
    desired.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),random()*Math.PI*2));
    if(custom)custom.visible=roll.sides===20;fallback.visible=!custom||roll.sides!==20;
    fallback.geometry.dispose();fallback.geometry=roll.sides===4?new THREE.TetrahedronGeometry(.65):roll.sides===6?new THREE.BoxGeometry(.8,.8,.8):roll.sides===8?new THREE.OctahedronGeometry(.6):roll.sides===12?new THREE.DodecahedronGeometry(.58):new THREE.IcosahedronGeometry(.58);
    canvas.classList.add('dice-visible');canvas.dataset.rollId=roll.id;canvas.dataset.result=String(roll.value);label.textContent=description(roll);
    // Small network delays join the existing timeline instead of starting a new roll.
    const age=Math.max(0,Math.min(1200,Date.now()-Date.parse(roll.createdAt||roll.at||new Date().toISOString()))),start=performance.now()-age;
    function tick(now){
      if(destroyed)return;
      const elapsed=reduced.matches?4650:now-start,index=Math.min(480,Math.floor(elapsed/1000*120)),frame=frames[index];
      holder.position.fromArray(frame.position);holder.quaternion.fromArray(frame.quaternion);
      if(elapsed>3800){const progress=Math.min(1,(elapsed-3800)/650),eased=progress*progress*(3-2*progress);holder.quaternion.slerp(desired,eased);holder.position.y=THREE.MathUtils.lerp(holder.position.y,.47,eased);}
      render();
      if(elapsed<4650)frameId=requestAnimationFrame(tick);
      else timer=setTimeout(()=>{canvas.classList.remove('dice-visible');renderer.clear();next();},1000);
    }
    frameId=requestAnimationFrame(tick);
  }
  return {play(roll){if(!roll?.id||seen.has(roll.id)||destroyed)return;seen.add(roll.id);if(seen.size>1000)seen.delete(seen.values().next().value);queue.push(roll);if(!active)next();},destroy(){destroyed=true;cancelAnimationFrame(frameId);clearTimeout(timer);queue.length=0;scene.traverse(object=>{object.geometry?.dispose();if(object.material&&!Array.isArray(object.material))object.material.dispose();});environmentMap.dispose();renderer.dispose();}};
}
function description(roll){return `${roll.characterName||roll.player||'Jogador'} · ${roll.label||'Rolagem'} — D${roll.sides}: ${roll.value} · Bônus: ${roll.modifier>=0?'+':''}${roll.modifier} · Total: ${roll.total}`;}
if(typeof window!=='undefined')window.GrimorioDice={create:createDice,simulate:physicsFrames};
