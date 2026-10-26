import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
const id=randomUUID(), dbPath=path.join(tmpdir(),`grimorio-friends-${id}.sqlite`), script=path.resolve('tests',`.runtime-friends-${id}.mjs`), port=35000+Math.floor(Math.random()*10000);
const legacy=new Database(dbPath);
legacy.exec("CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user'); INSERT INTO users VALUES ('legacy','legacy@example.test','unused','2026-01-01','admin')");legacy.close();
writeFileSync(script,readFileSync('server.js','utf8').replace('new Database(path.join(__dirname, "grimorio.sqlite"))',`new Database(${JSON.stringify(dbPath)})`));
let child;
async function start(){child=spawn(process.execPath,[script],{env:{...process.env,PORT:String(port),ADMIN_EMAIL:''},stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',c=>error+=c);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(error||'startup timeout')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve()});child.once('exit',()=>{clearTimeout(timer);reject(Error(error))})});}
async function stop(){if(child&&child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}}
async function req(url,token,body,method=body?'POST':'GET'){const response=await fetch(`http://127.0.0.1:${port}${url}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
try{
 await start();
 const check=new Database(dbPath,{readonly:true});const old=check.prepare("SELECT account_code,role FROM users WHERE id='legacy'").get();check.close();assert.match(old.account_code,/^\d{8}$/);assert.equal(old.role,'admin');
 const accounts=[];for(let i=0;i<3;i++){const r=await req('/api/auth/register',null,{username:`friend${i}`,birthDate:'2000-01-01',email:`friend${i}@example.test`,password:'test-password-123',accountCode:'11111111'});assert.equal(r.status,201);accounts.push(r.data);assert.match(r.data.user.accountCode,/^\d{8}$/);}
 assert.equal(new Set(accounts.map(a=>a.user.accountCode)).size,3);
 const [a,b,c]=accounts;
 for(const acc of [b,c])assert.equal((await req('/api/profile',acc.token,{displayName:'João da Mesa',avatarData:''},'PUT')).status,200);
 assert.equal((await req('/api/users/search?q=joao')).status,401);
 const search=await req('/api/users/search?q=JOAO',a.token);assert.equal(search.status,200);assert.equal(search.data.users.length,2);assert.equal('email' in search.data.users[0],false);
 assert.equal((await req('/api/users/search?q=%25%25',a.token)).data.users.length,0);
 const code=await req('/api/users/search?q='+b.user.accountCode,a.token);assert.equal(code.data.users.length,1);assert.equal(code.data.users[0].id,b.user.id);
 assert.equal((await req('/api/friends',a.token,{accountCode:a.user.accountCode})).status,400);
 assert.equal((await req('/api/friends',a.token,{accountCode:'123'})).status,400);
 assert.equal((await req('/api/friends',a.token,{accountCode:b.user.accountCode})).status,200);
 assert.equal((await req('/api/friends',a.token,{accountCode:b.user.accountCode})).status,200);
 assert.equal((await req('/api/friends',a.token)).data.friends.length,0);
 const invitation=(await req('/api/friends',b.token)).data.incomingRequests[0];
 assert.equal(invitation.person.id,a.user.id);
 assert.equal((await req('/api/friend-requests/'+invitation.id+'/accept',a.token,{})).status,403);
 assert.equal((await req('/api/friend-requests/'+invitation.id+'/accept',c.token,{})).status,403);
 assert.equal((await req('/api/friend-requests/'+invitation.id+'/accept',b.token,{})).status,200);
 const list=(await req('/api/friends',a.token)).data.friends;assert.equal(list.length,1);assert.equal(list[0].accountCode,b.user.accountCode);assert.equal('email' in list[0],false);
 assert.equal((await req('/api/friends',b.token)).data.friends[0].id,a.user.id);
 assert.equal((await req('/api/users/search?q='+b.user.accountCode,a.token)).data.users[0].isFriend,true);
 await req('/api/profile',b.token,{displayName:'Outro nome',avatarData:'',accountCode:'99999999'},'PUT');assert.equal((await req('/api/auth/me',b.token)).data.user.accountCode,b.user.accountCode);
 await stop();await start();assert.equal((await req('/api/auth/me',b.token)).data.user.accountCode,b.user.accountCode);assert.equal((await req('/api/friends',a.token)).data.friends.length,1);
 assert.equal((await req('/api/friends/'+b.user.id,a.token,undefined,'DELETE')).status,200);
 assert.equal((await req('/api/friends',b.token)).data.friends.length,0);
 const cancelled=(await req('/api/friends',a.token,{accountCode:b.user.accountCode})).data.request;
 await req('/api/friend-requests/'+cancelled.id,a.token,undefined,'DELETE');
 assert.equal((await req('/api/friends',b.token)).data.incomingRequests.length,0);
 console.log('OK: migração de contas existentes, códigos únicos, nomes repetidos, busca por nome/código, privacidade, amizade e persistência.');
}finally{await stop();for(const file of [script,dbPath,dbPath+'-wal',dbPath+'-shm'])try{unlinkSync(file)}catch{}}
