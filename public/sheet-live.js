(function () {
  'use strict';
  const params = new URLSearchParams(location.search), campaign = (params.get('campaign') || '').toUpperCase();
  const embedded = params.get('embedded') === '1' && window.parent !== window;
  const copy = GrimorioSheetTools.copy;
  let version = 1, base = null, pending = null, conflicts = [], timer = null, saving = false, saveAgain = false;
  const library = createSheetLibrary({ api, esc, open: id => openSheet(id), toast, container: $('#sheetCards') });
  const endpoint = id => campaign ? `/api/campaigns/${campaign}/sheets/${id}` : '/api/sheets/' + id;
  const unwrap = value => value?.sheet || value;
  const hydrate = value => ({ ...fresh(), ...value, modules: { ...fresh().modules, ...value.modules }, resources: { ...fresh().resources, ...value.resources } });
  const conflictBox = document.createElement('div'); conflictBox.className = 'sheet-conflict hidden'; conflictBox.setAttribute('role', 'alert');
  $('#sheetEditor').prepend(conflictBox);
  if (embedded) {
    document.body.classList.add('sheet-embedded');
    $('#backLibrary').hidden = true;
    $('#rollCampaign').disabled = true;
  }
  function drawPreservingFocus() {
    const active = document.activeElement, id = active?.id, aria = active?.getAttribute('aria-label');
    const selection = { start: active?.selectionStart, end: active?.selectionEnd }, scroll = window.scrollY;
    render();
    const next = id ? document.getElementById(id) : aria ? [...document.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === aria) : null;
    if (next) { next.focus({ preventScroll: true }); if (selection.start !== null && selection.start !== undefined && next.setSelectionRange) { try { next.setSelectionRange(selection.start,selection.end); } catch {} } }
    window.scrollTo(0,scroll);
  }
  function showConflicts() {
    conflictBox.classList.toggle('hidden', !conflicts.length);
    if (!conflicts.length) return;
    clearTimeout(timer);
    conflictBox.innerHTML = `<strong>Esta ficha foi editada ao mesmo tempo.</strong><p>Há alterações diferentes em: ${esc(conflicts.slice(0,6).join(', '))}. Seu rascunho foi preservado. Escolha como continuar.</p><div><button class="button button-secondary" data-remote>Usar versão da mesa</button><button class="button button-primary" data-local>Manter minhas alterações nesses campos</button></div>`;
    conflictBox.querySelector('[data-remote]').onclick = () => { data=hydrate(copy(base));dirty=false;conflicts=[];showConflicts();render();status(); };
    conflictBox.querySelector('[data-local]').onclick = () => { conflicts=[];showConflicts();save().catch(error=>toast(error.message,true)); };
  }
  function receive(sheet) {
    sheet=unwrap(sheet);
    if (!sheet || sheet.id !== currentId || !sheet.data || Number(sheet.version || 1) <= version) return;
    if (saving) { if (!pending || Number(sheet.version) > Number(pending.version)) pending=sheet; return; }
    collect();
    if (dirty) {
      const result=GrimorioSheetTools.merge(base,data,sheet.data);
      data=hydrate(result.value); conflicts=[...new Set([...conflicts,...result.conflicts])];
    } else { data=hydrate(copy(sheet.data)); conflicts=[]; }
    base=copy(sheet.data);version=Number(sheet.version || version+1);
    dirty=JSON.stringify(data)!==JSON.stringify(hydrate(base));
    drawPreservingFocus();showConflicts();status();
    if(dirty&&!conflicts.length)scheduleSave();
  }
  function scheduleSave() {
    clearTimeout(timer);
    if (!campaign || !currentId || conflicts.length) return;
    timer=setTimeout(()=>save(true).catch(error=>toast(error.message,true)),650);
  }
  openSheet = async function (id) {
    if(dirty&&id!==currentId&&!confirm('Sair da ficha com alterações não salvas?'))return;
    clearTimeout(timer);
    const sheet=unwrap(await api(endpoint(id)));
    currentId=id;version=Number(sheet.version || 1);base=copy(sheet.data);data=hydrate(sheet.data);pending=null;conflicts=[];dirty=false;
    $('#sheetLibrary').classList.add('hidden');$('#sheetEditor').classList.remove('hidden');
    render();showConflicts();status();
  };
  save = async function (quiet = false) {
    if(!currentId||!data)return;
    if(conflicts.length){showConflicts();return;}
    if(saving){saveAgain=true;return;}
    collect();const sheetId=currentId,snapshot=copy(data),expectedVersion=version;let completed=false;saving=true;clearTimeout(timer);status();
    try {
      const result=unwrap(await api(endpoint(sheetId),{method:'PUT',body:JSON.stringify({data:snapshot,expectedVersion})}));
      if(currentId!==sheetId)return;
      collect();const saved=result?.data || snapshot;
      data=hydrate(GrimorioSheetTools.merge(snapshot,data,saved).value);base=copy(saved);version=Number(result?.version || expectedVersion+1);
      dirty=JSON.stringify(data)!==JSON.stringify(hydrate(base));completed=true;
      if(!quiet)toast('Ficha salva e sincronizada.');
      if(embedded)window.parent.postMessage({type:'grimorio:sheet-saved',id:sheetId},location.origin);
    } catch(error) {
      if(error.status===409 || error.code==='40001' || /conflito|versão|version|alterada por/i.test(error.message)) {
        pending=unwrap(await api(endpoint(sheetId)));
        if(!quiet)toast('Recebemos alterações da mesa. Conferindo seu rascunho…');
      } else throw error;
    } finally {
      saving=false;
      if(pending){const latest=pending;pending=null;receive(latest);}
      status();if((saveAgain||(completed&&dirty))&&!conflicts.length){saveAgain=false;scheduleSave();}
    }
  };
  const previousMark=mark;
  mark = function () { dirty=true;status();scheduleSave(); };
  for(const id of ['charName','charSex','charAge','charPower','charCD']) {
    $('#'+id).removeEventListener('input',previousMark);
    $('#'+id).addEventListener('input',mark);
  }
  status = function () { $('#saveStatus').textContent=conflicts.length?'Conflito: escolha uma versão':saving?'Sincronizando…':dirty?(campaign?'Alterações pendentes…':'Alterações não salvas'):(campaign?'Sincronizada ao vivo':'Ficha salva'); };
  createSheet = async function () {
    const sheet=unwrap(await api('/api/sheets',{method:'POST',body:JSON.stringify({data:fresh(),folderId:library.currentFolder()})}));
    await openSheet(sheet.id);
  };
  loadLibrary = () => library.load();
  $('#newSheet').onclick=()=>createSheet().catch(error=>toast(error.message,true));
  $('#saveSheet').onclick=()=>save().catch(error=>toast(error.message,true));
  $('#backLibrary').onclick=()=>{
    if(dirty&&!confirm('Sair sem salvar as alterações?'))return;
    clearTimeout(timer);currentId=null;data=null;dirty=false;conflicts=[];
    $('#sheetEditor').classList.add('hidden');$('#sheetLibrary').classList.remove('hidden');activePanel='';document.body.classList.remove('panel-open','story-open');
    loadLibrary().catch(error=>toast(error.message,true));
  };
  window.GrimorioSheetState={isDirty:()=>dirty||saving||conflicts.length>0};
  window.sendSheetRoll=function(sides,modifier,label){
    if(!data)return;collect();
    if(rollCampaignCode){
      $('#manualResult strong').textContent='…';$('#manualResult small').textContent='Aguardando o resultado da mesa';
      sheetSocket.emit('dice:roll',{sides,modifier,label,characterName:data.name||'Personagem'});
    }else{
      const value=1+Math.floor(Math.random()*sides),total=value+modifier;
      $('#manualResult strong').textContent=total;$('#manualResult small').textContent=`D${sides}: ${value} · Bônus ${modifier>=0?'+':''}${modifier} · Total ${total}`;
      toast(`${label}: ${total}`);
    }
  };
  rollFromSheet=(label,modifier)=>sendSheetRoll(20,modifier,label);
  sheetSocket.on('dice:result',roll=>{
    if(!rollCampaignCode)return;
    $('#manualResult strong').textContent=roll.total;
    $('#manualResult small').textContent=`${roll.characterName||roll.player||'Jogador'} · ${roll.label||'Rolagem'} · D${roll.sides}: ${roll.value} · Bônus ${roll.modifier>=0?'+':''}${roll.modifier}`;
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-damage]');if(!button)return;
    const expression=GrimorioSheetTools.damage(button.dataset.damage);
    if(!expression)return toast('Use o formato de dano 2d6 + 3 (até 20 dados).',true);
    for(let index=0;index<expression.count;index++)sendSheetRoll(expression.sides,index===0?expression.modifier:0,`${button.dataset.label} · dano ${index+1}/${expression.count}`);
  });
  sheetSocket.on('sheet:updated',receive);
  window.addEventListener('message',event=>{if(embedded&&event.origin===location.origin&&event.source===window.parent&&event.data?.type==='grimorio:sheet-updated')receive(event.data.sheet);});
  // Recover missed updates after reconnect or returning from an inactive tab.
  const reloadCurrent=()=>{if(currentId&&campaign)api(endpoint(currentId)).then(receive).catch(error=>toast(error.message,true));};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)reloadCurrent();});
  sheetSocket.on('room:state',()=>{if(currentId&&campaign&&!saving&&!dirty)reloadCurrent();});
  loadRollCampaigns();
  const id=params.get('sheet');
  (id?openSheet(id):loadLibrary()).catch(error=>toast(error.message,true));
})();
