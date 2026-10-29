import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

test('campaign Hub protects management and notes, preserves legacy tables and records sessions atomically', async t => {
  const id=randomUUID(),port=35000+Math.floor(Math.random()*10000),origin=`http://127.0.0.1:${port}`;
  const database=path.join(tmpdir(),`grimorio-hub-${id}.sqlite`),script=path.resolve('tests',`.runtime-hub-${id}.mjs`);
  const source=readFileSync('server.js','utf8'),declaration='new Database(path.join(__dirname, "grimorio.sqlite"))';
  assert.ok(source.includes(declaration),'The test must isolate the database before starting the server');
  writeFileSync(script,source.replace(declaration,`new Database(${JSON.stringify(database)})`));
  const legacy=new Database(database);
  legacy.exec(`CREATE TABLE campaigns (
    id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,system_name TEXT NOT NULL DEFAULT 'Sistema próprio',
    master_key TEXT NOT NULL,owner_user_id TEXT,created_at TEXT NOT NULL,state_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'lobby'
  ); INSERT INTO campaigns VALUES ('legacy-campaign','LEGACY','Mesa antiga','Sistema próprio','unused',NULL,'2025-01-01','{"tokens":[],"rolls":[],"notes":"nota antiga"}','session');`);
  legacy.close();
  let child;
  const sockets=[];
  async function start(){
    child=spawn(process.execPath,[script],{env:{...process.env,PORT:String(port),ADMIN_EMAIL:'admin-hub@example.test'},stdio:['ignore','pipe','pipe'],windowsHide:true});
    let errors='';child.stderr.on('data',chunk=>errors+=chunk);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error(errors||'Hub server startup timeout')),10000);
      child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(Error(`Hub server exited ${code}: ${errors}`));});
    });
  }
  async function stop(){if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}}
  t.after(async()=>{for(const socket of sockets)socket.close();await stop();for(const file of [script,database,database+'-wal',database+'-shm'])try{unlinkSync(file);}catch{}});
  async function request(url,token,body,method=body===undefined?'GET':'POST'){
    const response=await fetch(origin+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:response.status===204?null:await response.json()};
  }
  function inspect(sql,...params){const db=new Database(database,{readonly:true});try{return db.prepare(sql).all(...params);}finally{db.close();}}
  async function connect(token){
    const ws=new WebSocket(origin.replace('http:','ws:')+'/socket.io/?EIO=4&transport=websocket'),events=[],pending=[];
    sockets.push(ws);
    function next(name){
      const prior=events.findIndex(event=>event[0]===name);if(prior>=0)return Promise.resolve(events.splice(prior,1)[0][1]);
      return new Promise((resolve,reject)=>{const waiter={name,resolve,reject,timer:setTimeout(()=>{pending.splice(pending.indexOf(waiter),1);reject(Error('Missing socket event: '+name));},5000)};pending.push(waiter);});
    }
    ws.addEventListener('message',event=>{
      const packet=String(event.data);
      if(packet.startsWith('0'))ws.send('40'+JSON.stringify({token}));
      else if(packet==='2')ws.send('3');
      else {
        const payload=packet.startsWith('40')?['connected',{}]:packet.startsWith('42')?JSON.parse(packet.slice(2)):null;
        if(!payload)return;
        const index=pending.findIndex(waiter=>waiter.name===payload[0]);
        if(index>=0){const [waiter]=pending.splice(index,1);clearTimeout(waiter.timer);waiter.resolve(payload[1]);}else events.push(payload);
      }
    });
    await next('connected');
    return {next,events,send:(name,payload)=>ws.send('42'+JSON.stringify([name,payload])),close:()=>ws.close()};
  }

  await start();
  const legacySession=inspect('SELECT * FROM campaign_sessions WHERE campaign_id=?','legacy-campaign')[0];
  assert.ok(legacySession.id);assert.equal(legacySession.number,1);assert.equal(legacySession.ended_at,null);
  assert.ok(Date.parse(legacySession.started_at)>Date.parse('2025-01-01'),'Migration cannot invent a historical start date');
  const accounts=[];
  for(const username of ['master_hub','player_hub','outsider_hub','admin_hub']){
    const result=await request('/api/auth/register',null,{username,email:username.replace('_','-')+'@example.test',birthDate:'2000-01-01',password:'test-password-123'});
    assert.equal(result.status,201);accounts.push(result.data);
  }
  const [master,player,outsider,admin]=accounts;assert.equal(admin.user.role,'admin');
  const created=await request('/api/campaigns',master.token,{name:'A Torre Rubra'});assert.equal(created.status,201);
  const code=created.data.campaign.code,base='/api/campaigns/'+code;
  assert.equal((await request(base+'/hub')).status,401);
  assert.equal((await request('/api/campaigns/000000/hub',master.token)).status,403);
  const preview=await request(base,outsider.token);assert.equal(preview.status,200);assert.equal(preview.data.role,'guest');
  assert.equal('state' in preview.data.campaign,false);assert.equal('masterKey' in preview.data,false);
  assert.equal((await request(base+'/hub',outsider.token)).status,403);
  assert.equal((await request(base+'/hub',admin.token)).status,403,'Global administration does not grant campaign access');
  await request(base+'/join',player.token,{playerName:'Kael'});
  const initial=(await request(base+'/hub',master.token)).data;
  assert.equal(initial.role,'master');assert.equal(initial.master.id,master.user.id);assert.equal(initial.playerCount,1);assert.equal(initial.members.length,2);assert.equal(initial.maxPlayers,10);
  assert.deepEqual(initial.permissions,{canManage:true,canViewPrivate:true,canStartSession:true});assert.equal(initial.activeSession,null);assert.equal(initial.lastSession,null);assert.deepEqual(initial.sessions,[]);
  assert.equal('state' in initial.campaign,false);assert.equal('email' in initial.master,false);
  const playerHub=(await request(base+'/hub',player.token)).data;
  assert.equal(playerHub.role,'player');assert.deepEqual(playerHub.permissions,{canManage:false,canViewPrivate:false,canStartSession:false});

  const secret='A passagem secreta fica atrás do altar.';
  for(const account of [player,outsider,admin]){
    for(const [suffix,body,method] of [
      ['/hub',{name:'Tomada de controle',role:'master',owner_user_id:account.user.id},'PUT'],
      ['/cover',{imageData:''},'PUT'],['/notes',{notes:secret},'PUT'],['/notes',undefined,'GET'],
      ['/start',{},'POST'],['/lobby',{},'POST']
    ])assert.equal((await request(base+suffix,account.token,body,method)).status,403,`${account.user.username} ${suffix}`);
  }
  await request(base+'/join',admin.token,{playerName:'Administrador convidado'});
  const adminParticipant=(await request(base+'/hub',admin.token)).data;
  assert.equal(adminParticipant.role,'player');assert.equal(adminParticipant.permissions.canManage,false);
  assert.equal((await request(base+'/hub',admin.token,{name:'Admin não é mestre'},'PUT')).status,403);
  assert.equal((await request(base+'/notes',admin.token)).status,403);
  const metadata={name:'  A Torre das Cinzas  ',description:'Campanha entre amigos.',recentSummary:'O grupo chegou a Valenne.',nextSessionAt:'2026-11-01T20:00:00-03:00',owner_user_id:player.user.id,status:'session',role:'player'};
  const updated=await request(base+'/hub',master.token,metadata,'PUT');assert.equal(updated.status,200);
  assert.equal(updated.data.campaign.name,'A Torre das Cinzas');assert.equal(updated.data.campaign.nextSessionAt,'2026-11-01T23:00:00.000Z');assert.equal(updated.data.campaign.status,'lobby');assert.equal(updated.data.role,'master');
  assert.equal((await request(base+'/hub',player.token)).data.campaign.description,metadata.description);
  for(const body of [{name:'   '},{name:'x'.repeat(71)},{name:123},{name:null},{description:null},{recentSummary:null},{description:'x'.repeat(4001)},{recentSummary:'x'.repeat(4001)},{recentSummary:{}},{nextSessionAt:'amanhã'},{nextSessionAt:'2026-02-30T10:00:00Z'},{nextSessionAt:'2026-11-01T20:00:00'}])
    assert.equal((await request(base+'/hub',master.token,body,'PUT')).status,400,JSON.stringify(body).slice(0,80));
  assert.equal((await request(base+'/hub',master.token,{nextSessionAt:null},'PUT')).data.campaign.nextSessionAt,null);
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxkAAAAASUVORK5CYII=';
  assert.equal((await request(base+'/cover',master.token,{imageData:png},'PUT')).data.coverUrl,png);
  assert.equal((await request(base+'/hub',player.token)).data.campaign.coverUrl,png);
  for(const imageData of ['https://example.test/image.png','data:image/png;base64,Ym9ndXM=','data:image/svg+xml;base64,PHN2Zz4=',null,'data:image/png;base64,'+Buffer.alloc(3*1024*1024+1).toString('base64')])
    assert.equal((await request(base+'/cover',master.token,{imageData},'PUT')).status,400);
  assert.equal((await request(base+'/cover',master.token,{imageData:''},'PUT')).data.coverUrl,'');
  assert.equal((await request(base+'/notes',master.token,{notes:secret},'PUT')).status,200);
  assert.equal((await request(base+'/notes',master.token)).data.notes,secret);
  assert.equal((await request(base+'/notes',master.token,{notes:'x'.repeat(10001)},'PUT')).status,400);
  assert.equal((await request(base+'/notes',master.token,{notes:{}},'PUT')).status,400);
  for(const endpoint of [base,base+'/hub','/api/my/campaigns']){
    const publicData=(await request(endpoint,player.token)).data;assert.ok(!JSON.stringify(publicData).includes(secret),endpoint);
  }

  const masterSocket=await connect(master.token),playerSocket=await connect(player.token),outsiderSocket=await connect(outsider.token),hubSocket=await connect(master.token);
  masterSocket.send('room:join',{code});playerSocket.send('room:join',{code});outsiderSocket.send('room:join',{code});hubSocket.send('room:join',{code,view:'hub'});
  assert.equal((await masterSocket.next('room:state')).campaign.state.notes,secret);
  assert.equal('notes' in (await playerSocket.next('room:state')).campaign.state,false);
  assert.equal('state' in (await hubSocket.next('room:state')).campaign,false,'Hub does not load notes, tokens or rolls before opening the table');
  assert.match(await outsiderSocket.next('app:error'),/Entre nesta campanha/);
  const signal=playerSocket.next('campaign:updated'),hubSignal=hubSocket.next('campaign:updated');await request(base+'/hub',master.token,{recentSummary:'A ponte foi revelada.'},'PUT');assert.deepEqual(await signal,{code});assert.deepEqual(await hubSignal,{code});
  const privateText='Outro segredo somente do mestre';
  masterSocket.send('master:save-notes',{notes:privateText});assert.equal((await masterSocket.next('room:state')).campaign.state.notes,privateText);
  playerSocket.send('master:save-notes',{notes:'Ataque de jogador',masterKey:created.data.masterKey});assert.match(await playerSocket.next('app:error'),/Somente o mestre/);
  assert.equal((await request(base+'/notes',master.token)).data.notes,privateText);
  assert.ok(!JSON.stringify(playerSocket.events).includes(privateText));

  // A Hub subscribes to campaign changes, not every table movement, roll or chat.
  playerSocket.send('dice:roll',{sides:20});await playerSocket.next('dice:result');await playerSocket.next('room:state');
  playerSocket.send('token:move',{tokenId:created.data.campaign.state.tokens[0].id,x:7,y:6});await playerSocket.next('room:state');
  playerSocket.send('session:chat',{body:'Conversa da mesa'});await playerSocket.next('session:message');
  await request(base+'/hub',master.token,{recentSummary:'A ponte foi revelada.'},'PUT');await hubSocket.next('campaign:updated');
  assert.equal(hubSocket.events.some(([event])=>['room:state','dice:result','session:message'].includes(event)),false);

  const newSheetSignal=hubSocket.next('sheet:list-changed');
  const sheet=await request('/api/sheets',player.token,{data:{name:'Kael'}});assert.equal(sheet.status,201);await newSheetSignal;
  const editSheetSignal=hubSocket.next('sheet:list-changed');
  assert.equal((await request('/api/sheets/'+sheet.data.id,player.token,{expectedVersion:sheet.data.version,data:{name:'Kael da Torre'}},'PUT')).status,200);await editSheetSignal;
  const deleteSheetSignal=hubSocket.next('sheet:list-changed');
  assert.equal((await request('/api/sheets/'+sheet.data.id,player.token,undefined,'DELETE')).status,204);await deleteSheetSignal;
  assert.equal(hubSocket.events.some(([event])=>event==='sheet:updated'),false,'Hub refreshes its authorized list without receiving whole sheet payloads');

  const assignedSheet=await request('/api/sheets',master.token,{data:{name:'Companheiro atribuído'}});assert.equal(assignedSheet.status,201);
  assert.equal((await request(base+'/sheets/'+assignedSheet.data.id+'/assign',master.token,{userId:player.user.id},'PUT')).status,200);
  const assignedHub=await connect(player.token);assignedHub.send('room:join',{code,view:'hub'});await assignedHub.next('room:state');
  assert.ok((await request(base+'/sheets',player.token)).data.sheets.some(item=>item.id===assignedSheet.data.id));
  const assignedDeletion=assignedHub.next('sheet:list-changed');
  assert.equal((await request('/api/sheets/'+assignedSheet.data.id,master.token,undefined,'DELETE')).status,204);await assignedDeletion;
  assert.equal((await request(base+'/sheets',player.token)).data.sheets.some(item=>item.id===assignedSheet.data.id),false);

  assert.equal((await request(base+'/start',master.token,{title:'x'.repeat(121)})).status,400);
  assert.equal((await request(base+'/start',master.token,{title:{}})).status,400);
  const starts=await Promise.all([request(base+'/start',master.token,{title:'O chamado de Valenne'}),request(base+'/start',master.token,{title:'Não duplicar'})]);
  assert.ok(starts.every(result=>result.status===200));assert.equal(starts[0].data.session.id,starts[1].data.session.id);
  const first=starts[0].data.session;assert.equal(first.number,1);assert.ok(['O chamado de Valenne','Não duplicar'].includes(first.title));assert.equal(first.title,starts[1].data.session.title);
  const active=(await request(base+'/hub',master.token)).data;assert.equal(active.campaign.status,'session');assert.equal(active.activeSession.id,first.id);assert.equal(active.permissions.canStartSession,false);assert.equal(active.sessions.length,1);
  const closed=await request(base+'/lobby',master.token,{});assert.equal(closed.status,200);assert.ok(closed.data.session.endedAt);
  assert.deepEqual((await request(base+'/lobby',master.token,{})).data.session,closed.data.session,'Repeated ending preserves the last session and original end time');
  const after=(await request(base+'/hub',player.token)).data;assert.equal(after.campaign.status,'lobby');assert.equal(after.activeSession,null);assert.equal(after.lastSession.id,first.id);
  const second=(await request(base+'/start',master.token,{title:''})).data.session;assert.equal(second.number,2);assert.equal(second.title,'Sessão 2');
  assert.equal(inspect('SELECT count(*) AS total FROM campaign_sessions WHERE campaign_id=? AND ended_at IS NULL',created.data.campaign.id)[0].total,1);
  for(const socket of sockets)socket.close();
  await stop();await start();
  assert.equal(inspect('SELECT id FROM campaign_sessions WHERE campaign_id=?','legacy-campaign')[0].id,legacySession.id,'Backfill runs only once');
  const restored=(await request(base+'/hub',master.token)).data;assert.equal(restored.activeSession.id,second.id);assert.equal(restored.lastSession.id,first.id);assert.equal(restored.campaign.recentSummary,'A ponte foi revelada.');
  assert.equal((await request(base+'/notes',master.token)).data.notes,privateText);
  const clockChange=new Database(database);
  try{clockChange.prepare('UPDATE campaign_sessions SET started_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',second.id);}finally{clockChange.close();}
  const endedAfterClockChange=await request(base+'/lobby',master.token,{});
  assert.equal(endedAfterClockChange.status,200,'A server clock correction must not prevent ending the session');
  assert.equal(endedAfterClockChange.data.session.endedAt,endedAfterClockChange.data.session.startedAt);
});
