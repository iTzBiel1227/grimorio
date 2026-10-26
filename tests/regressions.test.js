import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/campaigns.js', import.meta.url), 'utf8');
function harness(value, campaigns = []) {
  const nodes = new Map();
  for (const id of ['create','join','campaignName','code','player','campaigns','campaignTotal','campaignMasterTotal','campaignPlayerTotal','campaignSearch','refreshCampaigns','campaignStatus','createError','joinError','campaignInvites','campaignInviteInbox','campaignInviteCount','campaignInviteFeedback']) {
    nodes.set('#' + id, { value: '', classList: {toggle(){}}, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, setCustomValidity(message) { this.validation = message; }, reportValidity() { return !nodes.get('#campaignName').validation; }, querySelector() { return this.button ||= {}; } });
  }
  nodes.get('#campaignName').value = value;
  const calls = [];
  const context = { name: 'window.name is not the input', document: { querySelector: id => nodes.get(id), querySelectorAll: () => [] },window:{addEventListener(){}},setInterval(){return 1},clearInterval(){}, location: { search: '', href: '' }, URLSearchParams, alert: message => calls.push({ error: message }), Grimorio: { requireUser: async () => ({ id: 'tester' }), esc: String, api: async (url, options) => { calls.push({ url, options }); return url === '/api/my/campaigns' ? { campaigns } : { campaign: { code: 'ABC123' } }; } } };
  return { nodes, calls, context };
}
test('campaign creation reads and trims the field despite window.name', async () => {
  const h = harness('  As Cinzas do Reino  ');
  await vm.runInNewContext(source, h.context);
  await h.nodes.get('#create').listeners.submit({ preventDefault() {} });
  const request = h.calls.find(c => c.url === '/api/campaigns');
  assert.deepEqual(JSON.parse(request.options.body), { name: 'As Cinzas do Reino' });
  assert.equal(h.context.location.href, '/lobby.html?code=ABC123');
});
test('whitespace is rejected and editing clears the validation message', async () => {
  const h = harness('   ');
  await vm.runInNewContext(source, h.context);
  await h.nodes.get('#create').listeners.submit({ preventDefault() {} });
  assert.equal(h.calls.some(c => c.url === '/api/campaigns'), false);
  assert.ok(h.nodes.get('#campaignName').validation);
  h.nodes.get('#campaignName').listeners.input();
  assert.equal(h.nodes.get('#campaignName').validation, '');
});
test('all browser scripts and inline page scripts parse', () => {
  const root = new URL('../public/', import.meta.url);
  for (const file of readdirSync(root).filter(file => /\.(js|html)$/.test(file))) {
    const content = readFileSync(new URL(file, root), 'utf8');
    if (file.endsWith('.js')) new vm.Script(content, { filename: file });
    if (file.endsWith('.html')) for (const match of content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1], { filename: file });
  }
});


test('campaign search filters saved worlds without changing totals', async()=>{
 const h=harness('',[{name:'Cinzas',code:'AAA111',role:'master',status:'lobby'},{name:'Marés',code:'BBB222',role:'player',status:'session'}]);
 await vm.runInNewContext(source,h.context);
 assert.equal(h.nodes.get('#campaignTotal').textContent,2);
 assert.equal(h.nodes.get('#campaignMasterTotal').textContent,1);
 assert.match(h.nodes.get('#campaigns').innerHTML,/sessao.html\?code=BBB222/);
 h.nodes.get('#campaignSearch').value='cinzas';h.nodes.get('#campaignSearch').listeners.input();
 assert.match(h.nodes.get('#campaigns').innerHTML,/Cinzas/);
 assert.doesNotMatch(h.nodes.get('#campaigns').innerHTML,/BBB222/);
 assert.equal(h.nodes.get('#campaignTotal').textContent,2);
});
