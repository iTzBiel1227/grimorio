(async () => {
  const {api,esc} = Grimorio;
  const user = await Grimorio.requireUser();
  if (!user) return;
  const el = id => document.querySelector('#'+id);
  const createForm=el('create'), joinForm=el('join'), nameInput=el('campaignName'), codeInput=el('code'), playerInput=el('player');
  let campaigns=[], invitations=[], role='all', loading=false;
  const say=(id,text,error=false)=>{el(id).textContent=text;el(id).classList.toggle('error',error);};
  function render() {
    el('campaignTotal').textContent=campaigns.length;
    el('campaignMasterTotal').textContent=campaigns.filter(c=>c.role==='master').length;
    el('campaignPlayerTotal').textContent=campaigns.filter(c=>c.role==='player').length;
    const query=el('campaignSearch').value.trim().toLocaleLowerCase('pt-BR');
    const list=campaigns.filter(c=>(role==='all'||c.role===role)&&(c.name.toLocaleLowerCase('pt-BR').includes(query)||c.code.toLowerCase().includes(query)));
    el('campaigns').innerHTML=list.map(c=>`<article class="panel world-card"><div class="world-card-top"><span class="mini-label">${c.role==='master'?'MESTRE':'JOGADOR'}</span><span class="world-status ${c.status==='session'?'live':''}">${c.status==='session'?'Sessão iniciada':'No lobby'}</span></div><h3>${esc(c.name)}</h3><div class="world-code">CONVITE · ${esc(c.code)}</div><div class="campaign-actions"><a class="button button-primary" href="/${c.status==='session'?'sessao':'lobby'}.html?code=${encodeURIComponent(c.code)}">${c.status==='session'?'Abrir sessão':'Abrir lobby'} ↗</a><button type="button" class="button button-secondary invite" data-code="${esc(c.code)}">Copiar convite</button></div></article>`).join('') || `<div class="hub-empty"><h3>${campaigns.length?'Nenhum mundo encontrado':'Seu próximo mundo começa aqui'}</h3><p>${campaigns.length?'Experimente outro filtro ou nome.':'Crie uma campanha ou entre com o convite do seu grupo.'}</p></div>`;
    el('campaigns').querySelectorAll('.invite').forEach(button=>button.onclick=async()=>{
      try{await navigator.clipboard.writeText(`${location.origin}/lobby.html?code=${button.dataset.code}`);say('campaignStatus','Convite copiado. Compartilhe com seu grupo.');}
      catch{say('campaignStatus','Código do convite: '+button.dataset.code);}
    });
    el('campaigns').querySelectorAll('.world-card').forEach((card,index)=>{
      const campaign=list[index];
      const button=document.createElement('button');button.type='button';button.className='button button-secondary campaign-people-button';button.textContent=campaign.role==='master'?'Participantes e convites':'Ver participantes';
      button.onclick=()=>window.GrimorioCampaignPeople.open({code:campaign.code,name:campaign.name,canInvite:campaign.role==='master'});
      card.querySelector('.campaign-actions').append(button);
    });
  }
  function renderInvites(){
    el('campaignInviteInbox').hidden=invitations.length===0;
    el('campaignInviteCount').textContent=invitations.length;
    el('campaignInvites').innerHTML=invitations.map(invite=>`<article class="panel world-card incoming-campaign"><span class="mini-label">CONVITE PARA AVENTURA</span><h3>${esc(invite.campaign?.name||'Campanha')}</h3><p>${esc(invite.inviter?.displayName||invite.inviter?.username||'Um amigo')} convidou você para participar.</p><div class="campaign-actions"><button type="button" class="button button-primary" data-accept-invite="${esc(invite.id)}">Aceitar convite</button><button type="button" class="text-button" data-decline-invite="${esc(invite.id)}">Recusar</button></div></article>`).join('');
  }
  async function load({quiet=false}={}){if(loading)return;loading=true;el('refreshCampaigns').disabled=true;if(!quiet)say('campaignStatus','Carregando seus mundos…');try{const [mine,received]=await Promise.all([api('/api/my/campaigns'),api('/api/campaign-invites')]);campaigns=mine.campaigns||[];invitations=received.invites||[];render();renderInvites();if(!quiet)say('campaignStatus','');}catch(error){say('campaignStatus',error.message+' Use Atualizar para tentar novamente.',true);}finally{loading=false;el('refreshCampaigns').disabled=false;}}
  el('campaignInvites').onclick=async event=>{
    const button=event.target.closest('[data-accept-invite],[data-decline-invite]');if(!button||button.disabled)return;
    const accept=Boolean(button.dataset.acceptInvite),id=button.dataset.acceptInvite||button.dataset.declineInvite;button.disabled=true;
    try{await api('/api/campaign-invites/'+encodeURIComponent(id)+(accept?'/accept':'/decline'),{method:'POST'});await load({quiet:true});say('campaignStatus',accept?'Convite aceito! A campanha agora está nos seus mundos. Abra o lobby quando quiser jogar.':'Convite recusado.');}
    catch(error){say('campaignInviteFeedback',error.message,true);button.disabled=false;}
  };
  createForm.addEventListener('submit',async event=>{
    event.preventDefault();const name=nameInput.value.trim();nameInput.setCustomValidity(name?'':'Digite um nome para a campanha.');if(!createForm.reportValidity())return;
    const button=createForm.querySelector('button');if(button.disabled)return;button.disabled=true;say('createError','');
    try{const data=await api('/api/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});location.href='/lobby.html?code='+data.campaign.code;}
    catch(error){say('createError',error.message,true);}finally{button.disabled=false;}
  });
  nameInput.addEventListener('input',()=>nameInput.setCustomValidity(''));
  joinForm.addEventListener('submit',async event=>{
    event.preventDefault();const code=codeInput.value.trim().toUpperCase(),playerName=playerInput.value.trim();playerInput.setCustomValidity(playerName?'':'Informe seu nome na mesa.');if(!joinForm.reportValidity())return;
    const button=joinForm.querySelector('button');if(button.disabled)return;button.disabled=true;say('joinError','');
    try{await api('/api/campaigns/'+encodeURIComponent(code)+'/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerName})});location.href='/lobby.html?code='+encodeURIComponent(code);}
    catch(error){say('joinError',error.message,true);}finally{button.disabled=false;}
  });
  playerInput.addEventListener('input',()=>playerInput.setCustomValidity(''));
  codeInput.value=new URLSearchParams(location.search).get('room')||'';
  playerInput.value=user.displayName||'';
  el('campaignSearch').addEventListener('input',render);
  el('refreshCampaigns').onclick=()=>load();
  document.querySelectorAll('[data-role]').forEach(button=>button.onclick=()=>{role=button.dataset.role;document.querySelectorAll('[data-role]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();});
  await load();
  const timer=setInterval(()=>{if(!document.hidden)load({quiet:true});},10000);
  window.addEventListener('focus',()=>load({quiet:true}));
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
})();
