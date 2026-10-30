import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {checkWorld} from './campaign-world-contract.mjs';

test('PostgreSQL campaign world enforces identical contracts and keeps secrets off direct APIs and Realtime',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;
 create schema realtime;create table realtime.messages(id uuid primary key default gen_random_uuid(),extension text);alter table realtime.messages enable row level security;
 create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;grant usage on schema realtime to authenticated;create publication supabase_realtime;`);
 const directory=new URL('../supabase/migrations/',import.meta.url);for(const file of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,directory),'utf8'));
 const users=[];for(let i=0;i<4;i++){const id=`10000000-0000-4000-8000-00000000000${i}`;users.push({id});await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`world${i}@example.test`,{username:'world'+i,birth_date:'2000-01-01',display_name:'Pessoa '+i}]);}
 await db.query("update public.profiles set role='admin' where id=$1",[users[3].id]);
 // Serialize this single PGlite connection's role changes. Each RPC is still
 // transactional and the stale-version assertions exercise lost-update checks.
 let queue=Promise.resolve();
 function as(u,callback){const op=queue.then(async()=>{await db.exec('set role '+(u?'authenticated':'anon'));await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u?.id||'']);try{return await callback();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");}});queue=op.catch(()=>{});return op;}
 const rpc=(u,sql,args=[])=>as(u,async()=>(await db.query(sql,args)).rows[0]?.result);
 await checkWorld({users,create:(u,name)=>rpc(u,'select public.create_campaign($1)->\'campaign\' as result',[name]),
 join:(u,code)=>rpc(u,'select public.join_campaign($1,\'Pessoa\') as result',[code]),
 read:(u,code)=>rpc(u,'select public.get_campaign_world($1) as result',[code]),
 write:(u,code,b)=>rpc(u,'select public.mutate_campaign_world($1,$2,$3,$4,$5,$6) as result',[code,b.kind,b.action,b.id??null,b.data??{},b.expectedVersion??null]),
 sheet:(u,name)=>rpc(u,"insert into public.character_sheets(user_id,name,data_json) values($1,$2,$3) returning jsonb_build_object('id',id) as result",[u.id,name,{name}]),
 assign:async(u,code,id,userId)=>as(u,()=>db.query('insert into public.campaign_sheet_assignments(campaign_id,sheet_id,assigned_user_id) select id,$2,$3 from public.campaigns where code=$1 on conflict(campaign_id,sheet_id) do update set assigned_user_id=excluded.assigned_user_id',[code,id,userId])),
 deleteSheet:(u,id)=>as(u,()=>db.query('delete from public.character_sheets where id=$1',[id])),
 checkRaw:async(c,player,master)=>{
  const tables=['campaign_npcs','campaign_npc_secrets','campaign_relations','campaign_markers','campaign_marker_secrets','campaign_maps'];
  for(const table of tables){for(const u of [player,master,null]){await assert.rejects(as(u,()=>db.exec(`select * from public.${table}`)),e=>e.code==='42501');await assert.rejects(as(u,()=>db.exec(`delete from public.${table}`)),e=>e.code==='42501');}}
  const published=(await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'")).rows.map(r=>r.tablename);
  assert.ok(published.includes('campaign_world_versions'));assert.ok(tables.every(name=>!published.includes(name)));
  assert.equal((await as(users[2],()=>db.query('select * from public.campaign_world_versions where campaign_id=$1',[c.id]))).rows.length,0);
  assert.equal((await as(player,()=>db.query('select * from public.campaign_world_versions where campaign_id=$1',[c.id]))).rows.length,1);
  const rls=(await db.query("select relname,relrowsecurity from pg_class where relname=any($1::text[])",[tables])).rows;assert.equal(rls.length,tables.length);assert.ok(rls.every(row=>row.relrowsecurity));
  const wrappers=(await db.query("select proname,prosecdef from pg_proc where proname in ('get_campaign_world','mutate_campaign_world') and pronamespace='public'::regnamespace")).rows;assert.equal(wrappers.length,2);assert.ok(wrappers.every(row=>!row.prosecdef));
 }});
});
