(async () => {
  'use strict';
  const { api, esc } = Grimorio, $ = selector => document.querySelector(selector);
  const user = await Grimorio.currentUser(); if (!user) return Grimorio.loginRedirect();
  const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
  const notice = message => { $('#sessionNotice').textContent = message; };
  const run = task => Promise.resolve().then(task).catch(error => notice(error.message));
  let info;
  try { info = await api('/api/campaigns/' + code); } catch (error) { notice(error.message); return; }
  if (info.role === 'guest') { location.href = '/lobby.html?code=' + encodeURIComponent(code); return; }
  const master = info.role === 'master';
  const notesSection=document.createElement('details');notesSection.className='table-master-notes';notesSection.hidden=!master;notesSection.innerHTML='<summary>Anotações do mestre</summary><textarea id="masterNotes" rows="5" maxlength="10000" aria-label="Anotações privadas do mestre"></textarea><button id="saveMasterNotes" class="button button-secondary">Salvar anotações</button><small>Visíveis somente para você.</small>';$('.table-library').append(notesSection);
  $('#sessionName').textContent = info.campaign.name;
  $('#sessionRole').textContent = master ? 'VISÃO DO MESTRE' : 'VISÃO DO JOGADOR';
  $('#backLobby').href = '/lobby.html?code=' + encodeURIComponent(code);
  $('#playerSheetHeading').textContent = master ? 'Fichas dos players' : 'Minhas fichas na mesa';
  $('#masterLibrary').hidden = !master;
  const socket = io({ auth: { token: localStorage.getItem('grimorio_auth_token') } });
  const dice = GrimorioDice.create($('#tableDice'), $('#diceAnnouncement'));
  let selected = null, players = [], allSheets = [], ownSheets = [], folders = [], members = [], privateChat = false;
  let sheetRefresh = Promise.resolve(); const windows = new Map(), rollHistory = new Map(); let zIndex = 30, notesDirty = false;
  socket.on('app:error', notice);
  socket.on('room:state', ({ campaign, players: online }) => {
    boardRender(campaign.state.tokens || []); rememberRolls(campaign.state.rolls || []); if (online) renderPlayers(online);
    $('#tableConnection').textContent = 'AO VIVO';
    if(master&&typeof campaign.state.notes==='string') {
      if(campaign.state.notes===$('#masterNotes').value)notesDirty=false;
      if(!notesDirty&&document.activeElement!==$('#masterNotes'))$('#masterNotes').value=campaign.state.notes;
    }
  });
  socket.on('room:players', online => { renderPlayers(online); renderSheetLists(); });
  socket.on('sheet:list-changed', () => refreshSheets());
  socket.on('sheet:updated', sheet => {
    for (const entry of windows.values()) entry.frame.contentWindow?.postMessage({ type: 'grimorio:sheet-updated', sheet }, location.origin);
    const opened=windows.get(sheet.id);if(opened){opened.element.querySelector('.table-sheet-handle strong').textContent=sheet.name||'Personagem';opened.frame.title='Ficha de '+(sheet.name||'Personagem');}
    const current = allSheets.find(row => row.id === sheet.id); if (current) Object.assign(current, sheet);
    renderSheetLists();
  });
  socket.on('dice:result', roll => { rememberRolls([roll]); dice.play(roll); });
  socket.on('dice:history', payload => rememberRolls(payload.rolls || []));
  socket.on('session:message', message => {
    const row = document.createElement('div'); row.className = 'chat-msg';
    row.innerHTML = `<small>${esc(message.sender)}${message.private ? ' · privado' : ''}</small><div>${esc(message.body)}</div>`;
    $('#chatLog').append(row); $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
  });
  socket.emit('room:join', { code, token: localStorage.getItem('grimorio_auth_token'), playerName: master ? 'Mestre' : user.displayName });
  $('#saveMasterNotes').onclick=()=>socket.emit('master:save-notes',{notes:$('#masterNotes').value});
  $('#masterNotes').addEventListener('input',()=>{notesDirty=true;});
  const loadOlder=document.createElement('button');loadOlder.className='button button-secondary compact';loadOlder.textContent='Carregar rolagens anteriores';loadOlder.hidden=true;$('.table-roll-log').append(loadOlder);let historyCursor=null;
  async function loadHistory(){loadOlder.disabled=true;try{const query=historyCursor?'?before='+encodeURIComponent(historyCursor.createdAt||historyCursor.at)+'&beforeId='+encodeURIComponent(historyCursor.id):'';const rows=(await api(`/api/campaigns/${code}/rolls${query}`)).rolls||[];rememberRolls(rows);if(rows.length)historyCursor=rows.at(-1);loadOlder.hidden=rows.length<200;}finally{loadOlder.disabled=false;}}
  loadOlder.onclick=()=>run(loadHistory);
  function boardRender(tokens) {
    const board = $('#board'); board.innerHTML = ''; const at = new Map(tokens.map(token => [`${token.x},${token.y}`,token]));
    for (let y=0;y<20;y++) for(let x=0;x<30;x++) {
      const button = document.createElement('button'), token = at.get(`${x},${y}`); button.className = 'board-cell'; button.type = 'button';
      button.setAttribute('aria-label', token ? `Selecionar ${token.name}` : `Casa ${x+1}, ${y+1}`);
      if (token) {
        const badge = document.createElement('span'); badge.className = 'token'; badge.textContent = (token.name || '?')[0];
        if (/^#[a-f\d]{3,8}$/i.test(token.color || '')) badge.style.background = token.color;
        button.append(badge); button.onclick = () => { selected = token.id; notice(`${token.name}: escolha uma casa no tabuleiro.`); };
      } else button.onclick = () => { if(selected) { socket.emit('token:move',{tokenId:selected,x,y});selected=null; } };
      board.append(button);
    }
  }
  function rememberRolls(rows) {
    for (const row of rows) if (row?.id) rollHistory.set(row.id,row);
    $('#rolls').innerHTML = [...rollHistory.values()].sort((a,b)=>new Date(b.createdAt || b.at || 0)-new Date(a.createdAt || a.at || 0)).map(roll => `<article class="roll-item"><div><strong>${esc(roll.characterName || roll.player || 'Jogador')}</strong><small>${esc(roll.label || 'Rolagem')} · D${roll.sides}: ${roll.value} · Bônus ${roll.modifier>=0?'+':''}${roll.modifier}</small></div><span class="roll-total" aria-label="Total">${roll.total}</span></article>`).join('') || '<p class="table-empty">As rolagens desta campanha aparecerão aqui.</p>';
  }
  function renderPlayers(online) {
    players = online; $('#playersBar').innerHTML = online.map(player=>`<button class="table-player" data-player="${esc(player.id)}"><span class="status-dot"></span>${esc(player.name)}</button>`).join('');
    const previous = $('#recipient').value;
    $('#recipient').innerHTML = '<option value="">Escolha um jogador</option>'+online.filter(player=>player.id!==socket.id).map(player=>`<option value="${esc(player.id)}">${esc(player.name)}</option>`).join('');
    $('#recipient').value = previous;
    $('#playersBar').querySelectorAll('button').forEach(button=>button.onclick=()=>{setChat(true);$('#recipient').value=button.dataset.player;$('#chatText').focus();});
  }
  function setChat(value) { privateChat=value;$('#recipient').classList.toggle('hidden',!value);$('#publicTab').classList.toggle('active',!value);$('#privateTab').classList.toggle('active',value); }
  $('#publicTab').onclick=()=>setChat(false);$('#privateTab').onclick=()=>setChat(true);
  $('#chatForm').onsubmit=event=>{event.preventDefault();const body=$('#chatText').value.trim();if(!body)return;if(privateChat&&!$('#recipient').value)return notice('Escolha um jogador para a mensagem direta.');socket.emit('session:chat',{body,recipientSocketId:privateChat?$('#recipient').value:null});$('#chatText').value='';};
  function refreshSheets() {
    sheetRefresh = sheetRefresh.then(async()=>{
      const requests = [api(`/api/campaigns/${code}/sheets`),api(`/api/campaigns/${code}/members`)];
      if(master) requests.push(api('/api/sheets'),api('/api/sheet-folders'));
      const [campaign, people, library, structure] = await Promise.all(requests);
      allSheets=campaign.sheets || [];members=people.members || [];ownSheets=library?.sheets || [];folders=structure?.folders || [];
      renderSheetLists();
    }).catch(error=>notice(error.message));return sheetRefresh;
  }
  function sheetButton(sheet, assignment = false) {
    const wrapper=document.createElement('div');wrapper.className='table-sheet-row';
    const person=members.find(member=>member.id===(sheet.assignedUserId||sheet.userId));
    const online=players.some(player=>(player.userId||player.id)===(sheet.assignedUserId||sheet.userId));
    wrapper.innerHTML=`<button class="table-sheet-open"><span>${esc(sheet.name || 'Personagem sem nome')}</span><small>${online?'● Presente · ':''}${esc(person?.displayName || sheet.ownerName || 'Sua biblioteca')}</small></button>`;
    wrapper.querySelector('button').onclick=()=>openWindow(sheet);
    if(assignment&&master){
      const select=document.createElement('select');select.setAttribute('aria-label',`Atribuir ${sheet.name} a um jogador`);
      select.innerHTML='<option value="">Atribuir a jogador…</option>'+members.filter(member=>!member.isMaster&&member.id!==user.id).map(member=>`<option value="${esc(member.id)}" ${sheet.assignedUserId===member.id?'selected':''}>${esc(member.displayName||member.playerName)}</option>`).join('');
      select.onchange=()=>run(async()=>{await api(`/api/campaigns/${code}/sheets/${sheet.id}/assign`,{method:'PUT',body:JSON.stringify({userId:select.value||null})});await refreshSheets();notice('Ficha atribuída. O jogador já pode abri-la na mesa.');});wrapper.append(select);
    }
    return wrapper;
  }
  function renderSheetLists() {
    const host=$('#playerSheets');host.innerHTML='';
    const visible=master?allSheets.filter(sheet=>sheet.userId!==user.id||sheet.assignedUserId):allSheets;
    for(const sheet of visible)host.append(sheetButton(sheet));
    if(!visible.length)host.innerHTML='<p class="table-empty">As fichas dos participantes aparecerão aqui. O mestre também pode atribuir uma ficha de sua biblioteca.</p>';
    if(!master)return;
    const library=$('#ownSheets');library.innerHTML='';
    const groups=new Map();for(const sheet of ownSheets){const folder=folders.find(row=>row.id===sheet.folderId);const key=folder?GrimorioSheetTools.folderPath(folder,folders):'Sem pasta';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(sheet);}
    for(const [name,sheets] of groups){const group=document.createElement('details');group.open=true;const summary=document.createElement('summary');summary.textContent=`${name} (${sheets.length})`;group.append(summary);for(const sheet of sheets)group.append(sheetButton({...sheet,assignedUserId:allSheets.find(row=>row.id===sheet.id)?.assignedUserId},true));library.append(group);}
    if(!ownSheets.length)library.innerHTML='<p class="table-empty">Prepare personagens na biblioteca de fichas e abra-os aqui.</p>';
  }
  function openWindow(sheet) {
    if(windows.has(sheet.id)){windows.get(sheet.id).element.scrollIntoView({behavior:'smooth',block:'center'});return;}
    $('#deskHint').hidden=true;
    const element=document.createElement('article');element.className='table-sheet-window';element.style.zIndex=++zIndex;
    element.innerHTML=`<header class="table-sheet-handle" tabindex="0" aria-label="Mover janela da ficha. Use as setas para reposicionar."><strong>${esc(sheet.name || 'Personagem')}</strong><div><button data-reset title="Restaurar posição e tamanho">↺</button><button data-minimize title="Recolher ficha">−</button><button data-close title="Fechar ficha">×</button></div></header><iframe title="Ficha de ${esc(sheet.name || 'Personagem')}" loading="lazy"></iframe><small class="sheet-window-hint">Arraste pelo título · Redimensione pelo canto inferior direito</small>`;
    const frame=element.querySelector('iframe');frame.src=`/ficha.html?campaign=${encodeURIComponent(code)}&sheet=${encodeURIComponent(sheet.id)}&embedded=1`;
    const entry={element,frame,x:0,y:0};windows.set(sheet.id,entry);$('#sheetDesk').append(element);
    const setPosition=(x,y)=>{const desk=$('#sheetDesk');entry.x=Math.max(-element.offsetLeft,Math.min(desk.clientWidth-Math.min(element.offsetWidth,desk.clientWidth)-element.offsetLeft,x));entry.y=Math.max(100-(desk.getBoundingClientRect().top+window.scrollY)-element.offsetTop,y);element.style.transform=`translate(${entry.x}px,${entry.y}px)`;};
    element.querySelector('[data-close]').onclick=()=>{
      let unsaved=false;try{unsaved=frame.contentWindow?.GrimorioSheetState?.isDirty();}catch{}
      if(unsaved&&!confirm('Há alterações não salvas nesta ficha. Fechar mesmo assim?'))return;
      element.remove();windows.delete(sheet.id);$('#deskHint').hidden=windows.size>0;
    };
    element.querySelector('[data-minimize]').onclick=()=>element.classList.toggle('minimized');
    element.querySelector('[data-reset]').onclick=()=>{setPosition(0,0);element.style.width='';element.style.height='';element.classList.remove('minimized');};
    const handle=element.querySelector('header');
    handle.onkeydown=event=>{if(event.target!==handle||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();setPosition(entry.x+({'ArrowLeft':-20,'ArrowRight':20}[event.key]||0),entry.y+({'ArrowUp':-20,'ArrowDown':20}[event.key]||0));};
    handle.onpointerdown=event=>{if(event.target.closest('button'))return;event.preventDefault();element.style.zIndex=++zIndex;const x=event.clientX,y=event.clientY,previousX=entry.x,previousY=entry.y;handle.setPointerCapture(event.pointerId);element.classList.add('moving');const move=event=>setPosition(previousX+event.clientX-x,previousY+event.clientY-y);const stop=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);element.classList.remove('moving');};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);};
    element.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  window.addEventListener('message',event=>{if(event.origin!==location.origin||![...windows.values()].some(entry=>entry.frame.contentWindow===event.source))return;if(event.data?.type==='grimorio:sheet-saved')refreshSheets();});
  $('#refreshSheets').onclick=()=>refreshSheets();
  $('#quickRoll').onsubmit=event=>{event.preventDefault();socket.emit('dice:roll',{sides:Number($('#quickDie').value),modifier:Number($('#quickBonus').value)||0,label:'Rolagem da mesa',characterName:master?'Mestre':user.displayName});};
  await Promise.all([refreshSheets(),run(loadHistory)]);
  window.addEventListener('pagehide',()=>{socket.disconnect();dice.destroy();});
})().catch(error=>{const notice=document.querySelector('#sessionNotice');if(notice)notice.textContent=error.message;});
