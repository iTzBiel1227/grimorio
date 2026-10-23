import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/shell.js', import.meta.url), 'utf8');

// These lightweight controls exercise the handlers without a browser dependency.
// Layout, native focus trapping and actual image decoding require browser QA.
class Control {
  constructor() {
    this.nodes = new Map();
    this.events = {};
    this.value = '';
    this.disabled = false;
    this.innerHTML = '';
    this.textContent = '';
  }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Control());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return [...this.nodes.values()]; }
  setAttribute(key, value) { this[key] = value; }
  removeAttribute(key) { delete this[key]; }
  addEventListener(type, handler) { this.events[type] = handler; }
  setCustomValidity(value) { this.validation = value; }
  reportValidity() { return !this.validation; }
  append() {}
  prepend(node) { this.header = node; }
  showModal() { this.open = true; }
  close() { this.open = false; this.events.close?.(); }
  focus() {}
}

async function harness({ loggedIn = true, search = '' } = {}) {
  const main = new Control();
  const dialogs = [], requests = [], changes = [];
  const state = {
    user: { id: 'profile-test', displayName: 'Antes', email: 'profile@example.com', avatarData: '' },
    rejectSave: false,
  };
  const context = {
    document: { head: new Control(), body: { append: dialog => dialogs.push(dialog) }, querySelector: () => main, createElement: () => new Control() },
    window: { dispatchEvent: event => changes.push(event) },
    localStorage: { getItem: () => loggedIn ? 'test-token' : null, setItem() {}, removeItem() {} },
    URLSearchParams, location: {pathname:'/', search, href:'', reload(){}},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (!loggedIn) return { ok: false, status: 401, json: async () => ({ error: 'Faça login.' }) };
      if (url === '/api/profile') {
        if (state.rejectSave) return { ok: false, status: 400, json: async () => ({ error: 'Erro simulado' }) };
        state.user = { ...state.user, ...JSON.parse(options.body) };
      }
      return { ok: true, status: 200, json: async () => ({ user: state.user }) };
    },
    FileReader: class { readAsDataURL(file) { this.result = file.data; this.onload(); } },
    Image: class { set src(value) { if (value.includes('INVALID')) this.onerror(); else this.onload(); } },
  };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  const [login, profile] = dialogs;
  const header = main.header;
  const name = profile.querySelector('#accountDisplayName');
  const form = profile.querySelector('form');
  form.reportValidity = () => !name.validation && Boolean(name.value);
  return {
    state, requests, changes, login, profile, header, name, form, context,
    button: header.querySelector('#accountProfile'),
    photo: profile.querySelector('#accountAvatarInput'),
    error: profile.querySelector('#accountProfileError'),
    submit: () => form.onsubmit({ preventDefault() {} }),
  };
}

test('shared account helpers coexist with character sheet globals', () => {
  const context = { window: {}, document: { querySelector: () => null } };
  vm.runInNewContext('let currentUser = null; function api() {} function esc() {}\n' + source, context);
  assert.equal(typeof context.window.Grimorio.api, 'function');
  assert.equal(vm.runInNewContext('currentUser', context), null);
});

test('login stays closed until explicitly clicked and profile is unavailable to guests', async () => {
  const h = await harness({ loggedIn: false });
  assert.ok(!h.login.open);
  assert.equal(h.button.hidden, true);
  assert.equal(h.header.querySelector('#accountLogin').hidden, false);
  h.header.querySelector('#accountLogin').onclick();
  assert.equal(h.login.open, true);
  h.login.querySelector('.modal-close').onclick();
  assert.equal(h.login.open, false);
});

test('cancel discards profile edits and whitespace names are not sent', async () => {
  const h = await harness();
  h.button.onclick();
  h.name.value = 'Cancelado';
  h.profile.querySelector('[data-profile-cancel]').onclick();
  h.button.onclick();
  assert.equal(h.name.value, 'Antes');
  h.name.value = '   ';
  await h.submit();
  assert.equal(h.requests.filter(request => request.url === '/api/profile').length, 0);
  assert.ok(h.name.validation);
  h.name.value = 'Válido';
  h.name.oninput();
  assert.equal(h.name.validation, '');
});

test('saving name and avatar persists with authentication and updates the header immediately', async () => {
  const h = await harness();
  h.button.onclick();
  h.name.value = '  Novo nome  ';
  h.photo.files = [{ type: 'image/png', size: 10, data: 'data:image/png;base64,TEST' }];
  await h.photo.onchange();
  await h.submit();
  const request = h.requests.find(item => item.url === '/api/profile');
  assert.equal(request.options.method, 'PUT');
  assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  assert.equal(h.state.user.displayName, 'Novo nome');
  assert.equal(h.state.user.avatarData, 'data:image/png;base64,TEST');
  assert.match(h.button.innerHTML, /Novo nome/);
  assert.match(h.button.innerHTML, /data:image\/png;base64,TEST/);
  assert.equal(h.profile.open, false);
  assert.equal(h.changes[0].type, 'grimorio:profile-updated');
  h.button.onclick();
  h.profile.querySelector('#accountRemoveAvatar').onclick();
  await h.submit();
  assert.equal(h.state.user.avatarData, '');
});

test('unsupported, oversized and undecodable images are rejected without changing the avatar', async () => {
  const h = await harness();
  h.button.onclick();
  h.photo.files = [{ type: 'text/plain', size: 1 }];
  await h.photo.onchange();
  assert.match(h.error.textContent, /PNG/);
  h.photo.files = [{ type: 'image/png', size: 4_000_000 }];
  await h.photo.onchange();
  assert.match(h.error.textContent, /grande/);
  h.photo.files = [{ type: 'image/png', size: 10, data: 'data:image/png;base64,INVALID' }];
  await h.photo.onchange();
  assert.match(h.error.textContent, /válida/);
  await h.submit();
  assert.equal(h.state.user.avatarData, '');
});

test('failed profile save preserves the dialog and reenables a successful retry', async () => {
  const h = await harness();
  h.button.onclick();
  h.state.rejectSave = true;
  h.name.value = 'Novo nome';
  await h.submit();
  assert.equal(h.error.textContent, 'Erro simulado');
  assert.equal(h.profile.open, true);
  assert.equal(h.profile.querySelector('#accountSaveProfile').disabled, false);
  assert.equal(h.state.user.displayName, 'Antes');
  h.state.rejectSave = false;
  await h.submit();
  assert.equal(h.state.user.displayName, 'Novo nome');
  assert.equal(h.profile.open, false);
});


test('protected-page login opens automatically and preserves the destination', async () => {
  const h = await harness({loggedIn:false,search:'?login=1&next=%2Fcampanha.html%3Froom%3DABC123'});
  assert.equal(h.login.open,true);
  h.context.location.pathname='/ficha.html';h.context.location.search='?campaign=ABC123';
  assert.equal(await h.context.window.Grimorio.requireUser(),null);
  assert.equal(h.context.location.href,'/?login=1&next=%2Fficha.html%3Fcampaign%3DABC123');
});
test('login returns to internal destination and rejects external destinations', async () => {
  for(const [next,expected] of [['/campanha.html?room=ABC123','/campanha.html?room=ABC123'],['https://example.com',''],['//example.com','']]) {
    const h=await harness({search:'?login=1&next='+encodeURIComponent(next)});
    h.login.querySelector('form').onsubmit({preventDefault(){}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.context.location.href,expected);
  }
});
