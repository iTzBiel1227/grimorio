import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadDiceAsset,createDieTemplate,disposeDiceObject} from './dice-models.mjs';

export function createHomeDice(canvas) {
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});}catch{canvas.dataset.state='unavailable';return {destroy(){}};}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setClearColor(0,0);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=2.2;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(44,1,.1,30);camera.position.set(0,0,4);
  const key=new THREE.DirectionalLight(0xe9d3bd,5.4);key.position.set(-3,4,5);
  const red=new THREE.DirectionalLight(0xfb3646,5);red.position.set(4,-1,3);
  scene.add(key,red,new THREE.HemisphereLight(0xd9e5ff,0x3c0815,2));
  const generator=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=generator.fromScene(room,.04);scene.environment=environment.texture;room.dispose();generator.dispose();
  const holder=new THREE.Group();scene.add(holder);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,destroyed=false,loaded=false,lost=false,progress=0,target=0,lastTime=0,template=null,width=1,height=1;
  function measure() {
    width=canvas.clientWidth||1;height=canvas.clientHeight||1;
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    readScroll();schedule();
  }
  function readScroll() {
    target=reduced.matches?0:Math.min(1,Math.max(0,window.scrollY/Math.max(1,document.documentElement.scrollHeight-window.innerHeight)));
    schedule();
  }
  function render(now) {
    frame=0;if(destroyed||!loaded||lost||document.hidden)return;
    const elapsed=lastTime?Math.min(80,now-lastTime):16;lastTime=now;
    progress=reduced.matches?0:progress+(target-progress)*(1-Math.exp(-elapsed/130));
    if(Math.abs(target-progress)<.00008)progress=target;
    const mobile=width<650,scale=mobile?2.4:2.7;
    holder.scale.setScalar(scale);
    holder.rotation.set(-.28+progress*Math.PI*1.2,-.52+progress*Math.PI*2.4,-.2+Math.sin(progress*Math.PI)*.45);
    holder.position.set(mobile?.22:(.84-progress*.43)*Math.min(1.3,camera.aspect),mobile?-.32:Math.sin(progress*Math.PI*2)*.18,0);
    renderer.render(scene,camera);canvas.dataset.progress=progress.toFixed(4);canvas.dataset.idle=String(progress===target);
    if(progress!==target)frame=requestAnimationFrame(render);else lastTime=0;
  }
  function schedule(){if(!frame&&!destroyed&&loaded&&!lost&&!document.hidden)frame=requestAnimationFrame(render);}
  function visibility(){if(document.hidden){cancelAnimationFrame(frame);frame=0;lastTime=0;}else measure();}
  function preference(){progress=target=reduced.matches?0:progress;readScroll();schedule();}
  function contextLost(event){event.preventDefault();lost=true;cancelAnimationFrame(frame);frame=0;canvas.dataset.state='unavailable';document.documentElement.classList.remove('home-3d-ready');}
  function contextRestored(){lost=false;canvas.dataset.state='ready';document.documentElement.classList.add('home-3d-ready');measure();}
  const resize=new ResizeObserver(measure);resize.observe(canvas);
  window.addEventListener('scroll',readScroll,{passive:true});window.addEventListener('resize',measure,{passive:true});document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',preference);
  canvas.addEventListener('webglcontextlost',contextLost);canvas.addEventListener('webglcontextrestored',contextRestored);
  loadDiceAsset('d20').then(gltf=>{
    if(destroyed)return;template=createDieTemplate(gltf.scene.getObjectByName('GRIMUR_D20')||gltf.scene,20);holder.add(template.object);loaded=true;canvas.dataset.state='ready';document.documentElement.classList.add('home-3d-ready');measure();
  }).catch(()=>{canvas.dataset.state='unavailable';});
  return {destroy(){if(destroyed)return;destroyed=true;cancelAnimationFrame(frame);resize.disconnect();window.removeEventListener('scroll',readScroll);window.removeEventListener('resize',measure);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',preference);canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',contextRestored);if(template)disposeDiceObject(template.object);environment.dispose();renderer.dispose();document.documentElement.classList.remove('home-3d-ready');}};
}
