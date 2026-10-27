(async () => {
  'use strict';
  const { api, esc, avatar } = Grimorio;
  const user = await Grimorio.requireUser();
  if (!user) return;
  const el = id => document.getElementById(id);
  const status = el('friendsStatus');
  let friends = [], incoming = [], outgoing = [], found = [], searchVersion = 0, loading = false;
  const name = person => person.displayName || person.username || 'Aventureiro';
  const personOf = request => request.person || request.user || request;
  const meta = person => `${avatar(person)}<div class="person-meta"><strong>${esc(name(person))}</strong><span>${person.username ? '@' + esc(person.username) : 'Conta Grimório'} <small>#${esc(person.accountCode || '')}</small></span></div>`;
  const empty = (title, text) => `<div class="friends-empty"><span aria-hidden="true">♙</span><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  function announce(message) {
    status.textContent = message;
    if (el('requestsDialog').open) el('requestsStatus').textContent = message;
    if (el('addFriendDialog').open) el('searchStatus').textContent = message;
  }
  function searchCard(person) {
    let action;
    const received = incoming.find(request => personOf(request).id === person.id);
    const sent = outgoing.find(request => personOf(request).id === person.id);
    if (friends.some(friend => friend.id === person.id) || person.isFriend) action = '<span class="friend-badge">Amigo ✓</span>';
    else if (received) action = `<button type="button" class="button button-primary" data-accept="${esc(received.id)}">Aceitar pedido</button>`;
    else if (sent) action = '<span class="request-badge">Solicitação enviada</span>';
    else action = `<button type="button" class="button button-secondary" data-add="${esc(person.accountCode)}">Solicitar amizade</button>`;
    return `<article class="person-card">${meta(person)}<div class="person-actions">${action}</div></article>`;
  }
  function renderResults() {
    el('searchResults').innerHTML = found.map(searchCard).join('') || empty('Ninguém encontrado', 'Confira o nome ou o código e tente outra busca.');
  }
  function render() {
    const query = el('filterFriends').value.trim().toLocaleLowerCase('pt-BR');
    const list = friends.filter(person => [name(person), person.username, person.accountCode].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query))).sort((a, b) => name(a).localeCompare(name(b), 'pt-BR'));
    el('friendCount').textContent = friends.length;
    el('incomingCount').textContent = incoming.length;
    el('outgoingCount').textContent = outgoing.length;
    el('requestsBadge').textContent = incoming.length > 99 ? '99+' : incoming.length;
    el('requestsBadge').hidden = !incoming.length;
    el('openRequests').setAttribute('aria-label', incoming.length ? `Solicitações de amizade: ${incoming.length} recebida(s)` : 'Solicitações de amizade');
    el('friends').innerHTML = list.map(person => `<article class="person-card friend-person">${meta(person)}<details class="friend-menu"><summary aria-label="Opções de ${esc(name(person))}"><span aria-hidden="true">···</span></summary><div><button type="button" data-copy="${esc(person.accountCode)}">Copiar código</button><button class="danger-action" type="button" data-remove="${esc(person.id)}" aria-label="Desfazer amizade com ${esc(name(person))}">Desfazer amizade</button></div></details></article>`).join('') || empty(friends.length ? 'Nenhum amigo neste filtro' : 'Sua próxima aventura começa aqui', friends.length ? 'Tente outro nome ou código.' : 'Adicione amigos e reúna seu grupo para a próxima sessão.');
    el('incomingRequests').innerHTML = incoming.map(request => `<article class="person-card request-card">${meta(personOf(request))}<div class="person-actions"><button type="button" class="button button-primary" data-accept="${esc(request.id)}">Aceitar</button><button type="button" class="friends-plain-button" data-decline="${esc(request.id)}">Recusar</button></div></article>`).join('') || empty('Tudo em dia', 'Novas solicitações de amizade aparecem aqui.');
    el('outgoingRequests').innerHTML = outgoing.map(request => `<article class="person-card request-card">${meta(personOf(request))}<div class="person-actions"><span class="request-badge">Aguardando resposta</span><button type="button" class="friends-plain-button" data-cancel="${esc(request.id)}">Cancelar pedido</button></div></article>`).join('') || empty('Nenhum pedido pendente', 'Os pedidos que você enviar ficam aqui até serem respondidos.');
    if (!el('searchSection').hidden) renderResults();
  }
  async function load({ quiet = false } = {}) {
    if (loading) return;
    loading = true;
    el('refreshFriends').disabled = true;
    try {
      const data = await api('/api/friends');
      friends = data.friends || []; incoming = data.incomingRequests || []; outgoing = data.outgoingRequests || [];
      render();
      if (!quiet) status.textContent = '';
    } catch (error) { announce(error.message); }
    finally { loading = false; el('refreshFriends').disabled = false; }
  }
  async function copyCode(code) {
    try { await navigator.clipboard.writeText(code); announce('Código copiado. Compartilhe com seus amigos!'); }
    catch { announce('Código: ' + code + '. Selecione os números para copiar.'); }
  }
  async function action(event) {
    const button = event.target.closest('[data-add],[data-accept],[data-decline],[data-cancel],[data-remove],[data-copy]');
    if (!button || button.disabled) return;
    const data = button.dataset;
    if (data.copy) { await copyCode(data.copy); return; }
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'Aguarde…';
    try {
      let message;
      if (data.add) {
        await api('/api/friends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountCode: data.add }) });
        message = 'Solicitação enviada. A amizade começa quando a outra pessoa aceitar.';
      } else if (data.remove) {
        await api('/api/friends/' + encodeURIComponent(data.remove), { method: 'DELETE' });
        found = found.map(person => person.id === data.remove ? { ...person, isFriend: false } : person);
        message = 'Amizade desfeita.';
      } else {
        const id = data.accept || data.decline || data.cancel;
        const suffix = data.accept ? '/accept' : data.decline ? '/decline' : '';
        await api('/api/friend-requests/' + encodeURIComponent(id) + suffix, { method: data.cancel ? 'DELETE' : 'POST' });
        message = data.accept ? 'Solicitação aceita. Vocês agora são amigos!' : data.decline ? 'Solicitação recusada.' : 'Solicitação cancelada.';
      }
      await load({ quiet: true });
      announce(message);
    } catch (error) { announce(error.message); }
    finally { button.disabled = false; button.textContent = previous; }
  }
  for (const id of ['friends', 'incomingRequests', 'outgoingRequests', 'searchResults']) el(id).onclick = action;
  el('myAccountCode').textContent = user.accountCode;
  el('myUsername').textContent = user.username ? '@' + user.username : 'Sua identidade no Grimório';
  el('copyAccountCode').onclick = () => copyCode(user.accountCode);
  el('filterFriends').addEventListener('input', render);
  el('refreshFriends').onclick = () => load();
  for (const [dialogId, closeId] of [['addFriendDialog', 'closeAddFriend'], ['requestsDialog', 'closeRequests']]) {
    const dialog = el(dialogId);
    el(closeId).onclick = () => dialog.close();
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  }
  el('openAddFriend').onclick = () => { el('addFriendDialog').showModal(); el('friendQuery').focus(); };
  const selectRequests = (tab, focus = false) => {
    for (const type of ['incoming', 'outgoing']) {
      const active = type === tab;
      el(type + 'Tab').setAttribute('aria-selected', String(active));
      el(type + 'Tab').setAttribute('tabindex', active ? '0' : '-1');
      el(type + 'Panel').hidden = !active;
    }
    if (focus) el(tab + 'Tab').focus();
  };
  el('openRequests').onclick = () => { selectRequests('incoming'); el('requestsStatus').textContent = ''; el('requestsDialog').showModal(); load({ quiet: true }); };
  for (const type of ['incoming', 'outgoing']) {
    el(type + 'Tab').onclick = () => selectRequests(type);
    el(type + 'Tab').addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        selectRequests(event.key === 'Home' ? 'incoming' : event.key === 'End' ? 'outgoing' : type === 'incoming' ? 'outgoing' : 'incoming', true);
      }
    });
  }
  el('clearSearch').onclick = () => { searchVersion++; el('searchSection').hidden = true; el('friendQuery').value = ''; el('searchStatus').textContent = ''; el('friendSearchForm').querySelector('button').disabled = false; el('friendQuery').focus(); };
  el('friendSearchForm').onsubmit = async event => {
    event.preventDefault();
    const q = el('friendQuery').value.trim();
    if (q.length < 2) return;
    const version = ++searchVersion, button = event.currentTarget.querySelector('button');
    button.disabled = true; el('searchStatus').textContent = 'Buscando jogadores…';
    try {
      const data = await api('/api/users/search?q=' + encodeURIComponent(q));
      if (version !== searchVersion) return;
      found = data.users || []; renderResults(); el('searchSection').hidden = false;
      el('searchStatus').textContent = found.length + ' resultado(s). Confira o código antes de enviar a solicitação.';
    } catch (error) { if (version === searchVersion) el('searchStatus').textContent = error.message; }
    finally { if (version === searchVersion) button.disabled = false; }
  };
  await load();
  const timer = setInterval(() => { if (!document.hidden && !el('friends').querySelector('details[open]')) load({ quiet: true }); }, 10000);
  window.addEventListener('focus', () => load({ quiet: true }));
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
})();
