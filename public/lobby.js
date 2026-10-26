(async () => {
  'use strict';
  const { api, avatar, esc } = Grimorio;
  const user = await Grimorio.requireUser();
  if (!user) return;
  const el = id => document.getElementById(id);
  const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
  if (!/^[A-F0-9]{6}$/.test(code)) { location.href = '/campanha.html'; return; }
  const status = el('lobbyStatus');
  let info, members = [], online = new Set(), refreshRunning = false;
  const displayName = person => person.displayName || person.playerName || person.username || 'Aventureiro';
  const memberId = person => person.userId || person.id;
  const present = person => online.has(memberId(person));
  function render() {
    const master = members.find(person => person.isMaster);
    el('masterSeat').innerHTML = master ? `${avatar(master)}<strong>${esc(displayName(master))}</strong><small class="presence-label ${present(master) ? 'online' : ''}">${present(master) ? 'MESTRE · ONLINE' : 'MESTRE · AUSENTE'}</small>` : '';
    el('masterSeat').classList.toggle('seat-offline', Boolean(master && !present(master)));
    const players = members.filter(person => !person.isMaster);
    el('playerRing').innerHTML = Array.from({ length: 9 }, (_, index) => {
      const person = players[index];
      if (!person) return `<div class="seat s${index} empty-seat"><span aria-hidden="true">+</span><small>Lugar livre</small></div>`;
      return `<div class="seat s${index} ${present(person) ? 'seat-online' : 'seat-offline'}">${avatar(person)}<strong>${esc(displayName(person))}</strong><small class="presence-label ${present(person) ? 'online' : ''}">${present(person) ? 'NA MESA' : 'AUSENTE'}</small></div>`;
    }).join('');
    el('onlineCount').textContent = members.filter(present).length;
    el('memberList').innerHTML = members.map(person => `<div class="lobby-player">${avatar(person)}<div class="meta"><strong>${esc(displayName(person))}</strong><small>${person.isMaster ? 'Mestre' : 'Jogador'} · ${present(person) ? 'Presente agora' : 'Offline'}</small></div><span class="presence-dot ${present(person) ? 'online' : ''}" aria-label="${present(person) ? 'Online' : 'Offline'}"></span></div>`).join('');
  }
  async function refresh() {
    if (refreshRunning) return;
    refreshRunning = true;
    try {
      const data = await api(`/api/campaigns/${code}/members`);
      if (data.status === 'session') { location.href = '/sessao.html?code=' + code; return; }
      members = data.members || []; render();
    } catch (error) { status.textContent = error.message; }
    finally { refreshRunning = false; }
  }
  try {
    info = await api('/api/campaigns/' + code);
    if (info.role === 'guest') {
      await api(`/api/campaigns/${code}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: user.displayName || user.username || 'Aventureiro' }) });
      info = await api('/api/campaigns/' + code);
    }
    el('campaignName').textContent = info.campaign.name;
    el('campaignCode').textContent = code;
    el('copy').onclick = async () => {
      try { await navigator.clipboard.writeText(`${location.origin}/lobby.html?code=${code}`); status.textContent = 'Convite copiado. Compartilhe com seu grupo.'; }
      catch { status.textContent = 'Código da campanha: ' + code; }
    };
    if (info.role === 'master') {
      el('start').classList.remove('hidden'); el('masterSheets').classList.remove('hidden');
      el('masterSheets').href = '/ficha.html?campaign=' + code;
      el('inviteFriends').hidden = false;
      el('inviteFriends').onclick = () => window.GrimorioCampaignPeople.open({ code, name: info.campaign.name, canInvite: true });
      el('start').onclick = async () => {
        el('start').disabled = true;
        try { await api(`/api/campaigns/${code}/start`, { method: 'POST' }); location.href = '/sessao.html?code=' + code; }
        catch (error) { status.textContent = error.message; el('start').disabled = false; }
      };
    }
    await refresh();
    const token = localStorage.getItem(Grimorio.AUTH_KEY);
    const socket = io({ auth: { token } });
    socket.on('room:players', players => { online = new Set(players.map(person => person.userId || person.id)); render(); refresh(); });
    socket.on('room:state', data => {
      if (data.players) { online = new Set(data.players.map(person => person.userId || person.id)); render(); }
      if (data.campaign?.status === 'session') location.href = '/sessao.html?code=' + code;
    });
    socket.on('campaign:started', () => { location.href = '/sessao.html?code=' + code; });
    socket.on('app:error', message => { status.textContent = String(message); });
    socket.on('disconnect', () => { online.clear(); render(); status.textContent = 'Conexão interrompida. Tentando reconectar…'; });
    const joinRoom = () => socket.emit('room:join', { code, token, playerName: info.role === 'master' ? 'Mestre' : info.playerName || user.displayName || 'Aventureiro' });
    socket.on('connect', joinRoom);
    // Supabase's compatibility socket joins immediately; Socket.IO joins on connect.
    if (window.GrimorioSupabase || socket.connected) joinRoom();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 10000);
    window.addEventListener('focus', refresh);
    window.addEventListener('pagehide', () => { clearInterval(timer); socket.emit('room:leave'); socket.disconnect(); }, { once: true });
  } catch (error) { status.textContent = error.message; }
})();
