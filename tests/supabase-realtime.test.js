import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/supabase-realtime.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const calls = [];
  const events = [];
  const channels = [];
  let authListener;
  let currentCampaign = {
    id: 'campaign-one', code: 'ABC123', status: 'session', name: 'A mesa',
    state: { tokens: [{ id: 'token-one', x: 1, y: 1 }], rolls: [], notes: 'never expose shared notes' }
  };
  const memberships = [
    { user_id: 'user-one', player_name: 'Luna' },
    { user_id: 'user-two', player_name: 'Sol' }
  ];
  const messages = options.messages || [];
  const db = {
    campaign_members: memberships,
    profiles: [{ id: 'user-one', display_name: 'Luna' }, { id: 'user-two', display_name: 'Sol' }],
    campaign_notes: [{ campaign_id: 'campaign-one', notes: 'Notas privadas do mestre' }],
    campaign_messages: messages
  };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: options.signedOut ? null : { id: 'user-one' } }, error: null }),
      onAuthStateChange: callback => { authListener = callback; }
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      if (options.rpcError) return { error: typeof options.rpcError === 'string' ? { message: options.rpcError } : options.rpcError };
      if (name === 'get_campaign_hub') {
        const { state, ...summary } = currentCampaign;
        return { data: { campaign: summary, role: options.role || 'player' } };
      }
      if (name === 'get_campaign') return {
        data: {
          campaign: { ...currentCampaign, state: { ...currentCampaign.state } },
          role: options.role || 'player', playerName: 'Luna'
        }
      };
      if (name === 'roll_campaign_dice') {
        const roll = { id: 'roll-one', sides: args.p_sides, value: 12, modifier: args.p_modifier, total: 12 + args.p_modifier };
        currentCampaign = { ...currentCampaign, state: { ...currentCampaign.state, rolls: [roll] } };
        return { data: roll };
      }
      return { data: currentCampaign };
    },
    from(table) {
      const query = {
        table, filters: [], action: 'select', mode: 'many',
        select() { return this; },
        eq(key, value) { this.filters.push([key, value]); return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle() { this.mode = 'single'; return this; },
        single() { this.mode = 'single'; return this; },
        insert(value) { this.action = 'insert'; this.value = value; return this; },
        upsert(value) { this.action = 'upsert'; this.value = value; return this; },
        then(resolve, reject) {
          calls.push({ table, action: this.action, filters: this.filters, value: this.value });
          let rows = db[table] || [];
          if (this.action === 'insert') {
            rows = [{ id: `message-${messages.length + 1}`, created_at: '2026-01-01T00:00:01Z', ...this.value }];
            messages.push(rows[0]);
          } else if (this.action === 'upsert') {
            rows = [this.value];
          } else {
            rows = rows.filter(row => this.filters.every(([key, value]) => row[key] === undefined || row[key] === value));
          }
          return Promise.resolve({ data: this.mode === 'single' ? rows[0] || null : rows, error: null }).then(resolve, reject);
        }
      };
      return query;
    },
    channel(topic, configuration) {
      const channel = {
        topic, configuration, listeners: [], online: { 'user-one': [{}], 'user-two': [{}], outsider: [{}] },
        on(type, filter, callback) { this.listeners.push({ type, filter, callback }); return this; },
        subscribe(callback) { this.status = callback; queueMicrotask(() => callback('SUBSCRIBED')); return this; },
        async track(value) { this.tracked = value; this.fire('presence', 'sync'); },
        presenceState() { return this.online; },
        fire(type, table, payload) {
          for (const item of this.listeners) {
            if (item.type === type && (item.filter.table === table || item.filter.event === table)) item.callback(payload);
          }
        }
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { channel.removed = true; }
  };
  const window = { GrimorioSupabase: { client }, addEventListener() {} };
  vm.runInNewContext(source, { window });
  const socket = window.io();
  for (const name of ['app:error', 'room:state', 'room:players', 'dice:result', 'session:message', 'campaign:updated', 'disconnect']) {
    socket.on(name, value => events.push({ name, value }));
  }
  return {
    socket, calls, channels, events,
    auth(event) { authListener(event); },
    changeCampaign(value) { currentCampaign = { ...currentCampaign, ...value }; },
    failRpc(error) { options.rpcError = error; },
    async join(payload = {}) { socket.emit('room:join', { code: 'abc123', ...payload }); await settle(); }
  };
}

test('realtime requires an authenticated campaign member before opening a private channel', async () => {
  for (const options of [{ signedOut: true }, { role: 'guest' }]) {
    const h = harness(options);
    await h.join();
    assert.equal(h.channels.length, 0);
    assert.ok(h.events.some(event => event.name === 'app:error'));
  }
  const h = harness();
  await h.join();
  assert.equal(h.channels[0].topic, 'campaign:campaign-one');
  assert.equal(h.channels[0].configuration.config.private, true);
  assert.equal(h.channels[0].configuration.config.presence.key, 'user-one');
  assert.equal(h.socket.id, 'user-one');
  const players = h.events.filter(event => event.name === 'room:players').at(-1).value;
  assert.equal(players.length, 2);
  assert.equal(players.some(player => player.id === 'outsider'), false);
});

test('master notes never enter shared state and are read and saved only by the owner', async () => {
  const member = harness();
  await member.join();
  for (const event of member.events.filter(event => event.name === 'room:state')) {
    assert.equal(Object.hasOwn(event.value.campaign.state, 'notes'), false);
  }
  member.socket.emit('master:save-notes', { notes: 'not allowed' });
  await settle();
  assert.equal(member.calls.some(call => call.table === 'campaign_notes'), false);
  assert.ok(member.events.some(event => event.name === 'app:error'));

  const owner = harness({ role: 'master' });
  await owner.join();
  assert.equal(owner.events.find(event => event.name === 'room:state').value.campaign.state.notes, 'Notas privadas do mestre');
  owner.socket.emit('master:save-notes', { notes: 'Nova anotação' });
  await settle();
  assert.equal(owner.events.filter(event => event.name === 'room:state').at(-1).value.campaign.state.notes, 'Nova anotação');
});

test('private chat rejects outsiders and unrelated private messages are not rendered', async () => {
  const h = harness();
  await h.join();
  h.socket.emit('session:chat', { body: 'segredo', recipientSocketId: 'outsider' });
  await settle();
  assert.equal(h.calls.some(call => call.action === 'insert'), false);
  assert.ok(h.events.some(event => event.name === 'app:error'));

  h.socket.emit('session:chat', { body: ' segredo ', recipientSocketId: 'user-two' });
  await settle();
  const insert = h.calls.find(call => call.action === 'insert');
  assert.equal(insert.value.sender_user_id, 'user-one');
  assert.equal(insert.value.recipient_user_id, 'user-two');
  assert.equal(insert.value.campaign_id, 'campaign-one');
  assert.equal(insert.value.body, 'segredo');
  assert.equal(h.events.filter(event => event.name === 'session:message').length, 1);
  h.channels[0].fire('postgres_changes', 'campaign_messages', { new: {
    id: 'hidden', campaign_id: 'campaign-one', sender_user_id: 'user-two', recipient_user_id: 'outsider', body: 'private'
  } });
  await settle();
  assert.equal(h.events.filter(event => event.name === 'session:message').length, 1);
});

test('dice rolls use the authenticated RPC and are not duplicated by realtime updates', async () => {
  const h = harness();
  await h.join();
  h.socket.emit('dice:roll', { sides: 20, modifier: 900, label: 'Teste', characterName: 'Luna' });
  await settle();
  const call = h.calls.find(call => call.rpc === 'roll_campaign_dice');
  assert.equal(call.args.p_modifier, 100);
  assert.equal(call.args.p_code, 'ABC123');
  assert.equal(h.events.filter(event => event.name === 'dice:result').length, 1);
  h.channels[0].fire('postgres_changes', 'campaigns', { new: {} });
  await settle();
  assert.equal(h.events.filter(event => event.name === 'dice:result').length, 1);
});

test('leaving or signing out prevents old campaign events from rendering', async () => {
  const h = harness();
  await h.join();
  const old = h.channels[0];
  h.socket.emit('room:leave');
  await settle();
  assert.equal(old.removed, true);
  const count = h.events.length;
  old.fire('postgres_changes', 'campaign_messages', { new: {
    id: 'late', campaign_id: 'campaign-one', sender_user_id: 'user-two', body: 'late'
  } });
  old.fire('postgres_changes', 'campaigns', { new: {} });
  await settle();
  assert.equal(h.events.length, count);
  assert.equal(h.socket.connected, false);
  await h.join();
  h.auth('SIGNED_OUT');
  assert.equal(h.socket.connected, false);
  assert.equal(h.channels[1].removed, true);
});

test('history and a matching live insert render only one message', async () => {
  const message = { id: 'history-one', campaign_id: 'campaign-one', sender_user_id: 'user-two', recipient_user_id: null, body: 'Olá', created_at: '2026-01-01T00:00:00Z' };
  const h = harness({ messages: [message] });
  await h.join();
  h.channels[0].fire('postgres_changes', 'campaign_messages', { new: message });
  await settle();
  assert.equal(h.events.filter(event => event.name === 'session:message').length, 1);
});

test('hub reuses one authorized channel without fetching notes, chat history or dice subscriptions', async () => {
  const h = harness({ role: 'master' });
  await h.join({ view: 'hub' });
  assert.equal(h.channels.length, 1);
  assert.equal(h.calls.some(call => ['campaign_notes', 'campaign_messages'].includes(call.table)), false);
  assert.ok(h.calls.some(call => call.rpc === 'get_campaign_hub'));
  assert.equal(h.calls.some(call => call.rpc === 'get_campaign'), false, 'Hub refreshes never download tabletop state or roll history');
  const state = h.events.find(event => event.name === 'room:state').value.campaign.state;
  assert.equal(state.tokens.length, 0);
  assert.equal(state.rolls.length, 0);
  assert.equal(Object.hasOwn(state, 'notes'), false);
  assert.equal(h.channels[0].listeners.some(item => ['campaign_messages', 'campaign_rolls'].includes(item.filter.table)), false);
  h.changeCampaign({ name: 'Campanha atualizada' });
  h.channels[0].fire('postgres_changes', 'campaigns', { new: {} });
  await settle();
  assert.equal(h.events.filter(event => event.name === 'room:state').at(-1).value.campaign.name, 'Campanha atualizada');
  assert.ok(h.events.some(event => event.name === 'campaign:updated'));
  h.channels[0].status('CHANNEL_ERROR');
  assert.equal(h.socket.connected, false);
  assert.ok(h.events.some(event => event.name === 'disconnect'));
  h.socket.disconnect();
  assert.equal(h.channels[0].removed, true);
});

test('hub realtime leaves its private channel when membership is revoked', async () => {
  const h = harness();
  await h.join({ view: 'hub' });
  h.failRpc({ code: '42501', message: 'Campanha não encontrada ou acesso não permitido.' });
  h.channels[0].fire('postgres_changes', 'campaigns', { new: {} });
  await settle();
  assert.equal(h.socket.connected, false);
  assert.equal(h.channels[0].removed, true);
  assert.ok(h.events.some(event => event.name === 'app:error'));
});
