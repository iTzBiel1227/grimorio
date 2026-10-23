(async () => {
  const {api,esc,avatar} = Grimorio;
  const user = await Grimorio.requireUser();
  if (!user) return;
  const el = id => document.getElementById(id);
  const friendsBox = el('friends');
  const status = el('friendsStatus');
  const results = el('searchResults');
  let friends = [], found = [], searchVersion = 0;
  const name = person => person.displayName || 'Aventureiro';
  const card = (person, searching = false) => `<article class="panel person-card">${avatar(person)}<div class="person-meta"><strong>${esc(name(person))}</strong><small>#${esc(person.accountCode)}</small></div>${searching && !friends.some(f=>f.id===person.id) && !person.isFriend ? `<button type="button" class="button button-secondary" data-add="${esc(person.accountCode)}">Adicionar</button>` : '<span class="friend-badge">Amigo ✓</span>'}</article>`;
  function render() {
    const query = el('filterFriends').value.trim().toLocaleLowerCase('pt-BR');
    const list = friends.filter(f => name(f).toLocaleLowerCase('pt-BR').includes(query) || f.accountCode.includes(query));
    el('friendCount').textContent = friends.length;
    friendsBox.innerHTML = list.map(f=>card(f)).join('') || `<div class="hub-empty"><h3>${friends.length ? 'Nenhum resultado' : 'As melhores histórias são compartilhadas'}</h3><p>${friends.length ? 'Tente outro nome ou código.' : 'Busque um jogador acima ou envie seu código para seus amigos.'}</p></div>`;
  }
  async function load() {
    try { friends=(await api('/api/friends')).friends; status.textContent=''; render(); }
    catch(error) { status.textContent=error.message; friendsBox.innerHTML='<button class="button button-secondary" type="button" id="retryFriends">Tentar novamente</button>'; el('retryFriends').onclick=load; }
  }
  function renderResults() { results.innerHTML=found.map(p=>card(p,true)).join('') || '<div class="hub-empty"><h3>Ninguém encontrado</h3><p>Confira o código ou tente outro nome de exibição.</p></div>'; }
  el('myAccountCode').textContent=user.accountCode;
  el('copyAccountCode').onclick=async()=>{
    try { await navigator.clipboard.writeText(user.accountCode); status.textContent='Código copiado. Compartilhe com seus amigos!'; }
    catch { status.textContent='Seu código: '+user.accountCode+'. Selecione os números para copiar.'; }
  };
  el('filterFriends').addEventListener('input',render);
  el('clearSearch').onclick=()=>{searchVersion++;el('searchSection').hidden=true;el('friendQuery').value='';el('searchStatus').textContent='';el('friendSearchForm').querySelector('button').disabled=false;};
  el('friendSearchForm').onsubmit=async event=>{
    event.preventDefault(); const q=el('friendQuery').value.trim(); if(q.length<2)return;
    const version=++searchVersion, button=event.currentTarget.querySelector('button');button.disabled=true;el('searchStatus').textContent='Buscando jogadores…';
    try { const data=await api('/api/users/search?q='+encodeURIComponent(q)); if(version!==searchVersion)return; found=data.users;renderResults();el('searchSection').hidden=false;el('searchStatus').textContent=found.length+' resultado(s). Confira o código para identificar a conta.'; }
    catch(error){if(version===searchVersion)el('searchStatus').textContent=error.message;}
    finally{if(version===searchVersion)button.disabled=false;}
  };
  results.onclick=async event=>{
    const button=event.target.closest('[data-add]');if(!button)return;button.disabled=true;button.textContent='Adicionando…';
    try { const {friend}=await api('/api/friends',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountCode:button.dataset.add})});if(!friends.some(f=>f.id===friend.id))friends.push(friend);status.textContent=name(friend)+' adicionado à sua companhia.';render();renderResults(); }
    catch(error){el('searchStatus').textContent=error.message;button.disabled=false;button.textContent='Adicionar';}
  };
  await load();
})();
