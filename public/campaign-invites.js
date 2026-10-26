(() => {
  'use strict';
  const { api, esc, avatar } = Grimorio;
  let dialog, campaign, friends = [], members = [], invites = [], revision = 0;
  const invitee = invite => invite.person || invite.invitee || invite.user || { id: invite.userId || invite.inviteeId };
  const personName = person => person.displayName || person.username || person.playerName || 'Aventureiro';
  function mount() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'campaign-people-dialog panel';
    dialog.setAttribute('aria-labelledby', 'campaignPeopleTitle');
    dialog.innerHTML = `<button type="button" class="modal-close" aria-label="Fechar participantes">×</button><span class="mini-label">SUA COMPANHIA DE AVENTURAS</span><h2 id="campaignPeopleTitle"></h2><p class="campaign-dialog-intro">Faça parte da campanha mesmo quando a mesa estiver offline.</p><div class="hub-section-head"><h3>Participantes</h3><span id="campaignMemberCount" class="hub-count">0</span></div><div id="campaignPeopleMembers" class="request-list"></div><section id="campaignInviteSection"><div class="hub-section-head"><h3>Convidar amigos</h3><a href="/amigos.html" class="text-button">Encontrar amigos ↗</a></div><label class="sr-only" for="campaignInviteSearch">Buscar amigo para convidar</label><input id="campaignInviteSearch" type="search" placeholder="Buscar pelo nome ou código"><p class="campaign-dialog-intro">O convite aparece na página de campanhas do seu amigo. Ele entra na campanha quando aceitar.</p><div id="campaignPeopleFriends" class="request-list"></div></section><p id="campaignInviteStatus" class="form-feedback" role="status"></p>`;
    document.body.append(dialog);
    dialog.querySelector('.modal-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { revision++; });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    dialog.querySelector('#campaignInviteSearch').oninput = renderFriends;
    dialog.querySelector('#campaignPeopleFriends').onclick = async event => {
      const button = event.target.closest('[data-invite-user]');
      if (!button || button.disabled || !campaign?.canInvite) return;
      const version = revision;
      button.disabled = true;
      button.textContent = 'Enviando…';
      try {
        await api(`/api/campaigns/${encodeURIComponent(campaign.code)}/invites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: button.dataset.inviteUser }) });
        if (version !== revision) return;
        invites.push({ person: { id: button.dataset.inviteUser }, status: 'pending' });
        renderFriends();
        dialog.querySelector('#campaignInviteStatus').textContent = 'Convite enviado. Seu amigo precisa aceitá-lo para entrar na campanha.';
      } catch (error) {
        if (version !== revision) return;
        dialog.querySelector('#campaignInviteStatus').textContent = error.message;
        button.disabled = false; button.textContent = 'Convidar';
      }
    };
  }
  function renderMembers() {
    dialog.querySelector('#campaignMemberCount').textContent = members.length + '/10';
    dialog.querySelector('#campaignPeopleMembers').innerHTML = members.map(person => `<div class="campaign-person">${avatar(person)}<div><strong>${esc(personName(person))}</strong><small>${person.isMaster ? 'Mestre da campanha' : person.username ? '@' + esc(person.username) : 'Jogador'}</small></div><span class="member-role">${person.isMaster ? 'Mestre' : 'Participante'}</span></div>`).join('') || '<p class="request-empty">Nenhum participante encontrado.</p>';
  }
  function renderFriends() {
    const query = dialog.querySelector('#campaignInviteSearch').value.trim().toLocaleLowerCase('pt-BR');
    const visible = friends.filter(friend => [personName(friend), friend.username, friend.accountCode].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query)));
    dialog.querySelector('#campaignPeopleFriends').innerHTML = visible.map(friend => {
      const joined = members.some(member => member.id === friend.id || member.userId === friend.id);
      const pending = invites.some(invite => invitee(invite).id === friend.id && (!invite.status || invite.status === 'pending'));
      return `<div class="campaign-person">${avatar(friend)}<div><strong>${esc(personName(friend))}</strong><small>#${esc(friend.accountCode || '')}</small></div>${joined ? '<span class="friend-badge">Já participa</span>' : pending ? '<span class="request-badge">Convite enviado</span>' : `<button type="button" class="button button-secondary" data-invite-user="${esc(friend.id)}">Convidar</button>`}</div>`;
    }).join('') || `<p class="request-empty">${friends.length ? 'Nenhum amigo encontrado neste filtro.' : 'Seus amigos aparecerão aqui depois que aceitarem sua solicitação de amizade.'}</p>`;
  }
  async function open(next) {
    mount();
    campaign = next;
    const version = ++revision;
    friends = []; members = []; invites = [];
    dialog.querySelector('#campaignPeopleTitle').textContent = next.name || 'Participantes da campanha';
    dialog.querySelector('#campaignInviteSection').hidden = !next.canInvite;
    dialog.querySelector('#campaignInviteSearch').value = '';
    dialog.querySelector('#campaignPeopleMembers').innerHTML = '<p class="request-empty">Carregando participantes…</p>';
    dialog.querySelector('#campaignPeopleFriends').innerHTML = '';
    dialog.querySelector('#campaignInviteStatus').textContent = '';
    dialog.showModal();
    try {
      const values = await Promise.all([
        api(`/api/campaigns/${encodeURIComponent(next.code)}/members`),
        next.canInvite ? api('/api/friends') : { friends: [] },
        next.canInvite ? api(`/api/campaigns/${encodeURIComponent(next.code)}/invites`) : { invites: [] }
      ]);
      if (version !== revision) return;
      members = values[0].members || []; friends = values[1].friends || []; invites = values[2].invites || [];
      renderMembers(); renderFriends();
    } catch (error) { if (version === revision) dialog.querySelector('#campaignInviteStatus').textContent = error.message; }
  }
  window.GrimorioCampaignPeople = { open };
})();
