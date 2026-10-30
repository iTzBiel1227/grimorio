import test from 'node:test';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {checkWorld} from './campaign-world-contract.mjs';

test('SQLite campaign world enforces visibility, references, conflicts and persistence',async t=>{
 const id=randomUUID(),port=35000+Math.floor(Math.random()*10000),origin=`http://127.0.0.1:${port}`,database=path.join(tmpdir(),`world-${id}.sqlite`),script=path.resolve('tests',`.runtime-world-${id}.mjs`);
 writeFileSync(script,readFileSync('server.js','utf8').replace('new Database(path.join(__dirname, "grimorio.sqlite"))',`new Database(${JSON.stringify(database)})`));
 let child;
 async function start(){child=spawn(process.execPath,[script],{env:{...process.env,PORT:String(port),ADMIN_EMAIL:'world3@example.test'},stdio:['ignore','pipe','pipe'],windowsHide:true});let errors='';child.stderr.on('data',v=>errors+=v);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'Startup timeout')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(Error(errors));});});}
 async function stop(){if(child&&child.exitCode===null){const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;}}
 t.after(async()=>{await stop();for(const file of [script,database,database+'-wal',database+'-shm'])try{unlinkSync(file);}catch{}});
 await start();
 async function api(user,url,body,method=body?'POST':'GET'){const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=r.status===204?null:await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data;}
 const users=[];for(let i=0;i<4;i++){const result=await api(null,'/api/auth/register',{username:'world'+i,email:`world${i}@example.test`,birthDate:'2000-01-01',password:'TestPassword123!'});users.push({...result.user,token:result.token});}
 await checkWorld({users,create:async(u,name)=>(await api(u,'/api/campaigns',{name})).campaign,join:(u,code)=>api(u,`/api/campaigns/${code}/join`,{playerName:'Pessoa'}),
 read:(u,code)=>api(u,`/api/campaigns/${code}/world`),write:(u,code,body)=>api(u,`/api/campaigns/${code}/world`,body),
 sheet:(u,name)=>api(u,'/api/sheets',{data:{name}}),assign:(u,code,id,userId)=>api(u,`/api/campaigns/${code}/sheets/${id}/assign`,{userId},'PUT'),
 deleteSheet:(u,id)=>api(u,'/api/sheets/'+id,undefined,'DELETE'),restart:async()=>{await stop();await start();}});
});
