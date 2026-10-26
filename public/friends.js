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
  const meta = person => `${avatar(person)}<div class="person-meta"><strong>${esc(name(person))}</strong>${person.username ? `<span class="person-username">@${esc(person.username)}</span>` : ''}<small>#${esc(person.accountCode || '')}</small></div>`;
  const empty = (title, text) => `<div class="hub-empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  function searchCard(person) {
    let action;
    const received = incoming.find(request => personOf(request).id === person.id);
    const sent = outgoing.find(request => personOf(request).id === person.id);
    if (friends.some(friend => friend.id === person.id) || person.isFriend) action = '<span class="friend-badge">Amigo ✓</span>';
    else if (received) action = `<button type="button" class="button button-primary" data-accept="${esc(received.id)}">Aceitar pedido</button>`;
    else if (sent) action = '<span class="request-badge">Solicitação enviada</span>';
    else action = `<button type="button" class="button button-secondary" data-add="${esc(person.accountCode)}">Solicitar amizade</button>`;
    return `<article class="panel person-card">${meta(person)}<div class="person-actions">${action}</div></article>`;
  }
  function renderResults() {
    el('searchResults').innerHTML = found.map(searchCard).join('') || empty('Ninguém encontrado', 'Confira o nome de usuário, nome de exibição ou código.');
  }
  function render() {
    const query = el('filterFriends').value.trim().toLocaleLowerCase('pt-BR');
    const list = friends.filter(person => [name(person), person.username, person.accountCode].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query)));
    el('friendCount').textContent = friends.length;
    el('incomingCount').textContent = incoming.length;
    el('outgoingCount').textContent = outgoing.length;
    el('friends').innerHTML = list.map(person => `<article class="panel person-card friend-person">${meta(person)}<div class="person-actions"><span class="friend-badge">Na sua companhia</span><button class="text-button danger-action" type="button" data-remove="${esc(person.id)}" aria-label="Desfazer amizade com ${esc(name(person))}">Desfazer amizade</button></div></article>`).join('') || empty(friends.length ? 'Nenhum amigo neste filtro' : 'As melhores histórias são compartilhadas', friends.length ? 'Tente outro nome ou código.' : 'Envie uma solicitação. Quando ela for aceita, seu amigo aparece aqui.');
    el('incomingRequests').innerHTML = incoming.map(request => `<article class="panel person-card request-card">${meta(personOf(request))}<div class="person-actions"><button type="button" class="button button-primary" data-accept="${esc(request.id)}">Aceitar</button><button type="button" class="text-button" data-decline="${esc(request.id)}">Recusar</button></div></article>`).join('') || '<p class="request-empty">Nenhuma solicitação esperando sua resposta.</p>';
    el('outgoingRequests').innerHTML = outgoing.map(request => `<article class="panel person-card request-card">${meta(personOf(request))}<div class="person-actions"><span class="request-badge">Aguardando resposta</span><button type="button" class="text-button" data-cancel="${esc(request.id)}">Cancelar pedido</button></div></article>`).join('') || '<p class="request-empty">Seus convites de amizade enviados aparecem aqui.</p>';
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
    } catch (error) { status.textContent = error.message; }
    finally { loading = false; el('refreshFriends').disabled = false; }
  }
  async function action(event) {
    const button = event.target.closest('[data-add],[data-accept],[data-decline],[data-cancel],[data-remove]');
    if (!button || button.disabled) return;
    const data = button.dataset;
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
      status.textContent = message;
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; button.textContent = previous; }
  }
  for (const id of ['friends', 'incomingRequests', 'outgoingRequests', 'searchResults']) el(id).onclick = action;
  el('myAccountCode').textContent = user.accountCode;
  el('myUsername').textContent = user.username ? '@' + user.username : 'Sua identidade no Grimório';
  el('copyAccountCode').onclick = async () => {
    try { await navigator.clipboard.writeText(user.accountCode); status.textContent = 'Código copiado. Compartilhe com seus amigos!'; }
    catch { status.textContent = 'Seu código: ' + user.accountCode + '. Selecione os números para copiar.'; }
  };
  el('filterFriends').addEventListener('input', render);
  el('refreshFriends').onclick = () => load();
  el('clearSearch').onclick = () => { searchVersion++; el('searchSection').hidden = true; el('friendQuery').value = ''; el('searchStatus').textContent = ''; el('friendSearchForm').querySelector('button').disabled = false; };
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
  const timer = setInterval(() => { if (!document.hidden) load({ quiet: true }); }, 10000);
  window.addEventListener('focus', () => load({ quiet: true }));
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
})();
