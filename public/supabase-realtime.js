(function (root) {
  'use strict';

  // The pages keep their existing event API; Supabase authorizes every room,
  // state mutation and private message with the signed-in user's JWT and RLS.
  function createSocket(client) {
    const listeners = new Map();
    let channel = null;
    let generation = 0;
    let campaign = null;
    let role = '';
    let user = null;
    let notes = '';
    let members = new Map();
    let players = [];
    let seenRolls = new Set();
    let seenMessages = new Set();
    let historyReady = false;
    let bufferedMessages = [];
    let operations = Promise.resolve();
    let refreshes = Promise.resolve();
    let leaving = Promise.resolve();

    const socket = {
      id: null,
      connected: false,
      on(event, callback) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(callback);
        return socket;
      },
      off(event, callback) {
        if (callback) listeners.get(event)?.delete(callback);
        else listeners.delete(event);
        return socket;
      },
      emit(event, payload = {}) {
        operations = operations.then(() => handle(event, payload)).catch(report);
        return socket;
      },
      connect() { return socket; },
      disconnect() {
        generation++;
        socket.connected = false;
        campaign = null;
        players = [];
        const previous = channel;
        channel = null;
        if (previous) leaving = client.removeChannel(previous).catch(report);
        return socket;
      }
    };

    function dispatch(event, value) {
      for (const callback of listeners.get(event) || []) callback(value);
    }
    function report(error) {
      dispatch('app:error', error?.message || 'Não foi possível atualizar a mesa. Tente novamente.');
    }
    async function checked(request) {
      const result = await request;
      if (result.error) throw result.error;
      return result.data;
    }
    function isCurrent(version) { return version === generation && campaign !== null; }
    function statePayload() {
      return {
        campaign: {
          ...campaign,
          state: { ...campaign.state, ...(role === 'master' ? { notes } : {}) }
        },
        players
      };
    }
    function applyCampaign(next, initial = false) {
      const wasStarted = campaign?.status === 'session';
      campaign = { ...next, state: { tokens: [], rolls: [], ...next.state } };
      // Notes must never arrive through the shared campaign JSON.
      delete campaign.state.notes;
      const rolls = campaign.state.rolls || [];
      if (!initial) {
        for (const roll of [...rolls].reverse()) {
          if (!seenRolls.has(roll.id)) dispatch('dice:result', roll);
        }
      }
      for (const roll of rolls) seenRolls.add(roll.id);
      while (seenRolls.size > 1000) seenRolls.delete(seenRolls.values().next().value);
      dispatch('room:state', statePayload());
      if (!initial && !wasStarted && campaign.status === 'session') {
        dispatch('campaign:started', { code: campaign.code });
      }
    }
    function refreshCampaign(version) {
      refreshes = refreshes.then(async () => {
        if (!isCurrent(version)) return;
        const info = await checked(client.rpc('get_campaign', { p_code: campaign.code }));
        if (!isCurrent(version)) return;
        if (info.role === 'guest') {
          report(Error('Sua conta não participa mais desta campanha.'));
          socket.disconnect();
          return;
        }
        role = info.role;
        applyCampaign(info.campaign);
      }).catch(error => { if (version === generation) report(error); });
      return refreshes;
    }
    async function loadMembers(version) {
      if (!isCurrent(version)) return;
      const rows = await checked(client.from('campaign_members')
        .select('user_id,player_name').eq('campaign_id', campaign.id));
      if (!isCurrent(version)) return;
      const ids = [...new Set([user.id, ...rows.map(row => row.user_id)])];
      const profiles = await checked(client.from('profiles')
        .select('id,display_name').in('id', ids));
      if (!isCurrent(version)) return;
      const names = new Map(profiles.map(profile => [profile.id, profile.display_name]));
      members = new Map(rows.map(row => [row.user_id, {
        id: row.user_id,
        userId: row.user_id,
        name: row.player_name || names.get(row.user_id) || 'Aventureiro'
      }]));
      if (role === 'master') members.set(user.id, { id: user.id, userId: user.id, name: 'Mestre' });
      updatePresence(version);
      dispatch('sheet:list-changed');
      dispatch('campaign:members-changed');
    }
    async function receiveSheet(marker, version) {
      if (!isCurrent(version) || !marker?.sheet_id) return;
      const row = await checked(client.from('character_sheets').select('*').eq('id',marker.sheet_id).maybeSingle());
      if (!isCurrent(version) || !row || !members.has(row.user_id)) return;
      if (role !== 'master' && row.user_id !== user.id) {
        const assignment = await checked(client.from('campaign_sheet_assignments').select('sheet_id').eq('campaign_id',campaign.id).eq('sheet_id',row.id).eq('assigned_user_id',user.id).maybeSingle());
        if (!assignment || !isCurrent(version)) return;
      }
      dispatch('sheet:updated',{id:row.id,userId:row.user_id,name:row.name,data:row.data_json,folderId:row.folder_id,version:row.version,updatedAt:row.updated_at});
      dispatch('sheet:list-changed');
    }
    function receiveRoll(row, version) {
      if (!isCurrent(version) || row?.campaign_id!==campaign.id || seenRolls.has(row.id)) return;
      seenRolls.add(row.id);
      dispatch('dice:result',{id:row.id,player:row.player_name,characterName:row.character_name,label:row.label,sides:row.sides,value:row.value,modifier:row.modifier,total:row.total,seed:row.animation_seed,at:row.created_at,createdAt:row.created_at});
    }
    function updatePresence(version) {
      if (!isCurrent(version) || !channel) return;
      // Resolve names from authorized membership rows, not arbitrary presence data.
      const online = Object.keys(channel.presenceState());
      players = online.map(id => members.get(id)).filter(Boolean);
      dispatch('room:players', players);
    }
    async function displayMessage(message, version) {
      if (!isCurrent(version) || message.campaign_id !== campaign.id || seenMessages.has(message.id)) return;
      // RLS also enforces this, but do not display a private message from an
      // unexpected realtime payload even if the transport is misconfigured.
      if (message.recipient_user_id && message.sender_user_id !== user.id && message.recipient_user_id !== user.id) return;
      seenMessages.add(message.id);
      let sender = members.get(message.sender_user_id)?.name;
      if (!sender) {
        const profile = await checked(client.from('profiles').select('display_name')
          .eq('id', message.sender_user_id).maybeSingle());
        sender = profile?.display_name || 'Aventureiro';
      }
      if (!isCurrent(version)) return;
      dispatch('session:message', {
        id: message.id,
        sender,
        body: message.body,
        at: message.created_at,
        private: Boolean(message.recipient_user_id)
      });
    }
    function receiveMessage(message, version) {
      if (!isCurrent(version)) return;
      if (!historyReady) bufferedMessages.push(message);
      else displayMessage(message, version).catch(report);
    }
    async function loadHistory(version) {
      const rows = await checked(client.from('campaign_messages').select('*')
        .eq('campaign_id', campaign.id).order('created_at', { ascending: false }).limit(100));
      if (!isCurrent(version)) return;
      const messages = [...rows, ...bufferedMessages]
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      bufferedMessages = [];
      for (const message of messages) await displayMessage(message, version);
      if (!isCurrent(version)) return;
      historyReady = true;
      const remaining = bufferedMessages;
      bufferedMessages = [];
      for (const message of remaining) await displayMessage(message, version);
    }
    async function join(payload) {
      const code = String(payload.code || '').trim().toUpperCase();
      if (!code) throw Error('Informe o código da campanha.');
      socket.disconnect();
      const version = generation;
      await leaving;
      const auth = await client.auth.getUser();
      if (auth.error) throw auth.error;
      user = auth.data?.user;
      if (!user) throw Error('Entre na sua conta para participar da mesa.');
      if (version !== generation) return;
      const info = await checked(client.rpc('get_campaign', { p_code: code }));
      if (version !== generation) return;
      if (!info?.campaign || info.role === 'guest') {
        throw Error('Entre na campanha pela página de campanhas antes de abrir a mesa.');
      }
      socket.id = user.id;
      role = info.role;
      campaign = info.campaign;
      notes = '';
      seenRolls = new Set();
      seenMessages = new Set();
      historyReady = false;
      bufferedMessages = [];
      await loadMembers(version);
      if (!isCurrent(version)) return;
      if (role === 'master') {
        const row = await checked(client.from('campaign_notes').select('notes')
          .eq('campaign_id', campaign.id).maybeSingle());
        if (!isCurrent(version)) return;
        notes = row?.notes || '';
      }
      applyCampaign(info.campaign, true);
      channel = client.channel(`campaign:${campaign.id}`, {
        config: { private: true, presence: { key: user.id } }
      });
      const currentChannel = channel;
      channel
        .on('presence', { event: 'sync' }, () => updatePresence(version))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaign.id}` },
          () => refreshCampaign(version))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_members', filter: `campaign_id=eq.${campaign.id}` },
          () => loadMembers(version).catch(report))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'campaign_messages', filter: `campaign_id=eq.${campaign.id}` },
          event => receiveMessage(event.new, version))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'character_sheet_versions' },
          event => {
            if (event.eventType === 'DELETE') {
              if (isCurrent(version)) dispatch('sheet:list-changed');
              return;
            }
            receiveSheet(event.new,version).catch(error=>{if(isCurrent(version))report(error);});
          })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_sheet_assignments', filter: `campaign_id=eq.${campaign.id}` },
          () => {if(isCurrent(version))dispatch('sheet:list-changed');})
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'campaign_rolls', filter: `campaign_id=eq.${campaign.id}` },
          event => receiveRoll(event.new,version))
        .subscribe(async status => {
          if (!isCurrent(version) || currentChannel !== channel) return;
          if (status === 'SUBSCRIBED') {
            socket.connected = true;
            try {
              await currentChannel.track({ userId: user.id });
              await refreshCampaign(version);
              await loadHistory(version);
            } catch (error) { if (isCurrent(version)) report(error); }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            socket.connected = false;
            report(Error('A conexão ao vivo foi interrompida. Recarregue a página para reconectar.'));
          }
        });
    }
    async function handle(event, payload) {
      if (event === 'room:join') return join(payload);
      if (event === 'room:leave') return socket.disconnect();
      if (!campaign || !user) throw Error('Entre em uma campanha antes de usar a mesa.');
      const version = generation;
      const code = campaign.code;
      if (event === 'token:move') {
        const x = Math.round(Number(payload.x)), y = Math.round(Number(payload.y));
        if (!Number.isFinite(x) || !Number.isFinite(y) || typeof payload.tokenId !== 'string') return;
        await checked(client.rpc('move_campaign_token', {
          p_code: code, p_token_id: payload.tokenId,
          p_x: Math.max(0, Math.min(29, x)), p_y: Math.max(0, Math.min(19, y))
        }));
        return refreshCampaign(version);
      }
      if (event === 'dice:roll') {
        const sides = Number(payload.sides);
        if (![4, 6, 8, 10, 12, 20, 100].includes(sides)) return;
        const result = await checked(client.rpc('roll_campaign_dice', {
          p_code: code,
          p_sides: sides,
          p_modifier: Math.max(-100, Math.min(100, Math.trunc(Number(payload.modifier) || 0))),
          p_label: String(payload.label || '').trim().slice(0, 60),
          p_character_name: String(payload.characterName || '').trim().slice(0, 70)
        }));
        if (!isCurrent(version)) return;
        if (!seenRolls.has(result.id)) {
          seenRolls.add(result.id);
          dispatch('dice:result', result);
        }
        return refreshCampaign(version);
      }
      if (event === 'master:save-notes') {
        if (role !== 'master') throw Error('Somente o mestre pode salvar as anotações.');
        const value = String(payload.notes || '').slice(0, 10000);
        await checked(client.from('campaign_notes').upsert({ campaign_id: campaign.id, notes: value }, { onConflict: 'campaign_id' }));
        if (!isCurrent(version)) return;
        notes = value;
        dispatch('room:state', statePayload());
        dispatch('room:notice', 'Anotações salvas.');
        return;
      }
      if (event === 'session:chat') {
        const body = String(payload.body || '').trim().slice(0, 1000);
        if (!body) return;
        const recipient = payload.recipientSocketId || null;
        if (recipient && !members.has(recipient)) throw Error('Escolha um participante desta campanha.');
        const message = await checked(client.from('campaign_messages').insert({
          campaign_id: campaign.id,
          sender_user_id: user.id,
          recipient_user_id: recipient,
          body
        }).select('*').single());
        return displayMessage(message, version);
      }
    }

    client.auth.onAuthStateChange?.(event => {
      if (event === 'SIGNED_OUT' || event === 'USER_DELETED') socket.disconnect();
    });
    root.addEventListener?.('pagehide', () => socket.disconnect());
    return socket;
  }

  root.GrimorioSupabaseRealtime = {
    createSocket,
    install(client) {
      if (!client) return;
      root.io = () => createSocket(client);
    }
  };
  if (root.GrimorioSupabase?.client) root.GrimorioSupabaseRealtime.install(root.GrimorioSupabase.client);
})(window);
