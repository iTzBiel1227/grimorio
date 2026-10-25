import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

// Read-only check of the actual public API. No account or document is created.
const { url, publishableKey } = JSON.parse(await readFile(new URL('../supabase/frontend.json', import.meta.url), 'utf8'));
const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const [books, feature, profiles, campaign] = await Promise.all([
  client.from('books').select('id', { count: 'exact', head: true }),
  client.from('site_settings').select('value').eq('key', 'home_feature').single(),
  client.from('profiles').select('id').limit(1),
  client.rpc('get_campaign', { p_code: '000000' }),
]);
assert.ifError(books.error);
assert.ifError(feature.error);
assert.equal(typeof feature.data.value.imageData, 'string');
assert.ok(profiles.error, 'Anonymous visitors must not read profiles');
assert.ok(campaign.error, 'Anonymous visitors must not call campaign RPCs');
assert.equal(profiles.error.code, '42501');
assert.equal(campaign.error.code, '42501');
console.log('Supabase remoto: catálogo e anúncio públicos acessíveis; perfis e campanhas protegidos.');
