import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('campaign hub SQL preserves campaigns and enforces membership, master permissions and private Storage', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  // Only the managed Supabase schemas are simulated. Application migrations,
  // constraints, grants, functions and RLS execute in real PostgreSQL/PGlite.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select on storage.objects to anon;
    grant select, insert, update, delete on storage.objects to authenticated;
    create schema realtime;
    create table realtime.messages(id uuid primary key default gen_random_uuid(), extension text);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
    grant usage on schema realtime to authenticated;
    create publication supabase_realtime;
  `);
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const names = (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort();
  const hubMigration = names.find(name => name.endsWith('_campaign_hub.sql'));
  assert.ok(hubMigration);
  for (const name of names.filter(name => name < hubMigration)) await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'];
  for (const [index, id] of ids.entries()) {
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',
      [id, `hub${index}@example.test`, { username: `hub_${index}`, birth_date: '2000-01-01', display_name: `Pessoa ${index}` }]);
  }
  await db.query("update public.profiles set role='admin' where id=$1", [ids[3]]);
  async function asUser(id, callback, role = 'authenticated') {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
    try { return await callback(); }
    finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
  }
  const rows = async (sql, values = []) => (await db.query(sql, values)).rows;
  const rpc = async (sql, values = []) => (await rows(sql, values))[0].result;
  const getHub = code => rpc('select public.get_campaign_hub($1) as result', [code]);
  const updateHub = (code, patch) => rpc('select public.update_campaign_hub($1,$2) as result', [code, patch]);
  const start = (code, title = '') => rpc('select public.start_campaign_session($1,$2) as result', [code, title]);
  const end = code => rpc('select public.end_campaign_session($1) as result', [code]);
  let campaign, legacy, other;
  await asUser(ids[0], async () => {
    campaign = (await rpc("select public.create_campaign('A Torre') as result")).campaign;
    legacy = (await rpc("select public.create_campaign('Mesa anterior') as result")).campaign;
    await db.query("update public.campaigns set status='session' where id=$1", [legacy.id]);
    await db.query("update public.campaign_notes set notes='SEGREDO DO MESTRE' where campaign_id=$1", [campaign.id]);
  });
  await asUser(ids[2], async () => { other = (await rpc("select public.create_campaign('Outra campanha') as result")).campaign; });
  const beforeMigration = new Date((await rows('select now() as at'))[0].at).getTime();
  for (const name of names.filter(name => name >= hubMigration)) await db.exec(await readFile(new URL(name, migrations), 'utf8'));

  await t.test('only already active campaigns receive a session, with an honest migration-time start', async () => {
    const sessions = await rows('select * from public.campaign_sessions');
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].campaign_id, legacy.id);
    assert.equal(sessions[0].number, 1);
    assert.equal(sessions[0].title, 'Sessão em andamento');
    assert.equal(sessions[0].ended_at, null);
    assert.ok(new Date(sessions[0].started_at).getTime() >= beforeMigration);
    await asUser(ids[0], async () => {
      const hub = await getHub(legacy.code);
      assert.equal(hub.activeSession.id, sessions[0].id);
      assert.equal(hub.lastSession, null);
      assert.equal((await start(legacy.code)).session.id, sessions[0].id, 'continue must not create a duplicate');
    });
  });

  await t.test('hub membership is checked in SQL; global admins do not become campaign masters', async () => {
    await asUser(ids[0], async () => {
      const hub = await getHub(campaign.code.toLowerCase());
      assert.equal(hub.role, 'master');
      assert.deepEqual(hub.permissions, { canManage: true, canViewPrivate: true, canStartSession: true });
      assert.equal(hub.master.id, ids[0]);
      assert.equal(hub.playerCount, 0);
      assert.equal(hub.maxPlayers, 10);
      assert.equal(hub.members.length, 1);
      assert.equal(hub.members[0].isMaster, true);
      assert.deepEqual(hub.sessions, []);
      assert.equal(hub.activeSession, null);
      assert.equal(hub.lastSession, null);
      assert.ok(!JSON.stringify(hub).includes('SEGREDO'));
      assert.ok(!('state' in hub.campaign), 'the hub does not load the full tabletop state');
      assert.ok(hub.members.every(member => !('email' in member) && !('role' in member)));
    });
    for (const id of [ids[1], ids[2], ids[3]]) {
      await asUser(id, async () => {
        await assert.rejects(getHub(campaign.code), error => error.code === '42501');
        await assert.rejects(updateHub(campaign.code, { name: 'Invadida' }), /Somente o mestre/);
        await assert.rejects(start(campaign.code), /Somente o mestre/);
        await assert.rejects(end(campaign.code), /Somente o mestre/);
        assert.deepEqual(await rows('select * from public.campaign_sessions where campaign_id=$1', [legacy.id]), []);
      });
    }
    await asUser(null, async () => {
      await assert.rejects(getHub(campaign.code), /Faça login/);
      await assert.rejects(start(campaign.code), /Faça login/);
      await assert.rejects(end(campaign.code), /Faça login/);
      await assert.rejects(updateHub(campaign.code, {}), /Faça login/);
    });
    await asUser(null, async () => {
      await assert.rejects(getHub(campaign.code), /permission denied/);
      await assert.rejects(updateHub(campaign.code, {}), /permission denied/);
      await assert.rejects(start(campaign.code), /permission denied/);
      await assert.rejects(end(campaign.code), /permission denied/);
      await assert.rejects(db.query('select * from public.campaign_sessions'), /permission denied/);
    }, 'anon');
    await asUser(ids[1], async () => {
      await rpc('select public.join_campaign($1,$2) as result', [campaign.code, 'Kael']);
      const hub = await getHub(campaign.code);
      assert.equal(hub.role, 'player');
      assert.deepEqual(hub.permissions, { canManage: false, canViewPrivate: false, canStartSession: false });
      assert.equal(hub.playerCount, 1);
      assert.equal(hub.members.find(person => person.id === ids[1]).playerName, 'Kael');
      assert.deepEqual(await rows('select * from public.campaign_notes'), []);
      assert.deepEqual(await rows('update public.campaign_notes set notes=$1 where campaign_id=$2 returning *', ['roubada', campaign.id]), []);
      await assert.rejects(db.query('insert into public.campaign_notes(campaign_id,notes) values($1,$2)', [other.id, 'intruso']), /row-level security/);
      await assert.rejects(rpc('select grimorio_private.update_campaign_hub($1,$2) as result', [campaign.code, { name: 'Bypass' }]), /Somente o mestre/);
    });
  });

  await t.test('metadata updates reject invalid data, forbidden fields and direct session-row writes', async () => {
    await asUser(ids[0], async () => {
      const hub = await updateHub(campaign.code, { name: '  A Torre Rubra ', description: 'Descrição da campanha',
        recentSummary: 'O grupo chegou à torre.', nextSessionAt: '2026-11-02T19:30:00-03:00' });
      assert.equal(hub.campaign.name, 'A Torre Rubra');
      assert.equal(hub.campaign.description, 'Descrição da campanha');
      assert.equal(hub.campaign.recentSummary, 'O grupo chegou à torre.');
      assert.equal(Date.parse(hub.campaign.nextSessionAt), Date.parse('2026-11-02T22:30:00Z'));
      for (const patch of [null, [], { name: '' }, { name: 'a'.repeat(71) }, { description: 'a'.repeat(4001) },
        { recentSummary: 'a'.repeat(4001) }, { description: null }, { name: 123 }, { nextSessionAt: 'infinity' },
        { nextSessionAt: '2026-02-31T12:00:00Z' }, { nextSessionAt: {} }, { nextSessionAt: 'tomorrow' },
        { nextSessionAt: '2026-11-02T22:30' }, { owner_user_id: ids[1] }, { ownerUserId: ids[1] }, { status: 'session' },
        { name: 'Não salvar', coverPath: `${campaign.id}/missing.png` }, { coverPath: null }]) {
        await assert.rejects(updateHub(campaign.code, patch), error => error.code === '22023');
      }
      assert.equal((await getHub(campaign.code)).campaign.name, 'A Torre Rubra', 'invalid patches are atomic');
      const cleared = await updateHub(campaign.code, { nextSessionAt: null, recentSummary: '' });
      assert.equal(cleared.campaign.nextSessionAt, null);
      assert.equal(cleared.campaign.recentSummary, '');
      await assert.rejects(db.query('update public.campaigns set owner_user_id=$1 where id=$2', [ids[1], campaign.id]), /permission denied/);
      await assert.rejects(db.query("insert into public.campaign_sessions(campaign_id,number,title) values($1,1,'Manual')", [campaign.id]), /permission denied/);
      await assert.rejects(db.query('update public.campaign_sessions set ended_at=now()'), /permission denied/);
      await assert.rejects(db.query('delete from public.campaign_sessions'), /permission denied/);
    });
    await asUser(ids[1], async () => {
      await assert.rejects(updateHub(campaign.code, { description: 'forjada' }), /Somente o mestre/);
      assert.deepEqual(await rows("update public.campaigns set name='Intruso' where id=$1 returning id", [campaign.id]), []);
      assert.deepEqual(await rows("update public.campaigns set status='session' where id=$1 returning id", [campaign.id]), []);
    });
  });

  await t.test('legacy status updates preserve session lifecycle without bypassing master permissions', async () => {
    let compatibility;
    await asUser(ids[0], async () => {
      compatibility = (await rpc("select public.create_campaign('Compatibilidade') as result")).campaign;
      await db.query("update public.campaigns set status='session' where id=$1", [compatibility.id]);
      const first = (await getHub(compatibility.code)).activeSession;
      assert.equal(first.number, 1);
      assert.equal(first.title, 'Sessão 1');
      await db.query("update public.campaigns set status='session' where id=$1", [compatibility.id]);
      assert.equal((await getHub(compatibility.code)).activeSession.id, first.id, 'repeated legacy start does not duplicate');
      assert.equal((await start(compatibility.code)).session.id, first.id, 'RPC can continue a legacy session');
      await db.query("update public.campaigns set status='lobby' where id=$1", [compatibility.id]);
      const closed = await getHub(compatibility.code);
      assert.equal(closed.activeSession, null);
      assert.equal(closed.lastSession.id, first.id);
      assert.ok(closed.lastSession.endedAt);
      await db.query("update public.campaigns set status='lobby' where id=$1", [compatibility.id]);
      assert.deepEqual((await end(compatibility.code)).session, closed.lastSession, 'legacy and RPC retries preserve end timestamp');
      const second = (await start(compatibility.code, 'Título via RPC')).session;
      assert.equal(second.number, 2);
      assert.equal(second.title, 'Título via RPC', 'trigger must not replace RPC title');
      await db.query("update public.campaigns set status='lobby' where id=$1", [compatibility.id]);
      assert.equal((await getHub(compatibility.code)).lastSession.id, second.id);
      assert.equal((await getHub(compatibility.code)).sessions.length, 2);
      await assert.rejects(db.query('select grimorio_private.sync_campaign_status_session()'), /permission denied/);
    });
    for (const id of [ids[1], ids[2], ids[3], null]) {
      await asUser(id, async () => {
        assert.deepEqual(await rows("update public.campaigns set status='session' where id=$1 returning id", [compatibility.id]), []);
      });
    }
    assert.equal((await rows('select status from public.campaigns where id=$1', [compatibility.id]))[0].status, 'lobby');
    assert.equal((await rows('select * from public.campaign_sessions where campaign_id=$1', [compatibility.id])).length, 2);
  });

  await t.test('private cover paths, upload/delete permissions and bucket limits are enforced', async () => {
    const cover = `${campaign.id}/a-valid-image.png`;
    const bucket = (await rows("select * from storage.buckets where id='campaign-covers'"))[0];
    assert.equal(bucket.public, false);
    assert.equal(Number(bucket.file_size_limit), 3 * 1024 * 1024);
    assert.deepEqual(bucket.allowed_mime_types, ['image/png', 'image/jpeg', 'image/webp']);
    await asUser(ids[0], async () => {
      await db.query("insert into storage.objects(bucket_id,name) values('campaign-covers',$1)", [cover]);
      assert.equal((await updateHub(campaign.code, { coverPath: cover })).campaign.coverPath, cover);
      for (const path of [`${other.id}/foreign.png`, `${campaign.id}/../secret.png`, `${campaign.id}/nested/map.png`,
        `${campaign.id}/script.svg`, 'garbage/cover.png', `${campaign.id}/file.pdf`]) {
        await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('campaign-covers',$1)", [path]), /row-level security/);
        await assert.rejects(updateHub(campaign.code, { coverPath: path }), /capa válida/);
      }
      assert.deepEqual(await rows("update storage.objects set name=$1 where name=$2 returning id", [`${campaign.id}/overwrite.png`, cover]), [], 'paths are immutable');
    });
    await asUser(ids[1], async () => {
      assert.equal((await rows("select name from storage.objects where bucket_id='campaign-covers'"))[0].name, cover);
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('campaign-covers',$1)", [`${campaign.id}/player.png`]), /row-level security/);
      assert.deepEqual(await rows('delete from storage.objects where name=$1 returning id', [cover]), []);
      await assert.rejects(updateHub(campaign.code, { coverPath: '' }), /Somente o mestre/);
    });
    for (const id of [ids[2], ids[3]]) {
      await asUser(id, async () => {
        assert.deepEqual(await rows("select * from storage.objects where bucket_id='campaign-covers'"), []);
        assert.deepEqual(await rows('delete from storage.objects where name=$1 returning id', [cover]), []);
        await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('campaign-covers',$1)", [`${campaign.id}/outsider.png`]), /row-level security/);
      });
    }
    await asUser(null, async () => assert.deepEqual(await rows("select * from storage.objects where bucket_id='campaign-covers'"), []), 'anon');
    await asUser(ids[0], async () => {
      await updateHub(campaign.code, { coverPath: '' });
      assert.equal((await rows('delete from storage.objects where name=$1 returning id', [cover])).length, 1);
    });
  });

  await t.test('session transitions are idempotent, uniquely active, ordered and inaccessible to players', async () => {
    let first;
    await asUser(ids[0], async () => {
      assert.deepEqual(await end(campaign.code), { ok: true, session: null });
      await assert.rejects(start(campaign.code, 'a'.repeat(121)), /até 120/);
      first = (await start(campaign.code)).session;
      assert.equal(first.number, 1);
      assert.equal(first.title, 'Sessão 1');
      assert.equal(first.endedAt, null);
      assert.deepEqual((await start(campaign.code, 'Título ignorado ao continuar')).session, first);
      const hub = await getHub(campaign.code);
      assert.equal(hub.campaign.status, 'session');
      assert.equal(hub.permissions.canStartSession, false);
      assert.equal(hub.activeSession.id, first.id);
      assert.equal(hub.lastSession, null);
    });
    await asUser(ids[1], async () => {
      assert.equal((await getHub(campaign.code)).activeSession.id, first.id);
      assert.equal((await rows('select * from public.campaign_sessions')).length, 1);
      await assert.rejects(start(campaign.code), /Somente o mestre/);
      await assert.rejects(end(campaign.code), /Somente o mestre/);
    });
    await assert.rejects(db.query("insert into public.campaign_sessions(campaign_id,number,title) values($1,2,'Duplicate active')", [campaign.id]), /unique constraint/);
    await asUser(ids[0], async () => {
      const ended = (await end(campaign.code)).session;
      assert.equal(ended.id, first.id);
      assert.ok(Date.parse(ended.endedAt) >= Date.parse(ended.startedAt));
      assert.deepEqual((await end(campaign.code)).session, ended, 'retry does not rewrite the end timestamp');
      let hub = await getHub(campaign.code);
      assert.equal(hub.campaign.status, 'lobby');
      assert.equal(hub.activeSession, null);
      assert.equal(hub.lastSession.id, ended.id);
      assert.equal(hub.permissions.canStartSession, true);
      const second = (await start(campaign.code, '  O portal  ')).session;
      assert.equal(second.number, 2);
      assert.equal(second.title, 'O portal');
      hub = await getHub(campaign.code);
      assert.equal(hub.lastSession.id, ended.id, 'active is not the last completed session');
      assert.equal(hub.activeSession.id, second.id);
      await end(campaign.code);
      for (let number = 3; number <= 22; number++) { await start(campaign.code); await end(campaign.code); }
      const history = await getHub(campaign.code);
      assert.equal(history.sessions.length, 20);
      assert.equal(history.sessions[0].number, 22);
      assert.equal(history.sessions.at(-1).number, 3);
      assert.equal(history.lastSession.number, 22);
    });
    await assert.rejects(db.query("insert into public.campaign_sessions(campaign_id,number,title) values($1,1,'Duplicate number')", [campaign.id]), /unique constraint/);
    await assert.rejects(db.query("insert into public.campaign_sessions(campaign_id,number,title,started_at,ended_at) values($1,23,'Wrong dates','2026-10-02','2026-10-01')", [campaign.id]), /check constraint/);
    await asUser(ids[2], async () => {
      await start(other.code);
      assert.equal((await rows('select * from public.campaign_sessions')).length, 1, 'unrelated sessions remain invisible');
    });
  });

  await t.test('private notes remain protected and SQL functions expose no privileged public entry point', async () => {
    await asUser(ids[0], async () => {
      assert.equal((await rows('select notes from public.campaign_notes where campaign_id=$1', [campaign.id]))[0].notes, 'SEGREDO DO MESTRE');
      assert.ok(!JSON.stringify(await getHub(campaign.code)).includes('SEGREDO'));
    });
    const privilegedPublic = await rows("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef");
    assert.deepEqual(privilegedPublic, []);
    const published = (await rows("select tablename from pg_publication_tables where pubname='supabase_realtime'")).map(row => row.tablename);
    assert.ok(published.includes('campaigns'));
    assert.ok(!published.includes('campaign_notes'));
    const unchecked = await rows("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");
    assert.deepEqual(unchecked, []);
    await db.query('delete from public.campaigns where id=$1', [other.id]);
    assert.deepEqual(await rows('select * from public.campaign_sessions where campaign_id=$1', [other.id]), []);
  });
});
