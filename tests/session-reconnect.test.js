import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

class Element {
  constructor() {
    this.value = ''; this.textContent = ''; this.innerHTML = ''; this.options = [];
    this.children = []; this.nodes = new Map(); this.events = new Map();
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Element()); return this.nodes.get(selector); }
  querySelectorAll() { return []; }
  append(...elements) { this.children.push(...elements); }
  addEventListener(name, listener) { this.events.set(name, listener); }
  setAttribute(name, value) { this[name] = value; }
}

function harness({ connected = false, supabase = false } = {}) {
  const nodes = new Map(), listeners = new Map(), sent = [], delivered = [];
  let joinedRoom = null;
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  const socket = {
    connected,
    on(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); return socket; },
    emit(name, payload) {
      sent.push({ name, payload });
      if (name === 'room:join') joinedRoom = payload.code;
      if (name === 'room:leave') joinedRoom = null;
      return socket;
    },
    disconnect() { transport('disconnect'); }
  };
  function transport(name, payload) {
    if (name === 'disconnect') { socket.connected = false; joinedRoom = null; }
    if (name === 'connect') socket.connected = true;
    for (const listener of listeners.get(name) || []) listener(payload);
  }
  const context = {
    document: { querySelector: node, querySelectorAll: () => [], createElement: () => new Element(), addEventListener() {} },
    window: { addEventListener() {}, ...(supabase ? { GrimorioSupabase: {} } : {}) },
    location: { search: '?code=ABC123', origin: 'http://localhost' }, URLSearchParams,
    localStorage: { getItem: () => 'session-token' }, io: () => socket,
    GrimorioDice: { create: () => ({ play: roll => delivered.push(roll), destroy() {} }) },
    Grimorio: {
      currentUser: async () => ({ id: 'player', displayName: 'Aria' }), loginRedirect() {}, esc: String,
      api: async url => url === '/api/campaigns/ABC123' ? { role: 'player', campaign: { name: 'A Torre' } } : { sheets: [], members: [], rolls: [] }
    }
  };
  const sandbox = vm.createContext(context);
  return {
    node, socket, sent, delivered, transport,
    run: file => vm.runInContext(readFileSync(new URL('../public/' + file, import.meta.url), 'utf8'), sandbox),
    selectCampaign: code => vm.runInContext(`connectRollCampaign(${JSON.stringify(code)})`, sandbox),
    joins: () => sent.filter(event => event.name === 'room:join'),
    broadcast(code, roll) { if (joinedRoom === code) transport('dice:result', roll); }
  };
}

test('tabletop rejoins after transport loss and receives shared dice again without duplicate initial joins', async () => {
  const h = harness();
  await h.run('session.js');
  assert.equal(h.joins().length, 0, 'wait for the transport instead of buffering an initial join');
  h.transport('connect');
  assert.equal(h.joins().length, 1);
  const first = { id: 'first', value: 7, modifier: 4, total: 11, sides: 20 };
  h.broadcast('ABC123', first);
  assert.equal(h.delivered.length, 1);
  h.transport('disconnect');
  assert.equal(h.node('#tableConnection').textContent, 'RECONECTANDO');
  h.broadcast('ABC123', { ...first, id: 'missed' });
  assert.equal(h.delivered.length, 1);
  h.transport('connect');
  assert.equal(h.joins().length, 2);
  h.broadcast('ABC123', { ...first, id: 'after-reconnect' });
  assert.equal(h.delivered.at(-1).id, 'after-reconnect');
  assert.equal(h.joins().at(-1).payload.token, 'session-token');
});

test('tabletop starts an already connected socket and a Supabase compatibility channel exactly once', async () => {
  for (const options of [{ connected: true }, { supabase: true }]) {
    const h = harness(options);
    await h.run('session.js');
    assert.equal(h.joins().length, 1);
    assert.equal(h.joins()[0].payload.code, 'ABC123');
  }
});

test('sheet reconnect joins only its current campaign and leaving keeps it out of later connections', async () => {
  const h = harness();
  h.run('ficha.js');
  h.selectCampaign('ABC123');
  assert.equal(h.joins().length, 0);
  h.transport('connect');
  assert.equal(h.joins().length, 1);
  h.transport('room:state', {});
  assert.equal(h.node('#liveRollState').textContent, 'ao vivo');
  h.transport('disconnect');
  assert.equal(h.node('#liveRollState').textContent, 'reconectando…');
  h.selectCampaign('DEF456');
  assert.equal(h.joins().length, 1, 'do not buffer a stale campaign join while offline');
  h.transport('connect');
  assert.equal(h.joins().length, 2);
  assert.equal(h.joins().at(-1).payload.code, 'DEF456');
  h.transport('disconnect');
  h.selectCampaign('');
  h.transport('connect');
  assert.equal(h.joins().length, 2, 'a sheet set to local rolls must not rejoin a campaign');
});

test('sheet starts a Supabase channel without waiting for a Socket.IO connect event', () => {
  const h = harness({ supabase: true });
  h.run('ficha.js');
  h.selectCampaign('ABC123');
  assert.equal(h.joins().length, 1);
  assert.equal(h.joins()[0].payload.code, 'ABC123');
});
