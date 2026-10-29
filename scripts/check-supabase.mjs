import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

// Read-only check of the actual public API. No account or document is created.
const { url, publishableKey } = JSON.parse(await readFile(new URL('../supabase/frontend.json', import.meta.url), 'utf8'));
const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
const [books, feature, profiles, campaign, powers] = await Promise.all([
  client.from('books').select('id', { count: 'exact', head: true }),
  client.from('site_settings').select('value').eq('key', 'home_feature').single(),
  client.from('profiles').select('id').limit(1),
  client.rpc('get_campaign', { p_code: '000000' }),
  client.from('grimoire_entries').select('id,is_standard').limit(100),
]);
assert.ifError(books.error);
assert.ifError(feature.error);
assert.equal(typeof feature.data.value.imageData, 'string');
assert.ok(profiles.error, 'Anonymous visitors must not read profiles');
assert.ok(campaign.error, 'Anonymous visitors must not call campaign RPCs');
assert.equal(profiles.error.code, '42501');
assert.equal(campaign.error.code, '42501');
assert.ifError(powers.error);
assert.ok(powers.data.every(power=>power.is_standard), 'Anonymous readers must never see personal powers');
// A missing migration returns PGRST202/42P01, not a permission error. Check
// the new endpoints without creating accounts or changing campaign data.
const hubChecks = await Promise.all([
  client.rpc('get_campaign_hub', { p_code: '000000' }),
  client.rpc('update_campaign_hub', { p_code: '000000', p_patch: {} }),
  client.rpc('start_campaign_session', { p_code: '000000', p_title: '' }),
  client.rpc('end_campaign_session', { p_code: '000000' }),
  client.from('campaign_sessions').select('id').limit(1),
]);
for (const result of hubChecks) {
  assert.ok(result.error, 'Anonymous visitors must not access the campaign hub or sessions');
  assert.equal(result.error.code, '42501', 'The campaign hub migration must be installed and deny anonymous access');
}
console.log('Supabase remoto: catálogo, anúncio e biblioteca pública acessíveis; perfis, magias pessoais, Hub e sessões de campanha protegidos.');
