import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Execute real PostgreSQL migrations/RLS in memory. Only Supabase-managed
// schemas are stubbed; the application's SQL is executed without modification.
test('Supabase schema enforces account, campaign, sheet and content permissions', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
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
    create function realtime.topic() returns text language sql stable as
      $$ select current_setting('realtime.topic', true) $$;
    grant usage on schema realtime to authenticated;
    create publication supabase_realtime;
  `);
  // An existing Auth account must get a profile too.
  const ids = Array.from({ length: 12 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  await db.query('insert into auth.users(id,email) values ($1,$2)', [ids[0], 'owner@example.test']);
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  for (let index = 1; index < ids.length; index++) {
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)',
      [ids[index], `player${index}@example.test`, { display_name: index === 1 ? 'Ária' : `Player ${index}`, role: 'admin' }]);
  }
  async function asUser(id, callback, role = 'authenticated') {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
    try { return await callback(); }
    finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
  }
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const rpc = async (sql, params = []) => (await rows(sql, params))[0].result;
  const profiles = await rows('select * from public.profiles');
  assert.equal(profiles.length, ids.length);
  assert.equal(new Set(profiles.map(row => row.account_code)).size, ids.length);
  assert.ok(profiles.every(row => /^\d{8}$/.test(row.account_code) && row.role === 'user'));
  await db.query('insert into grimorio_private.admin_emails(email) values ($1)', ['owner@example.test']);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [ids[0]]);
  assert.equal((await rows('select role from public.profiles where id=$1', [ids[0]]))[0].role, 'admin');
  await db.query("update public.profiles set role='user' where id=$1", [ids[0]]);
  await asUser(ids[1], async () => {
    await assert.rejects(db.query("insert into grimorio_private.admin_emails(email) values ('player1@example.test')"), /permission denied/);
    await assert.rejects(db.query("update public.profiles set role='admin' where id=$1", [ids[1]]), /permission denied/);
    await assert.rejects(db.query("update public.profiles set account_code='12345678' where id=$1", [ids[1]]), /permission denied/);
    await db.query("update public.profiles set display_name='Ária' where id=$1", [ids[1]]);
  });
  const codeBefore = profiles.find(row => row.id === ids[1]).account_code;
  assert.equal((await rows('select account_code from public.profiles where id=$1', [ids[1]]))[0].account_code, codeBefore);

  await asUser(null, async () => {
    await assert.rejects(db.query('select * from public.profiles'), /permission denied/);
    await assert.rejects(db.query("select public.create_campaign('Sem login')"), /permission denied/);
    assert.equal((await rows('select * from public.books')).length, 0);
    assert.equal((await rows('select * from public.site_settings')).length, 1);
  }, 'anon');

  let campaign;
  await asUser(ids[0], async () => {
    await assert.rejects(db.query("select public.create_campaign('   ')"), /nome/);
    campaign = (await rpc("select public.create_campaign('  As Cinzas  ') as result")).campaign;
    assert.equal(campaign.name, 'As Cinzas');
    assert.match(campaign.code, /^[0-9A-F]{6}$/);
    await db.query('update public.campaign_notes set notes=$1 where campaign_id=$2', ['Segredo do mestre', campaign.id]);
  });
  await asUser(ids[1], async () => {
    assert.equal((await rows('select * from public.campaigns')).length, 0);
    const invite = await rpc('select public.get_campaign($1) as result', [campaign.code]);
    assert.equal(invite.role, 'guest');
    assert.deepEqual(invite.campaign.state.tokens, []);
    assert.equal((await rows('select * from public.campaign_notes')).length, 0);
    await rpc('select public.join_campaign($1,$2) as result', [campaign.code, 'Ária']);
    await assert.rejects(db.query("update public.campaigns set state_json='{}' where id=$1", [campaign.id]), /permission denied/);
    const roll = await rpc('select public.roll_campaign_dice($1,20,2,$2,$3) as result', [campaign.code, 'Ataque', 'Ária']);
    assert.ok(roll.value >= 1 && roll.value <= 20);
    assert.equal(roll.total, roll.value + 2);
    const moved = await rpc('select public.move_campaign_token($1,$2,99,-4) as result', [campaign.code, campaign.state.tokens[0].id]);
    assert.equal(moved.state.tokens[0].x, 29);
    assert.equal(moved.state.tokens[0].y, 0);
    assert.ok(!('notes' in moved.state));
  });

  let sheetId, privateSheetId;
  await asUser(ids[1], async () => {
    sheetId = (await rows("insert into public.character_sheets(name,data_json) values ('Ária',$1) returning id", [{ name: 'Ária', story: 'História' }]))[0].id;
    // The established UI permits a 3 MB image, expanded by base64 encoding.
    const portrait = 'data:image/png;base64,' + Buffer.alloc(3_000_000).toString('base64');
    await db.query('update public.character_sheets set data_json=$1 where id=$2', [{ name: 'Ária', portrait }, sheetId]);
    assert.equal((await rows('select data_json from public.character_sheets where id=$1', [sheetId]))[0].data_json.portrait.length, portrait.length);
    await db.query("insert into public.grimoire_entries(kind,name) values ('spell','Chama')");
    await assert.rejects(db.query("insert into public.grimoire_entries(kind,name,is_standard) values ('spell','Padrão falso',true)"), /row-level security/);
  });
  await asUser(ids[2], async () => {
    privateSheetId = (await rows("insert into public.character_sheets(name) values ('Fora da campanha') returning id"))[0].id;
    assert.equal((await rows('select * from public.character_sheets where id=$1', [sheetId])).length, 0);
    assert.equal((await rows('select * from public.grimoire_entries')).length, 0);
    await assert.rejects(db.query('select public.roll_campaign_dice($1,20)', [campaign.code]), /campanha/);
  });
  await asUser(ids[0], async () => {
    assert.equal((await rows('select * from public.character_sheets where id=$1', [sheetId])).length, 1);
    assert.equal((await rows('select * from public.character_sheets where id=$1', [privateSheetId])).length, 0);
    await db.query("update public.character_sheets set name='Ária editada' where id=$1", [sheetId]);
    await assert.rejects(db.query('insert into public.campaign_sheet_assignments values ($1,$2,$3)', [campaign.id, privateSheetId, ids[1]]), /participante/);
    await assert.rejects(db.query('insert into public.campaign_sheet_assignments values ($1,$2,$3)', [campaign.id, sheetId, ids[2]]), /foreign key/);
    await db.query('insert into public.campaign_sheet_assignments values ($1,$2,$3)', [campaign.id, sheetId, ids[1]]);
    const search = await rpc("select public.search_players('aria') as result");
    assert.equal(search.users[0].id, ids[1]);
    assert.ok(!JSON.stringify(search).includes('@example.test'));
    await rpc('select public.add_friend($1) as result', [codeBefore]);
  });
  assert.equal((await rows('select * from public.friendships')).length, 2);
  await asUser(ids[1], async () => {
    await db.query('insert into public.campaign_messages(campaign_id,body) values ($1,$2)', [campaign.id, 'Público']);
    await db.query('insert into public.campaign_messages(campaign_id,recipient_user_id,body) values ($1,$2,$3)', [campaign.id, ids[0], 'Privado']);
    await assert.rejects(db.query('insert into public.campaign_messages(campaign_id,recipient_user_id,body) values ($1,$2,$3)', [campaign.id, ids[2], 'Outra sala']), /foreign key/);
  });
  // Joining is serialized by a row lock; even sequential calls exercise the cap.
  for (let index = 2; index < 10; index++) {
    await asUser(ids[index], () => rpc('select public.join_campaign($1,$2) as result', [campaign.code, `Player ${index}`]));
  }
  await asUser(ids[10], () => assert.rejects(db.query('select public.join_campaign($1)', [campaign.code]), /limite de 10/));
  await asUser(ids[2], async () => {
    const messages = await rows('select body from public.campaign_messages');
    assert.deepEqual(messages.map(row => row.body), ['Público']);
    assert.equal((await rows('select * from public.campaign_notes')).length, 0);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values ('book-pdfs','fake.pdf')"), /row-level security/);
    await assert.rejects(db.query("insert into public.books(title,pdf_path) values ('Livro','fake.pdf')"), /row-level security/);
  });
  await db.query("update public.profiles set role='admin' where id=$1", [ids[0]]);
  await asUser(ids[0], async () => {
    await db.query("insert into storage.objects(bucket_id,name) values ('book-pdfs','livro.pdf')");
    await db.query("insert into public.books(title,pdf_path) values ('Livro','livro.pdf')");
    const bookId = (await rows("select id from public.books where pdf_path='livro.pdf'"))[0].id;
    const pngData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxkAAAAASUVORK5CYII=';
    const saveFeature = value => db.query("update public.site_settings set value=$1 where key='home_feature'", [value]);
    await saveFeature({ imageData: '/assets/grimorio-book.png', bookId });
    assert.equal((await rows("select value from public.site_settings where key='home_feature'"))[0].value.bookId, bookId);
    await saveFeature({ imageData: pngData, bookId: '' });
    const oversizedPng = Buffer.alloc(3 * 1024 * 1024 + 1);
    Buffer.from(pngData.split(',')[1], 'base64').copy(oversizedPng);
    for (const invalid of [
      { imageData: '', bookId: '' },
      { imageData: 'https://external.example/image.png', bookId: '' },
      { imageData: 'data:image/svg+xml;base64,PHN2Zy8+', bookId: '' },
      { imageData: 'data:image/png;base64,bm90IGFuIGltYWdl', bookId: '' },
      { imageData: `data:image/png;base64,${oversizedPng.toString('base64')}`, bookId: '' },
      { imageData: null, bookId: '' },
      { imageData: pngData },
      { imageData: pngData, bookId: null },
      { imageData: pngData, bookId: 'invalid-id' },
      { imageData: pngData, bookId: ids[11] }
    ]) {
      await assert.rejects(saveFeature(invalid), error => error.code === '23514');
    }
    assert.deepEqual((await rows("select value from public.site_settings where key='home_feature'"))[0].value,
      { imageData: pngData, bookId: '' });
  });
  await asUser(ids[1], async () => {
    await assert.rejects(db.query("insert into public.site_settings(key,value) values ('home_feature',$1) on conflict (key) do update set value=excluded.value",
      [{ imageData: '/assets/grimorio-book.png', bookId: '' }]), /row-level security/);
  });
  await asUser(null, async () => {
    assert.equal((await rows('select * from public.books')).length, 1);
    assert.equal((await rows('select * from storage.objects')).length, 1);
  }, 'anon');
  assert.ok((await rows("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")).every(row => row.relrowsecurity));
});
