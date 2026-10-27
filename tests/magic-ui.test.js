import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/magic-library.js', import.meta.url), 'utf8');
class Control {
  constructor() { this.value = ''; this.textContent = ''; this.innerHTML = ''; this.disabled = false; this.hidden = false; this.dataset = {}; this.files = []; this.events = {}; this.nodes = new Map(); this.attributes = {}; this.classList = { add() {}, remove() {}, toggle() {} }; }
  querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Control()); return this.nodes.get(selector); }
  querySelectorAll() { return []; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, handler) { this.events[key] = handler; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  contains() { return true; }
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
async function harness({ admin = false, user = null } = {}) {
  const host = new Control(), requests = [], state = { user, public: [], mine: [], redirects: 0 };
  state.public = [{ id: 'public-1', kind: 'spell', name: 'Explosão <de gelo>', description: 'Área congelante', damage: '2d8 + 4', imageData: 'data:image/png;base64,YQ==', isStandard: true }, { id: 'public-2', kind: 'ability', name: 'Esquiva', description: 'Defesa rápida', damage: '', imageData: '', isStandard: true }];
  state.mine = [{ id: 'mine-1', kind: 'spell', name: 'Faísca', description: 'Luz breve', damage: '1d4', imageData: 'data:image/webp;base64,Yg==', isStandard: false }];
  const scopeButtons = ['public', 'mine'].map(scope => Object.assign(new Control(), { dataset: { scope } }));
  const kindButtons = ['all', 'spell', 'ability'].map(kind => Object.assign(new Control(), { dataset: { kind } }));
  host.querySelectorAll = selector => selector === '[data-scope]' ? scopeButtons : selector === '[data-kind]' ? kindButtons : [];
  const form = host.querySelector('form'), fields = new Map();
  const field = name => { if (!fields.has(name)) fields.set(name, new Control()); return fields.get(name); };
  form.elements = { namedItem: field }; form.reset = () => fields.forEach(item => { item.value = ''; });
  form.querySelectorAll = () => [...fields.values()];
  const window = {};
  const context = { window, document: { getElementById: () => null }, confirm: () => true, Grimorio: {
    esc: escape, currentUser: async () => state.user, loginRedirect: () => state.redirects++,
    api: async (url, options = {}) => {
      requests.push({ url, ...options });
      if (options.method === 'POST' || options.method === 'PUT') return { entry: JSON.parse(options.body) };
      if (options.method === 'DELETE') return {};
      return { entries: url.endsWith('scope=mine') ? state.mine : state.public };
    }
  } };
  vm.runInNewContext(source, context);
  await window.GrimorioMagic.mount(host, { admin });
  const find = selector => host.querySelector(selector);
  const clickCard = dataset => find('[data-entries]').onclick({ target: { closest: () => ({ dataset, disabled: false }) } });
  return { host, find, state, requests, scopeButtons, kindButtons, field, form, clickCard, api: window.GrimorioMagic };
}

test('anonymous visitors see public powers; only personal actions request login', async () => {
  const h = await harness();
  assert.equal(h.requests[0].url, '/api/grimoire?scope=public');
  assert.equal(h.state.redirects, 0);
  assert.match(h.find('[data-entries]').innerHTML, /Explosão &lt;de gelo&gt;/);
  assert.doesNotMatch(h.find('[data-entries]').innerHTML, /data-edit=/);
  await h.scopeButtons[1].onclick();
  assert.equal(h.state.redirects, 1);
  assert.equal(h.requests.length, 1);
  await h.find('[data-new]').onclick();
  assert.equal(h.state.redirects, 2);
  assert.equal(h.find('.magic-editor').open, undefined);
});

test('library search matches accents, description and damage while keeping type filter', async () => {
  const h = await harness();
  h.find('[data-search]').value = 'congelante'; h.find('[data-search]').oninput();
  assert.match(h.find('[data-entries]').innerHTML, /Explosão/);
  assert.doesNotMatch(h.find('[data-entries]').innerHTML, /Esquiva/);
  h.find('[data-search]').value = '2D8'; h.find('[data-search]').oninput();
  assert.equal(h.find('[data-count]').textContent, '1 poder encontrado');
  h.find('[data-search]').value = 'explosao'; h.find('[data-search]').oninput();
  assert.equal(h.find('[data-count]').textContent, '1 poder encontrado');
  h.kindButtons[2].onclick(); assert.equal(h.find('[data-count]').textContent, '0 poderes encontrados');
});

test('personal edit preserves image, can remove it, and never writes to admin route', async () => {
  const h = await harness({ user: { id: 'self' } });
  await h.scopeButtons[1].onclick();
  assert.equal(h.requests.at(-1).url, '/api/grimoire?scope=mine');
  await h.clickCard({ edit: 'mine-1' });
  assert.equal(h.field('name').value, 'Faísca');
  assert.equal(h.find('[data-image-preview]').hidden, false);
  h.field('name').value = 'Faísca azul';
  await h.form.onsubmit({ preventDefault() {} });
  const edit = h.requests.find(request => request.method === 'PUT');
  assert.equal(edit.url, '/api/grimoire/mine-1');
  assert.equal(JSON.parse(edit.body).imageData, h.state.mine[0].imageData);
  assert.equal(JSON.parse(edit.body).name, 'Faísca azul');
  await h.clickCard({ edit: 'mine-1' }); h.find('[data-remove-image]').onclick();
  await h.form.onsubmit({ preventDefault() {} });
  assert.equal(JSON.parse(h.requests.filter(request => request.method === 'PUT').at(-1).body).imageData, '');
  assert.ok(h.requests.every(request => !request.url.startsWith('/api/admin/')));
});

test('administrative powers always use the public admin collection for create, edit and delete', async () => {
  const h = await harness({ admin: true, user: { role: 'admin' } });
  assert.equal(h.requests[0].url, '/api/admin/grimoire');
  await h.find('[data-new]').onclick();
  h.field('kind').value = 'ability'; h.field('name').value = 'Postura defensiva';
  await h.form.onsubmit({ preventDefault() {} });
  const create = h.requests.find(request => request.method === 'POST');
  assert.equal(create.url, '/api/admin/grimoire');
  assert.equal(JSON.parse(create.body).kind, 'ability');
  assert.equal(Object.hasOwn(JSON.parse(create.body), 'isStandard'), false);
  await h.clickCard({ edit: 'public-1' }); await h.form.onsubmit({ preventDefault() {} });
  assert.equal(h.requests.find(request => request.method === 'PUT').url, '/api/admin/grimoire/public-1');
  await h.clickCard({ delete: 'public-1' });
  assert.equal(h.requests.find(request => request.method === 'DELETE').url, '/api/admin/grimoire/public-1');
});

test('power images reject SVG, remote tracking URLs and oversized uploads', async () => {
  const h = await harness();
  assert.equal(h.api.safeImage('data:image/svg+xml;base64,YQ=='), '');
  assert.equal(h.api.safeImage('https://example.com/tracker.jpg'), '');
  assert.equal(h.api.safeImage('data:image/png;base64,YQ=='), 'data:image/png;base64,YQ==');
  await assert.rejects(h.api.readImage({ type: 'image/svg+xml', size: 10 }), /PNG, JPG ou WEBP/);
  await assert.rejects(h.api.readImage({ type: 'image/png', size: 3 * 1024 * 1024 + 1 }), /até 3 MB/);
});
