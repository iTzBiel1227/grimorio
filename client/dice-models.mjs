import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';

const promises=new Map();
export function loadDiceAsset(kind='d20') {
  const url=kind==='d20'?'/assets/grimorio-d20.glb':'/assets/grimorio-dice-set.glb';
  if(!promises.has(url)) promises.set(url,new GLTFLoader().loadAsync(url).catch(error=>{promises.delete(url);throw error;}));
  return promises.get(url);
}

export function geometryFaces(geometry) {
  const position=geometry.attributes.position,index=geometry.index,faces=[];
  const count=index?.count??position.count;
  for(let i=0;i<count;i+=3) {
    const points=[0,1,2].map(offset=>new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i+offset):i+offset));
    const normal=new THREE.Vector3().crossVectors(points[1].clone().sub(points[0]),points[2].clone().sub(points[0]));
    const area=normal.length()/2;if(area<1e-10)continue;normal.normalize();
    const center=points[0].clone().add(points[1]).add(points[2]).divideScalar(3),distance=normal.dot(center);
    let face=faces.find(item=>item.normal.dot(normal)>.99999&&Math.abs(item.distance-distance)<.0001);
    if(!face){face={normal,distance,area:0,center:new THREE.Vector3(),points:[]};faces.push(face);}
    face.area+=area;face.center.addScaledVector(center,area);face.points.push(...points);
  }
  for(const face of faces)face.center.divideScalar(face.area);
  return faces.sort((a,b)=>b.area-a.area);
}

export function convexCollider(points) {
  const geometry=new ConvexGeometry(points),faces=geometryFaces(geometry),vertices=[],lookup=new Map();
  const polygons=faces.map(face=>{
    const unique=new Map(face.points.map(point=>[point.toArray().map(value=>value.toFixed(5)).join(','),point]));
    const axis=new THREE.Vector3().subVectors(unique.values().next().value,face.center).normalize(),second=new THREE.Vector3().crossVectors(face.normal,axis);
    const ordered=[...unique.values()].sort((a,b)=>Math.atan2(b.clone().sub(face.center).dot(second),b.clone().sub(face.center).dot(axis))-Math.atan2(a.clone().sub(face.center).dot(second),a.clone().sub(face.center).dot(axis)));
    // Cannon expects counter-clockwise winding as seen from outside.
    ordered.reverse();
    return ordered.map(point=>{const key=point.toArray().map(value=>value.toFixed(5)).join(',');if(!lookup.has(key)){lookup.set(key,vertices.length);vertices.push(point.toArray());}return lookup.get(key);});
  });
  geometry.dispose();return {vertices,faces:polygons};
}

function numberTexture(text) {
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,256,256);ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=`600 ${text.length>1?134:164}px Georgia, serif`;ctx.shadowColor='#ff2b36';ctx.shadowBlur=4;ctx.fillStyle='#ed414b';ctx.fillText(text,128,134);
  if(text==='6'||text==='9'){ctx.shadowBlur=0;ctx.fillRect(101,220,54,5);}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

// Keep the supplied mesh and its bevels. The collection has no numeral meshes,
// so its large panels receive red labels without modifying the user's asset.
export function createDieTemplate(source,sides,{labels=true,units=false}={}) {
  const group=new THREE.Group(),model=source.clone(true);model.position.set(0,0,0);model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),scale=1.16/Math.max(size.x,size.y,size.z);
  const normals=new Map(),points=[];let bodyGeometry;
  model.traverse(object=>{
    if(!object.isMesh)return;
    object.geometry=object.geometry.clone();object.material=Array.isArray(object.material)?object.material.map(material=>material.clone()):object.material.clone();object.castShadow=true;
    if(object.name.startsWith('GRIMUR_Number')) {
      object.material.emissive=new THREE.Color(0x6b080a);object.material.emissiveIntensity=.65;
      const number=Number(object.name.match(/\d+$/)?.[0]),normal=new THREE.Vector3(0,0,1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion())).normalize();
      if(normal.dot(new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()).sub(center))<0)normal.negate();
      normals.set(number,normal);return;
    }
    if(!bodyGeometry)bodyGeometry=object.geometry.clone().applyMatrix4(object.matrixWorld).translate(-center.x,-center.y,-center.z).scale(scale,scale,scale);
  });
  model.position.sub(center);group.scale.setScalar(scale);group.add(model);
  // Bake normalization into a parent so geometry, labels and collision normals
  // use a common coordinate system for every die.
  const normalized=new THREE.Group();normalized.add(group);
  if(bodyGeometry) {
    const positions=bodyGeometry.attributes.position;
    for(let i=0;i<positions.count;i++)points.push(new THREE.Vector3().fromBufferAttribute(positions,i));
    if(sides!==20) {
      const faces=geometryFaces(bodyGeometry),large=faces.filter(face=>face.area>=faces[0].area*.5);
      large.sort((a,b)=>b.normal.y-a.normal.y||Math.atan2(a.normal.z,a.normal.x)-Math.atan2(b.normal.z,b.normal.x));
      for(let i=0;i<large.length;i++) {
        const face=large[i],value=sides===100?(i%10)*10:units?(i%10):(i%(sides===100?10:sides))+1;
        if(!normals.has(value))normals.set(value,face.normal.clone());
        if(labels) {
          const text=sides===100?String(value).padStart(2,'0'):String(value),texture=numberTexture(text);
          const width=Math.sqrt(face.area)*(sides===4?.46:.57);
          const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,width),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,toneMapped:false}));
          mesh.name=`Face_${value}`;mesh.position.copy(face.center).addScaledVector(face.normal,.002);
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),face.normal);normalized.add(mesh);
        }
      }
    }
    bodyGeometry.dispose();
  }
  return {object:normalized,normals,collider:convexCollider(points),points,sides,source:source.name};
}

export function disposeDiceObject(object) {
  const geometries=new Set(),materials=new Set(),textures=new Set();
  object.traverse(child=>{
    if(child.geometry)geometries.add(child.geometry);
    for(const material of child.material?(Array.isArray(child.material)?child.material:[child.material]):[]){materials.add(material);if(material.map)textures.add(material.map);}
  });
  for(const texture of textures)texture.dispose();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
}

export function percentileParts(value) {
  const numeric=Number(value);if(!Number.isInteger(numeric)||numeric<1||numeric>100)throw new RangeError('A percentile result must be between 1 and 100.');
  return {tens:Math.floor(numeric%100/10)*10,units:numeric%10};
}
