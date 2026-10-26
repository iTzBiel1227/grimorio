import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
class Control {
  constructor() { this.value = ''; this.textContent = ''; this.innerHTML = ''; this.disabled = false; this.hidden = false; this.events = {}; this.nodes = new Map(); }
  querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Control()); return this.nodes.get(selector); }
  addEventListener(event, handler) { this.events[event] = handler; }
  setAttribute(key, value) { this[key] = value; }
  removeAttribute(key) { delete this[key]; }
  setCustomValidity(value) { this.validation = value; }
  reportValidity() { return true; }
  focus() { this.focused = true; }
}
const controls = () => { const nodes = new Map(); const el = id => { if (!nodes.has(id)) nodes.set(id, new Control()); return nodes.get(id); }; return { nodes, el }; };
const escaping = value => String(value || '').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function friendHarness() {
  const { nodes, el } = controls();
  const person = { id: 'target', displayName: '<Morgana>', username: 'morgana', accountCode: '12345678' };
  const state = { friends: [], incomingRequests: [], outgoingRequests: [] }, requests = [];
  const context = {
    document: { getElementById: el }, window: { addEventListener() {} }, setInterval() { return 1; }, clearInterval() {},
    Grimorio: {
      requireUser: async () => ({ id: 'self', accountCode: '87654321', username: 'merlin' }), esc: escaping, avatar: () => '<span>avatar</span>',
      api: async (url, options = {}) => {
        requests.push({ url, ...options });
        if (url === '/api/friends' && options.method === 'POST') { state.outgoingRequests.push({ id: 'request-1', person }); return { request: state.outgoingRequests[0] }; }
        if (url === '/api/friends') return state;
        if (url.startsWith('/api/users/search')) return { users: [person] };
        if (url.endsWith('/accept')) { state.friends.push(person); state.incomingRequests = []; return {}; }
        if (url === '/api/friends/target') { state.friends = []; return {}; }
        if (url === '/api/friend-requests/request-1') { state.outgoingRequests = []; return {}; }
        return {};
      }
    }
  };
  el('searchSection').hidden = true;
  await vm.runInNewContext(source('friends.js'), context);
  const click = async (section, dataset) => { const button = { dataset, disabled: false, textContent: 'Action' }; await el(section).onclick({ target: { closest: () => button } }); };
  return { nodes, el, state, requests, person, click };
}

test('sending friendship waits for acceptance and cancellation does not create a friend', async () => {
  const h = await friendHarness();
  h.el('friendQuery').value = '12345678';
  await h.el('friendSearchForm').onsubmit({ preventDefault() {}, currentTarget: h.el('friendSearchForm') });
  assert.match(h.el('searchResults').innerHTML, /Solicitar amizade/);
  assert.match(h.el('searchResults').innerHTML, /&lt;Morgana&gt;/);
  await h.click('searchResults', { add: '12345678' });
  assert.equal(h.state.friends.length, 0);
  assert.equal(h.el('friendCount').textContent, 0);
  assert.match(h.el('outgoingRequests').innerHTML, /Aguardando resposta/);
  assert.match(h.el('searchResults').innerHTML, /Solicitação enviada/);
  await h.click('outgoingRequests', { cancel: 'request-1' });
  assert.equal(h.state.outgoingRequests.length, 0);
  assert.match(h.el('searchResults').innerHTML, /Solicitar amizade/);
});

test('accepting incoming request and removing friendship refresh both lists', async () => {
  const h = await friendHarness();
  h.state.incomingRequests.push({ id: 'request-2', person: h.person });
  await h.el('refreshFriends').onclick();
  assert.match(h.el('incomingRequests').innerHTML, /Aceitar/);
  await h.click('incomingRequests', { accept: 'request-2' });
  assert.equal(h.el('friendCount').textContent, 1);
  assert.equal(h.el('incomingCount').textContent, 0);
  assert.match(h.el('friends').innerHTML, /Desfazer amizade/);
  await h.click('friends', { remove: 'target' });
  assert.equal(h.el('friendCount').textContent, 0);
  assert.ok(h.requests.some(request => request.method === 'DELETE' && request.url === '/api/friends/target'));
});

async function registrationHarness(result) {
  const { el } = controls(), requests = [], tokens = [];
  const context = { document: { getElementById: el }, location: { href: '' }, localStorage: { setItem: (...args) => tokens.push(args) }, Grimorio: { AUTH_KEY: 'token', currentUser: async () => null, api: async (url, options) => { requests.push({ url, ...options }); return result; } } };
  el('registrationSuccess').hidden = true;
  await vm.runInNewContext(source('cadastro.js'), context);
  el('registrationUsername').value = '  MORGANA_1  ';
  el('registrationEmail').value = ' player@example.com ';
  el('registrationPassword').value = 'secret-pass';
  el('registrationBirthDate').value = '1999-04-22';
  el('registrationForm').reportValidity = () => !el('registrationUsername').validation && !el('registrationBirthDate').validation;
  return { el, requests, tokens, context, submit: () => el('registrationForm').onsubmit({ preventDefault() {} }) };
}

test('dedicated signup sends distinct identity fields and explains email confirmation without false login', async () => {
  const h = await registrationHarness({ requiresConfirmation: true, email: 'player@example.com' });
  await h.submit();
  assert.deepEqual(JSON.parse(h.requests[0].body), { username: 'morgana_1', email: 'player@example.com', password: 'secret-pass', birthDate: '1999-04-22' });
  assert.equal(h.el('registrationSuccess').hidden, false);
  assert.equal(h.el('registrationForm').hidden, true);
  assert.equal(h.el('registrationSuccessEmail').textContent, 'player@example.com');
  assert.equal(h.context.location.href, '');
  assert.equal(h.tokens.length, 0);
});

test('signup rejects invalid username or future birth date and redirects when authenticated', async () => {
  const h = await registrationHarness({ user: { id: 'new' }, token: 'new-session' });
  h.el('registrationUsername').value = 'nome com espaço';
  await h.submit();
  assert.equal(h.requests.length, 0);
  h.el('registrationUsername').value = 'morgana';
  h.el('registrationBirthDate').value = '2999-01-01';
  await h.submit();
  assert.equal(h.requests.length, 0);
  h.el('registrationBirthDate').value = '1999-01-01';
  await h.submit();
  assert.equal(h.context.location.href, '/');
  assert.deepEqual(h.tokens, [['token', 'new-session']]);
});
