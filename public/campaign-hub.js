(async () => {
  'use strict';
  const { api, esc, avatar } = Grimorio;
  const user = await Grimorio.requireUser();
  if (!user) return;
  const el = id => document.getElementById(id);
  const code = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();
  let info, socket, refreshing = false, refreshAgain = false, refreshTimer, disposed = false;
  let activeTab = 'overview', masterMode = false, notesDirty = false, notesLoaded = false, notesRevision = 0;
  let charactersLoaded = false, charactersLoading = false, charactersAgain = false, managing = false, uploading = false, sessionBusy = false;
  const feedback = (id, message = '', error = false) => { el(id).textContent = message; el(id).classList.toggle('error', error); };
  const date = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const name = person => person?.displayName || person?.playerName || 'Aventureiro';
  const allowed = key => Boolean(info?.permissions?.[key]);
  const tableUrl = () => `/${info?.activeSession ? 'sessao' : 'lobby'}.html?code=${encodeURIComponent(code)}`;
  const campaignUrl = suffix => `/api/campaigns/${encodeURIComponent(code)}/${suffix}`;
  const world = window.GrimorioCampaignWorld.create({ code, onAccessDenied: unavailable });
  function hidePrivate() {
    masterMode = false; notesDirty = false; notesLoaded = false; notesRevision++;
    el('hubNotes').value = ''; el('hubNotes').disabled = true; el('hubSaveNotes').disabled = true; el('hubPrivate').hidden = true;
    el('hubMasterMode').setAttribute('aria-pressed', 'false');
  }
  function unavailable(error) {
    info = null; hidePrivate();
    world.clear();
    el('hubContent').hidden = true; el('hubLoading').hidden = true; el('hubUnavailable').hidden = false;
    el('hubUnavailableMessage').textContent = error.message || 'Confira o convite ou tente novamente.';
    el('hubConnection').textContent = 'Campanha indisponível';
    if (el('hubManageDialog').open) el('hubManageDialog').close();
    if (el('hubConfirmDialog').open) el('hubConfirmDialog').close();
    socket?.disconnect(); socket = null;
  }
  function render() {
    world.setContext(info);
    const { campaign, members = [], master, activeSession, lastSession, sessions = [] } = info;
    document.title = `${campaign.name} — Grimório`;
    el('hubName').textContent = campaign.name;
    el('hubDescription').textContent = campaign.description || 'Um mundo à espera da próxima história. O Mestre pode adicionar a descrição da campanha.';
    el('hubSummary').textContent = campaign.recentSummary || 'O primeiro capítulo ainda está por ser contado. O resumo público da aventura aparecerá aqui.';
    el('hubRole').textContent = info.role === 'master' ? 'MESTRE' : 'JOGADOR';
    el('hubState').textContent = activeSession ? 'Sessão em andamento' : 'Entre aventuras';
    el('hubState').classList.toggle('live', Boolean(activeSession));
    el('hubSystem').textContent = campaign.systemName || 'Sistema próprio';
    el('hubPlayerCount').textContent = `${info.playerCount || 0} ${(info.playerCount || 0) === 1 ? 'jogador' : 'jogadores'} · até ${info.maxPlayers || 10} participantes`;
    el('hubCode').textContent = `CONVITE · ${campaign.code}`;
    const cover = campaign.coverUrl || '';
    if (el('hubCover').dataset.source !== cover) {
      el('hubCover').dataset.source = cover;
      el('hubCover').replaceChildren();
      if (cover) { const image = document.createElement('img'); image.src = cover; image.alt = ''; image.onerror = () => { image.remove(); }; el('hubCover').append(image); }
      else { const mark = document.createElement('span'); mark.textContent = '✦'; el('hubCover').append(mark); }
    }
    el('hubEnterTable').href = tableUrl(); el('hubTableTab').href = tableUrl();
    el('hubPrepareSheets').href = '/ficha.html?campaign=' + encodeURIComponent(code);
    el('hubEnterTable').textContent = activeSession ? 'Continuar sessão ↗' : 'Entrar na mesa ↗';
    el('hubStartSession').hidden = !allowed('canStartSession');
    el('hubStartSession').disabled = sessionBusy;
    el('hubManage').hidden = !allowed('canManage');
    el('hubMasterMode').hidden = !allowed('canViewPrivate');
    el('hubEndSession').hidden = !allowed('canManage') || !activeSession;
    el('hubEndSession').disabled = sessionBusy;
    el('hubPeople').textContent = allowed('canManage') ? 'Participantes e convites' : 'Ver participantes';
    el('hubMaster').innerHTML = master ? `${avatar(master)}<div><strong>${esc(name(master))}</strong><small>Mestre da campanha</small></div>` : '<p class="hub-help">Mestre indisponível.</p>';
    el('hubMembers').innerHTML = members.map(person => `<article class="campaign-member">${avatar(person)}<div><strong>${esc(name(person))}</strong><small>${person.isMaster ? 'Mestre' : 'Jogador'}${person.playerName && person.playerName !== name(person) ? ' · ' + esc(person.playerName) : ''}</small></div></article>`).join('') || '<p class="hub-help">A companhia ainda está se reunindo.</p>';
    el('hubNextSession').textContent = date(campaign.nextSessionAt) || 'A combinar com o grupo';
    const latest = activeSession || lastSession;
    el('hubLastLabel').textContent = activeSession ? 'SESSÃO EM ANDAMENTO' : 'ÚLTIMA SESSÃO';
    el('hubLastSession').textContent = latest ? `#${latest.number} · ${latest.title}` : 'A aventura vai começar';
    el('hubLastSessionTime').textContent = latest ? `${activeSession ? 'Iniciada' : 'Encerrada'} em ${date(activeSession ? latest.startedAt : latest.endedAt)}` : 'Inicie o primeiro encontro quando o grupo estiver pronto.';
    el('hubSessionCards').innerHTML = sessions.map(session => `<article class="panel campaign-session-card"><span class="campaign-session-number">#${Number(session.number)}</span><div class="campaign-session-copy"><h3>${esc(session.title)}</h3><p>Início · ${esc(date(session.startedAt))}<br>${session.endedAt ? 'Encerrada · ' + esc(date(session.endedAt)) : 'Em andamento'}</p></div>${!session.endedAt ? `<a href="/sessao.html?code=${encodeURIComponent(code)}" class="button button-secondary">Continuar sessão ↗</a>` : '<span class="world-status">Encerrada</span>'}</article>`).join('') || '<div class="hub-empty"><h3>O primeiro capítulo está à frente</h3><p>Quando o Mestre iniciar a sessão, ela aparecerá aqui.</p></div>';
    if (!allowed('canViewPrivate')) hidePrivate();
    el('hubContent').hidden = false; el('hubLoading').hidden = true; el('hubUnavailable').hidden = true;
  }
  async function refresh() {
    if (disposed) return;
    if (refreshing) { refreshAgain = true; return; }
    refreshing = true;
    try {
      const next = await api(campaignUrl('hub'));
      if (disposed) return;
      if (!next?.campaign || !['master', 'player'].includes(next.role)) throw new Error('Sua conta não participa desta campanha. Entre usando um convite.');
      info = next; render();
      if (next.coverError) feedback('hubFeedback', next.coverError, true);
      if (!socket) connect();
    } catch (error) {
      if (disposed) return;
      if (!info || [401, 403, 404].includes(error.status) || error.code === '42501') unavailable(error);
      else feedback('hubFeedback', `${error.message} Use Atualizar para tentar novamente.`, true);
    } finally {
      refreshing = false;
      if (refreshAgain && !disposed) { refreshAgain = false; scheduleRefresh(); }
    }
  }
  function scheduleRefresh() { if (!disposed) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 180); } }
  function connect() {
    if (disposed || socket || typeof io !== 'function') return;
    const current = socket = io({ auth: { token: localStorage.getItem(Grimorio.AUTH_KEY) } });
    const join = () => current.emit('room:join', { code, view: 'hub', token: localStorage.getItem(Grimorio.AUTH_KEY), playerName: info.role === 'master' ? 'Mestre' : user.displayName || 'Aventureiro' });
    current.on('connect', join);
    current.on('room:state', () => { el('hubConnection').textContent = 'Campanha conectada'; scheduleRefresh(); });
    for (const event of ['campaign:updated', 'campaign:started', 'campaign:members-changed']) current.on(event, scheduleRefresh);
    current.on('campaign:world-changed', () => world.invalidate());
    current.on('campaign:members-changed', () => world.invalidate({ sheets: true }));
    current.on('sheet:list-changed', () => { world.invalidate({ sheets: true }); charactersLoaded = false; if (activeTab === 'characters') loadCharacters(); });
    current.on('disconnect', () => { el('hubConnection').textContent = 'Conexão interrompida · tentando reconectar'; });
    current.on('connect_error', () => { el('hubConnection').textContent = 'Sem conexão ao vivo · use Atualizar para tentar novamente'; });
    current.on('app:error', message => { feedback('hubFeedback', String(message), true); el('hubConnection').textContent = 'Atualizações ao vivo indisponíveis'; });
    if (window.GrimorioSupabase || current.connected) join();
  }
  async function loadCharacters() {
    if (!info || charactersLoaded || disposed) return;
    if (charactersLoading) { charactersAgain = true; return; }
    charactersLoading = true; feedback('hubCharactersFeedback', 'Carregando fichas disponíveis…');
    el('hubCharactersTitle').textContent = info.role === 'master' ? 'Fichas da companhia' : 'Minhas fichas na campanha';
    el('hubCharactersHelp').textContent = info.role === 'master' ? 'Fichas disponíveis dos membros e da sua biblioteca. Elas continuam nas bibliotecas originais e podem ser usadas em outras campanhas. Atribua fichas aos jogadores dentro da mesa.' : 'Suas fichas e as fichas que o Mestre atribuiu a você. As bibliotecas e permissões existentes são preservadas.';
    try {
      const result = await api(campaignUrl('sheets'));
      if (disposed || !info) return;
      el('hubCharacterCards').innerHTML = (result.sheets || []).map(sheet => `<article class="panel world-card campaign-character-card"><span class="mini-label">PERSONAGEM</span><h3>${esc(sheet.name || 'Personagem sem nome')}</h3><p>${esc(sheet.ownerName || 'Sua biblioteca')}${sheet.assignedUserId ? ' · ficha atribuída' : ''}</p><a class="button button-secondary" href="/ficha.html?campaign=${encodeURIComponent(code)}&sheet=${encodeURIComponent(sheet.id)}">Abrir ficha ↗</a></article>`).join('') || '<div class="hub-empty"><h3>Há espaço para novos personagens</h3><p>Crie uma ficha na sua biblioteca ou combine uma atribuição com o Mestre.</p></div>';
      charactersLoaded = true; feedback('hubCharactersFeedback');
    } catch (error) { feedback('hubCharactersFeedback', error.message, true); }
    finally { charactersLoading = false; if (charactersAgain) { charactersAgain = false; charactersLoaded = false; if (activeTab === 'characters') loadCharacters(); } }
  }
  function selectTab(tab) {
    activeTab = tab;
    world.selectTab(tab);
    document.querySelectorAll('[data-hub-tab]').forEach(button => { if (button.dataset.hubTab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    document.querySelectorAll('[data-hub-panel]').forEach(panel => { panel.hidden = panel.dataset.hubPanel !== tab; });
    if (tab === 'characters') loadCharacters();
  }
  document.querySelectorAll('[data-hub-tab]').forEach(button => { button.onclick = () => selectTab(button.dataset.hubTab); });
  el('hubPeople').onclick = () => { if (info) window.GrimorioCampaignPeople.open({ code, name: info.campaign.name, canInvite: allowed('canManage') }); };
  el('hubRetry').onclick = () => { el('hubLoading').hidden = false; el('hubUnavailable').hidden = true; refresh(); };
  el('hubRefresh').onclick = async () => { el('hubRefresh').disabled = true; feedback('hubFeedback'); charactersLoaded = false; world.invalidate({ sheets: true }); await refresh(); await world.refresh(); if (activeTab === 'characters') await loadCharacters(); el('hubRefresh').disabled = false; };
  async function loadNotes() {
    if (!allowed('canViewPrivate') || !masterMode) return;
    const revision = ++notesRevision;
    feedback('hubNotesFeedback', 'Carregando suas notas privadas…'); el('hubSaveNotes').disabled = true; el('hubNotes').disabled = true;
    try {
      const result = await api(campaignUrl('notes'));
      if (revision !== notesRevision || disposed || !masterMode) return;
      if (!notesDirty) el('hubNotes').value = result.notes || '';
      notesLoaded = true; feedback('hubNotesFeedback');
    } catch (error) { if (revision === notesRevision) feedback('hubNotesFeedback', error.message, true); }
    finally { if (revision === notesRevision) { el('hubSaveNotes').disabled = !notesLoaded; el('hubNotes').disabled = !notesLoaded; } }
  }
  el('hubMasterMode').onclick = async () => {
    if (!allowed('canViewPrivate')) return;
    masterMode = !masterMode; el('hubPrivate').hidden = !masterMode;
    el('hubMasterMode').setAttribute('aria-pressed', String(masterMode));
    if (masterMode) { if (!notesLoaded) await loadNotes(); el('hubPrivate').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' }); }
  };
  el('hubNotes').addEventListener('input', () => { notesDirty = true; });
  el('hubReloadNotes').onclick = () => { if (notesDirty) { feedback('hubNotesFeedback', 'Salve suas alterações antes de recarregar as notas.', true); return; } loadNotes(); };
  el('hubNotesForm').onsubmit = async event => {
    event.preventDefault(); if (!allowed('canViewPrivate') || !notesLoaded || el('hubSaveNotes').disabled) return;
    const value = el('hubNotes').value; el('hubSaveNotes').disabled = true; feedback('hubNotesFeedback', 'Salvando…');
    try { await api(campaignUrl('notes'), { method: 'PUT', body: JSON.stringify({ notes: value }) }); if (el('hubNotes').value === value) notesDirty = false; feedback('hubNotesFeedback', 'Notas privadas salvas.'); }
    catch (error) { feedback('hubNotesFeedback', error.message, true); }
    finally { el('hubSaveNotes').disabled = false; }
  };
  const localDateInput = value => { if (!value || !Number.isFinite(new Date(value).getTime())) return ''; const time = new Date(value); return new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  el('hubManage').onclick = () => {
    if (!allowed('canManage')) return;
    const campaign = info.campaign;
    el('hubEditName').value = campaign.name; el('hubEditDescription').value = campaign.description || '';
    el('hubEditSummary').value = campaign.recentSummary || ''; el('hubEditNext').value = localDateInput(campaign.nextSessionAt);
    el('hubCoverFile').value = ''; feedback('hubManageFeedback'); feedback('hubCoverFeedback');
    el('hubManageDialog').showModal(); el('hubEditName').focus();
  };
  el('hubCloseManage').onclick = () => { if (!managing && !uploading) el('hubManageDialog').close(); };
  el('hubManageDialog').addEventListener('cancel', event => { if (managing || uploading) event.preventDefault(); });
  el('hubManageForm').onsubmit = async event => {
    event.preventDefault(); if (managing || uploading || !allowed('canManage')) return;
    const name = el('hubEditName').value.trim(); el('hubEditName').setCustomValidity(name ? '' : 'Informe o nome da campanha.');
    if (!el('hubManageForm').reportValidity()) return;
    managing = true; el('hubSaveManage').disabled = true; feedback('hubManageFeedback', 'Salvando…');
    try {
      const next = el('hubEditNext').value;
      const result = await api(campaignUrl('hub'), { method: 'PUT', body: JSON.stringify({ name, description: el('hubEditDescription').value.trim(), recentSummary: el('hubEditSummary').value.trim(), nextSessionAt: next ? new Date(next).toISOString() : null }) });
      if (result?.campaign) { info = result; render(); } else await refresh();
      feedback('hubManageFeedback', 'Campanha atualizada.'); feedback('hubFeedback', 'Campanha atualizada para o grupo.');
    } catch (error) { feedback('hubManageFeedback', error.message, true); }
    finally { managing = false; el('hubSaveManage').disabled = false; }
  };
  el('hubEditName').oninput = () => el('hubEditName').setCustomValidity('');
  async function saveCover(remove = false) {
    if (uploading || managing || !allowed('canManage')) return;
    const file = el('hubCoverFile').files?.[0];
    if (!remove && !file) { feedback('hubCoverFeedback', 'Escolha uma imagem para a capa.', true); return; }
    if (!remove && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024)) { feedback('hubCoverFeedback', 'Escolha uma imagem PNG, JPG ou WebP de até 3 MB.', true); return; }
    uploading = true; el('hubSaveCover').disabled = true; el('hubRemoveCover').disabled = true; el('hubCoverFile').disabled = true;
    feedback('hubCoverFeedback', remove ? 'Removendo capa…' : 'Enviando capa…');
    try {
      const imageData = remove ? '' : await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.readAsDataURL(file); });
      const result = await api(campaignUrl('cover'), { method: 'PUT', body: JSON.stringify({ imageData }) });
      el('hubCoverFile').value = ''; await refresh(); feedback('hubCoverFeedback', result.warning || result.coverError || (remove ? 'Capa removida.' : 'Capa atualizada.'), Boolean(result.warning || result.coverError));
    } catch (error) { feedback('hubCoverFeedback', error.message, true); }
    finally { uploading = false; el('hubSaveCover').disabled = false; el('hubRemoveCover').disabled = false; el('hubCoverFile').disabled = false; }
  }
  el('hubSaveCover').onclick = () => saveCover(); el('hubRemoveCover').onclick = () => { if ((info?.campaign.coverUrl || info?.campaign.coverPath) && window.confirm('Remover a capa desta campanha?')) saveCover(true); };
  el('hubStartSession').onclick = async () => {
    if (sessionBusy || !allowed('canStartSession')) return;
    sessionBusy = true; el('hubStartSession').disabled = true; feedback('hubFeedback', 'Iniciando sessão…');
    try { await api(campaignUrl('start'), { method: 'POST' }); await refresh(); feedback('hubFeedback', 'Sessão iniciada. Entre na mesa quando estiver pronto.'); selectTab('sessions'); }
    catch (error) { feedback('hubFeedback', error.message, true); }
    finally { sessionBusy = false; el('hubStartSession').disabled = false; }
  };
  el('hubEndSession').onclick = () => { if (allowed('canManage') && info.activeSession) { feedback('hubEndFeedback'); el('hubConfirmDialog').showModal(); } };
  el('hubCancelEnd').onclick = () => { if (!sessionBusy) el('hubConfirmDialog').close(); };
  el('hubConfirmDialog').addEventListener('cancel', event => { if (sessionBusy) event.preventDefault(); });
  el('hubConfirmEnd').onclick = async () => {
    if (sessionBusy || !allowed('canManage') || !info.activeSession) return;
    sessionBusy = true; el('hubConfirmEnd').disabled = true; feedback('hubEndFeedback', 'Encerrando sessão…');
    try { await api(campaignUrl('lobby'), { method: 'POST' }); await refresh(); el('hubConfirmDialog').close(); feedback('hubFeedback', 'Sessão encerrada. O encontro ficou registrado na campanha.'); }
    catch (error) { feedback('hubEndFeedback', error.message, true); }
    finally { sessionBusy = false; el('hubConfirmEnd').disabled = false; if (info) render(); }
  };
  const onFocus = () => { world.invalidate({ sheets: true }); charactersLoaded = false; scheduleRefresh(); if (activeTab === 'characters') loadCharacters(); };
  window.addEventListener('focus', onFocus);
  window.addEventListener('pagehide', () => { world.suspend(); disposed = true; notesRevision++; clearTimeout(refreshTimer); window.removeEventListener('focus', onFocus); socket?.emit('room:leave'); socket?.disconnect(); socket = null; });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    disposed = false; world.resume(); window.addEventListener('focus', onFocus); onFocus();
    if (masterMode && !notesDirty) loadNotes();
  });
  if (!/^[A-F0-9]{6}$/.test(code)) { unavailable(new Error('O código da campanha é inválido. Abra uma campanha pela sua lista.')); return; }
  await refresh();
})();
