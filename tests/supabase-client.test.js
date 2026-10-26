import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/supabase-client.js', import.meta.url), 'utf8');
const session = { access_token: 'native-refreshed-token', user: { id: 'own-user', email: 'own@example.test' } };
const user = { id: 'own-user', display_name: 'Jogador', avatar_data: '', account_code: '00001234', role: 'user' };
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ authSession = session, role = 'user', respond = () => ({ data: [] }) } = {}) {
  const calls = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: authSession } }),
      signUp: async input => { calls.push({ type: 'signup', input }); return { data: { session: authSession } }; },
      signInWithPassword: async input => { calls.push({ type: 'signin', input }); return { data: { session: authSession } }; },
      signOut: async () => ({ data: null })
    },
    from(table) {
      const call = { type: 'query', table, operations: [] };
      calls.push(call);
      const query = {};
      for (const name of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'in', 'or', 'order', 'limit', 'lt', 'single', 'maybeSingle']) {
        query[name] = (...args) => { call.operations.push({ name, args: plain(args) }); return query; };
      }
      query.then = (resolve, reject) => Promise.resolve(table === 'profiles' && call.operations.some(op => op.name === 'single')
        ? { data: { ...user, role } } : respond(call)).then(resolve, reject);
      return query;
    },
    rpc: async (name, args) => { const call = { type: 'rpc', name, args: plain(args) }; calls.push(call); return respond(call); },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'book-pdfs');
        return {
          getPublicUrl(path, options) { return { data: { publicUrl: `https://storage.example/${path}${options?.download ? '?download=' : ''}` } }; },
          async upload(path, bytes, options) { calls.push({ type: 'upload', path, bytes: Buffer.from(bytes).toString(), options: plain(options) }); return { data: { path } }; },
          async remove(paths) { calls.push({ type: 'remove', paths: plain(paths) }); return { data: paths }; }
        };
      }
    }
  };
  const context = { window: { location: { origin: 'https://grimorio.example' } }, URL, atob, Uint8Array, crypto: { randomUUID: () => 'book-id' } };
  vm.runInNewContext(source, context);
  const adapter = context.window.createGrimorioSupabaseAdapter((_url, _key, options) => {
    assert.equal(options.auth.persistSession, true);
    assert.equal(options.auth.autoRefreshToken, true);
    return client;
  }, { url: 'https://project.supabase.co', publishableKey: 'publishable-test' });
  return { adapter, calls };
}

test('Supabase uses its current auth session and maps profiles without relying on the legacy token', async () => {
  const { adapter, calls } = harness();
  const actual = await adapter.request('/api/auth/me', { headers: { Authorization: 'Bearer stale-express-token' } });
  assert.equal(actual.user.accountCode, '00001234');
  assert.equal(actual.user.email, 'own@example.test');
  assert.ok(calls[0].operations.some(op => op.name === 'eq' && op.args[0] === 'id' && op.args[1] === 'own-user'));
  const signin = await adapter.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: ' OWN@example.test ', password: 'password' }) });
  assert.equal(signin.token, session.access_token);
  assert.equal(calls.find(call => call.type === 'signin').input.email, 'own@example.test');
});

test('email-confirmation signup never invents a session and guests get a login status for protected data', async () => {
  const { adapter } = harness({ authSession: null });
  const registered=await adapter.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username:'adventurer',birthDate:'2000-01-01',email: 'a@example.test', password: 'password' }) });
  assert.equal(registered.requiresConfirmation,true);
  assert.equal(registered.token,undefined);
  await assert.rejects(adapter.request('/api/sheets'), error => error.status === 401);
  assert.equal((await adapter.request('/api/content/permissions')).canManageContent, false);
});

test('public catalog uses Storage PDF paths for reading and downloads without login', async () => {
  const { adapter } = harness({ authSession: null, respond: () => ({ data: [{ id: 'book-id', title: 'Regras', cover_data: '', pdf_path: 'book-id.pdf' }] }) });
  const { books } = await adapter.request('/api/books');
  assert.equal(adapter.publicPdfUrl(books[0]), 'https://storage.example/book-id.pdf');
  assert.equal(adapter.publicPdfUrl('book-id', true), 'https://storage.example/book-id.pdf?download=');
  assert.throws(() => adapter.publicPdfUrl('missing'), /indisponível/);
});

test('PDF publication is admin-only and removes its own upload when metadata insert fails', async () => {
  const options = { method: 'POST', body: JSON.stringify({ title: 'Regras', pdfData: `data:application/pdf;base64,${Buffer.from('%PDF-1.7\nfixture').toString('base64')}` }) };
  const regular = harness();
  await assert.rejects(regular.adapter.request('/api/books', options), /Somente administradores/);
  assert.equal(regular.calls.some(call => call.type === 'upload'), false);
  const admin = harness({ role: 'admin', respond: call => call.table === 'books' ? { error: { message: 'insert failed' } } : { data: [] } });
  await assert.rejects(admin.adapter.request('/api/books', options), /insert failed/);
  assert.equal(admin.calls.find(call => call.type === 'upload').bytes, '%PDF-1.7\nfixture');
  assert.deepEqual(admin.calls.find(call => call.type === 'remove').paths, ['book-id.pdf']);
});

test('sheet writes stay scoped to the authenticated owner and preserve JSON data', async () => {
  const { adapter, calls } = harness({ respond: () => ({ data: { id: 'sheet-id', name: 'Aventureiro', data_json: { name: 'Aventureiro', story: 'História', layoutPositions: { identity: { x: 3 } } } } }) });
  const data = { name: 'Aventureiro', story: 'História', layoutPositions: { identity: { x: 3 } } };
  const saved = await adapter.request('/api/sheets/sheet-id', { method: 'PUT', body: JSON.stringify({ data, expectedVersion:3,user_id: 'attacker-selected-user' }) });
  assert.deepEqual(plain(saved.data), data);
  assert.ok(calls[0].operations.some(op => op.name === 'eq' && op.args[0] === 'user_id' && op.args[1] === 'own-user'));
  assert.deepEqual(calls.find(call=>call.type==='rpc').args,{p_sheet_id:'sheet-id',p_name:'Aventureiro',p_data:data,p_expected_version:3});
});

test('campaign and friend operations use database RPC contracts with names and account-code strings', async () => {
  const { adapter, calls } = harness({ respond: () => ({ data: { ok: true } }) });
  await adapter.request('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: '  Mundo  ' }) });
  await adapter.request('/api/campaigns/a1b2c3/join', { method: 'POST', body: JSON.stringify({ playerName: '  Mago  ' }) });
  await adapter.request('/api/friends', { method: 'POST', body: JSON.stringify({ accountCode: '00001234' }) });
  await assert.rejects(adapter.request('/api/friends', { method: 'POST', body: JSON.stringify({ accountCode: '000012345' }) }), /8 números/);
  assert.deepEqual(calls.map(({ name, args }) => ({ name, args })), [
    { name: 'create_campaign', args: { p_name: 'Mundo' } },
    { name: 'join_campaign', args: { p_code: 'A1B2C3', p_player_name: 'Mago' } },
    { name: 'add_friend', args: { p_code: '00001234' } }
  ]);
});

test('personal grimoire explicitly includes only owned and standard entries even for admins', async () => {
  const { adapter, calls } = harness({ role: 'admin' });
  await adapter.request('/api/grimoire');
  assert.ok(calls[0].operations.some(op => op.name === 'or' && op.args[0] === 'is_standard.eq.true,owner_user_id.eq.own-user'));
});
