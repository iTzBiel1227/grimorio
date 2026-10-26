import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const id=randomUUID(), port=35000+Math.floor(Math.random()*10000);
const dbPath=path.join(tmpdir(),`grimorio-check-${id}.sqlite`);
const script=path.resolve('tests',`.runtime-${id}.mjs`);
writeFileSync(script,readFileSync('server.js','utf8').replace('new Database(path.join(__dirname, "grimorio.sqlite"))',`new Database(${JSON.stringify(dbPath)})`));
const child=spawn(process.execPath,[script],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let errors=''; child.stderr.on('data',chunk=>errors+=chunk);
try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout: '+errors)),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve()});child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+errors))})});
  const request=async(url,body,token)=>{const res=await fetch(`http://localhost:${port}${url}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:res.status===204?null:await res.json()}};
  const account=await request('/api/auth/register',{username:'regression',birthDate:'2000-01-01',email:'regression@example.test',password:'test-password-123'});assert.equal(account.status,201);
  const token=account.data.token;
  assert.equal((await request('/api/campaigns',{name:'   '},token)).status,400);
  const created=await request('/api/campaigns',{name:'  As Cinzas do Reino  '},token);assert.equal(created.status,201);assert.equal(created.data.campaign.name,'As Cinzas do Reino');
  const code=created.data.campaign.code;
  assert.equal((await request('/api/campaigns/'+code,undefined,token)).data.role,'master');
  assert.equal((await request('/api/my/campaigns',undefined,token)).data.campaigns.length,1);
  assert.equal((await request('/api/auth/login',{email:'regression@example.test',password:'test-password-123'})).status,200);
  assert.equal((await request('/api/auth/logout',{},token)).status,204);
  assert.equal((await request('/api/auth/me',undefined,token)).status,401);
  console.log('OK: cadastro, login, criação, validação, listagem, lobby e logout em banco isolado.');
} finally {
  child.kill();
  if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));
  for(const file of [script,dbPath,dbPath+'-wal',dbPath+'-shm'])try{unlinkSync(file)}catch{}
}
