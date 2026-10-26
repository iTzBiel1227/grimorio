const token=localStorage.getItem('grimorio_auth_token');
if(!token&&!window.GrimorioSupabase) Grimorio.loginRedirect();
const H={'Content-Type':'application/json',Authorization:`Bearer ${token}`};
const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
const ATTR=['CARISMA','CONSTITUIÇÃO','DESTREZA','FORÇA','INTELIGÊNCIA','PODER'];
const SKILLS=['ACROBACIA','ARTES','ENGANAÇÃO','MECÂNICA','PILOTAR','VONTADE','PRESTIDIGITAÇÃO','ALQUIMIA','CIÊNCIAS EX','FURTIVIDADE','MEDICINA','HACKER','INICIATIVA','ATLETISMO','INVESTIGAÇÃO','CHARME','NATUREZA','SOBREVIVÊNCIA','NAVEGAR','INTIMIDAÇÃO','ATUALIDADES','PERCEPÇÃO','DIPLOMACIA','OFÍCIO','TECNOLOGIA','VIGOR','AGILIDADE'];
const COMBAT=['ATIRAR','ARMAS C-A-C','ARTES MARC','OCULTISMO'];
const MODULES={identity:'Identidade e retrato',resources:'Vida, energia e sanidade',attributes:'Atributos',skills:'Perícias',combat:'Perícias de combate'};
let currentId=null, data=null, dirty=false, activePanel='', rollCampaignCode='';
const sheetSocket=io({auth:{token:localStorage.getItem('grimorio_auth_token')}});
let currentUser=null;
const fresh=()=>({name:'',sex:'',age:'',power:0,cd:10,portrait:'',theme:'red',modules:{identity:true,resources:true,attributes:true,skills:true,combat:true},resources:{vida:{label:'Vida',current:10,max:10,visible:true},energia:{label:'Energia / Mana',current:10,max:10,visible:true},sanidade:{label:'Sanidade',current:10,max:10,visible:true}},attributes:Object.fromEntries(ATTR.map(x=>[x,0])),skills:Object.fromEntries(SKILLS.map(x=>[x,0])),combat:Object.fromEntries(COMBAT.map(x=>[x,0])),abilities:[],passives:[],inventory:[],story:'',layoutPositions:{}});
function toast(m,e=false){const t=$('#sheetToast');t.textContent=m;t.classList.remove('hidden','error');if(e)t.classList.add('error');setTimeout(()=>t.classList.add('hidden'),2600)}
async function api(url,opt={}){if(window.GrimorioSupabase){try{return await Grimorio.api(url,opt)}catch(error){if(error.status===401)Grimorio.loginRedirect();throw error}}const r=await fetch(url,{...opt,headers:{...H,...opt.headers}});if(r.status===401){localStorage.removeItem('grimorio_auth_token');Grimorio.loginRedirect();throw Error('Sessão expirada')}if(!r.ok){let x={};try{x=await r.json()}catch{}const error=Error(x.error||'Não foi possível concluir.');error.status=r.status;throw error}return r.status===204?null:r.json()}
async function loadLibrary(){const x=await api('/api/sheets');const c=$('#sheetCards');c.innerHTML='';if(!x.sheets.length)c.innerHTML='<div class="empty-sheet panel"><strong>Nenhuma ficha criada.</strong><p>Seu próximo personagem pode começar aqui.</p></div>';x.sheets.forEach(s=>{const el=document.createElement('article');el.className='sheet-card panel';el.innerHTML=`<div class="sheet-card-rune">✦</div><span class="mini-label">PERSONAGEM</span><h3>${esc(s.name)}</h3><p>Atualizada em ${new Date(s.updatedAt).toLocaleDateString('pt-BR')}</p><div><button class="button button-secondary open">Abrir ficha</button><button class="icon-button del" title="Excluir">×</button></div>`;el.querySelector('.open').onclick=()=>openSheet(s.id);el.querySelector('.del').onclick=async()=>{if(confirm('Excluir esta ficha?')){await api('/api/sheets/'+s.id,{method:'DELETE'});loadLibrary()}};c.append(el)})}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function openSheet(id){const s=await api('/api/sheets/'+id);currentId=id;data={...fresh(),...s.data,modules:{...fresh().modules,...s.data.modules},resources:{...fresh().resources,...s.data.resources}};$('#sheetLibrary').classList.add('hidden');$('#sheetEditor').classList.remove('hidden');render();dirty=false;status()}
async function createSheet(){const d=fresh();const s=await api('/api/sheets',{method:'POST',body:JSON.stringify({data:d})});openSheet(s.id)}
function render(){ applySheetTheme(data.theme||'red'); $('#charName').value=data.name||'';$('#charSex').value=data.sex||'';$('#charAge').value=data.age||'';$('#charPower').value=data.power??0;$('#charCD').value=data.cd??10;if(data.portrait){$('#portraitPreview').src=data.portrait;$('#portraitPreview').classList.remove('hidden');$('#portraitPlaceholder').classList.add('hidden')}else{$('#portraitPreview').classList.add('hidden');$('#portraitPlaceholder').classList.remove('hidden')}renderModules();renderResources();renderNumbers('#attributesGrid',ATTR,data.attributes,'attribute');renderNumbers('#skillsGrid',SKILLS,data.skills,'skill');renderNumbers('#combatGrid',COMBAT,data.combat,'combat');renderToggles();if(activePanel)openPanel(activePanel)}
function renderModules(){$$('.module').forEach(el=>el.classList.toggle('module-hidden',data.modules[el.dataset.module]===false))}
function renderToggles(){const box=$('#moduleToggles');box.innerHTML='';Object.entries(MODULES).forEach(([k,v])=>{const l=document.createElement('label');l.className='toggle-chip';l.innerHTML=`<input type="checkbox" ${data.modules[k]!==false?'checked':''}><span>${v}</span>`;l.querySelector('input').onchange=e=>{data.modules[k]=e.target.checked;mark();renderModules()};box.append(l)});Object.entries(data.resources).forEach(([k,r])=>{const l=document.createElement('label');l.className='toggle-chip resource-toggle';l.innerHTML=`<input type="checkbox" ${r.visible!==false?'checked':''}><span>Mostrar ${esc(r.label)}</span>`;l.querySelector('input').onchange=e=>{r.visible=e.target.checked;mark();renderResources()};box.append(l)})}
function healthTier(pct){if(pct<=0)return 'health-0';if(pct<=25)return 'health-25';if(pct<=50)return 'health-50';if(pct<=75)return 'health-75';return 'health-100'}
function renderResources(){
  const g=$('#resourcesGrid');g.innerHTML='';
  Object.entries(data.resources).forEach(([key,r])=>{
    if(r.visible===false)return;
    r.current=Number.isFinite(+r.current)?+r.current:0;r.max=Number.isFinite(+r.max)&&+r.max>0?+r.max:1;
    const pct=Math.max(0,Math.min(100,r.current/r.max*100));
    const el=document.createElement('div');
    el.className=`resource-card resource-${key} ${key==='vida'?healthTier(pct):''}`;
    el.innerHTML=`<div class="resource-head"><strong>${esc(r.label)}</strong></div><div class="resource-value"><button class="minus">−</button><input class="resource-current-input" type="number" min="0" value="${r.current}" aria-label="Valor atual de ${esc(r.label)}"><span class="resource-slash">/</span><input class="resource-max-input" type="number" min="1" value="${r.max}" aria-label="Valor máximo de ${esc(r.label)}"><button class="plus">+</button></div><div class="resource-bar"><i style="width:${pct}%"></i></div>`;
    const cur=el.querySelector('.resource-current-input'),max=el.querySelector('.resource-max-input');
    const sync=()=>{r.current=Math.max(0,+cur.value||0);r.max=Math.max(1,+max.value||1);mark();renderResources()};
    cur.onchange=sync;max.onchange=sync;
    el.querySelector('.minus').onclick=()=>{r.current=Math.max(0,r.current-1);mark();renderResources()};
    el.querySelector('.plus').onclick=()=>{r.current=r.current+1;mark();renderResources()};
    g.append(el);
  });
}
function renderNumbers(sel,names,obj,type){
  const g=$(sel);g.innerHTML='';
  names.forEach(n=>{
    const el=document.createElement('article');
    const isAttr=type==='attribute';
    el.className=isAttr?'stat-orb':'skill-line';
    if(isAttr){
      el.innerHTML=`<button class="roll-stat" type="button" title="Rolar ${n}"><span>${n}</span><strong>${obj[n]??0}</strong><small>ROLAR D20</small></button><label>Valor<input type="number" value="${obj[n]??0}" aria-label="Valor de ${n}"></label>`;
    }else{
      el.innerHTML=`<button class="skill-roll" type="button" title="Rolar ${n}"><span class="skill-die">◆</span><strong>${n}</strong><small>rolar</small></button><input type="number" value="${obj[n]??0}" aria-label="Valor de ${n}">`;
    }
    const input=el.querySelector('input');
    input.oninput=e=>{obj[n]=+e.target.value||0;mark();const strong=el.querySelector('.roll-stat strong');if(strong)strong.textContent=obj[n]};
    el.querySelector(isAttr?'.roll-stat':'.skill-roll').onclick=()=>rollFromSheet(n,+obj[n]||0,type);
    g.append(el);
  });
}
async function loadRollCampaigns(){
  try{
    const [me,x]=await Promise.all([api('/api/auth/me'),api('/api/my/campaigns')]); currentUser=me.user;
    const sel=$('#rollCampaign'); sel.innerHTML='<option value="">Somente nesta ficha</option>';
    x.campaigns.forEach(c=>{const o=document.createElement('option');o.value=c.code;o.textContent=`${c.name} · ${c.role==='master'?'Mestre':'Jogador'}`;o.dataset.player=c.role==='master'?'Mestre':(c.playerName||currentUser?.displayName||'Aventureiro');sel.append(o)});
    const preferred=new URLSearchParams(location.search).get('campaign'); if(preferred&&[...sel.options].some(o=>o.value===preferred)){sel.value=preferred;connectRollCampaign(preferred)}
  }catch(e){toast(e.message,true)}
}
function connectRollCampaign(code){
  rollCampaignCode=code||''; const state=$('#liveRollState');
  if(!code){sheetSocket.emit('room:leave');state.textContent='offline';state.classList.remove('live');return}
  const opt=[...$('#rollCampaign').options].find(o=>o.value===code); const player=opt?.dataset.player||currentUser?.displayName||'Aventureiro';
  sheetSocket.emit('room:join',{code,playerName:player,token:localStorage.getItem('grimorio_auth_token')}); state.textContent='conectando…';
}
function rollFromSheet(label,modifier,type){
  const value=1+Math.floor(Math.random()*20), total=value+modifier;
  if(rollCampaignCode){sheetSocket.emit('dice:roll',{sides:20,modifier,label,characterName:data?.name||'Personagem'});toast(`${label}: enviando rolagem para a mesa…`)}
  else toast(`${label}: D20 (${value}) ${modifier>=0?'+':''}${modifier} = ${total}`);
}
function collect(){data.name=$('#charName').value.trim();data.sex=$('#charSex').value.trim();data.age=$('#charAge').value;data.power=+$('#charPower').value||0;data.cd=+$('#charCD').value||0}
async function save(){collect();await api('/api/sheets/'+currentId,{method:'PUT',body:JSON.stringify({data})});dirty=false;status();toast('Ficha salva no Grimório.')}
function mark(){dirty=true;status()}function status(){$('#saveStatus').textContent=dirty?'Alterações não salvas':'Ficha salva'}
function openPanel(kind){
  activePanel=kind;const p=$('#sidePanel');p.classList.remove('hidden');p.classList.toggle('story-panel',kind==='story');document.body.classList.add('panel-open');document.body.classList.toggle('story-open',kind==='story');
  const titles={inventory:'Inventário',abilities:'Habilidades',passives:'Passivas',story:'História'};$('#sidePanelTitle').textContent=titles[kind];const c=$('#sidePanelContent');c.innerHTML='';
  if(kind==='story'){
    c.innerHTML='<label class="story-editor-label">História do personagem<textarea id="storyText" placeholder="Escreva a história, origem, relações, objetivos e acontecimentos do personagem..."></textarea></label>';
    $('#storyText').value=data.story||'';$('#storyText').oninput=e=>{data.story=e.target.value;mark()};return;
  }
  if(kind==='inventory')renderCollection(c,'inventory',{name:'Nome do item',description:'Descrição / quantidade',save:'Salvar item'});
  if(kind==='abilities')renderCollection(c,'abilities',{name:'Nome da habilidade',description:'Como funciona',damage:'Dano',save:'Salvar habilidade'});
  if(kind==='passives')renderCollection(c,'passives',{name:'Nome da passiva',description:'Descrição / efeito',save:'Salvar passiva'});
}
function renderCollection(c,key,labels){
  const arr=data[key]||[];
  const creator=document.createElement('section');creator.className='collection-creator';
  creator.innerHTML=`<span class="mini-label">NOVO REGISTRO</span><input class="draft-name" placeholder="${labels.name}"><textarea class="draft-description" rows="4" placeholder="${labels.description}"></textarea>${labels.damage?`<label>Dano<input class="draft-damage" placeholder="Ex.: 2d6 + 3"></label>`:''}<button class="button button-primary save-new" type="button">${labels.save}</button>`;
  creator.querySelector('.save-new').onclick=()=>{
    const name=creator.querySelector('.draft-name').value.trim(),description=creator.querySelector('.draft-description').value.trim(),damage=creator.querySelector('.draft-damage')?.value.trim()||'';
    if(!name)return toast('Dê um nome antes de salvar.',true);
    arr.push({name,description,damage});mark();openPanel(key);toast(labels.save.replace('Salvar','')+' salvo(a).');
  };c.append(creator);
  const divider=document.createElement('div');divider.className='collection-divider';divider.innerHTML='<span>SALVOS</span><i></i>';c.append(divider);
  if(!arr.length)c.insertAdjacentHTML('beforeend','<p class="empty-panel">Nada salvo ainda.</p>');
  arr.forEach((item,i)=>{
    const el=document.createElement('article');el.className='collection-saved';
    el.innerHTML=`<div class="saved-summary"><div><span class="mini-label">${key==='inventory'?'ITEM':key==='abilities'?'HABILIDADE':'PASSIVA'}</span><h3>${esc(item.name||'Sem nome')}</h3></div><div class="saved-actions"><button class="icon-button edit" title="Editar">✎</button><button class="icon-button remove" title="Excluir">×</button></div></div><p>${esc(item.description||'Sem descrição.')}</p>${labels.damage&&item.damage?`<button type="button" class="damage-badge" data-damage="${esc(item.damage)}" data-label="${esc(item.name)}" title="Rolar dano na mesa">Rolar dano · ${esc(item.damage)}</button>`:''}<div class="saved-editor hidden"><input class="edit-name" value="${esc(item.name)}"><textarea rows="4">${esc(item.description)}</textarea>${labels.damage?`<label>Dano<input class="edit-damage" value="${esc(item.damage||'')}"></label>`:''}<button class="button button-secondary save-edit" type="button">Salvar alterações</button></div>`;
    const editor=el.querySelector('.saved-editor');el.querySelector('.edit').onclick=()=>editor.classList.toggle('hidden');
    el.querySelector('.save-edit').onclick=()=>{item.name=el.querySelector('.edit-name').value.trim()||item.name;item.description=editor.querySelector('textarea').value.trim();if(labels.damage)item.damage=el.querySelector('.edit-damage').value.trim();mark();openPanel(key);toast('Alterações salvas no registro.');};
    el.querySelector('.remove').onclick=()=>{if(confirm('Excluir este registro?')){arr.splice(i,1);mark();openPanel(key)}};c.append(el);
  });
}
$('#newSheet').onclick=createSheet;$('#saveSheet').onclick=()=>save().catch(e=>toast(e.message,true));$('#backLibrary').onclick=()=>{if(dirty&&!confirm('Sair sem salvar as alterações?'))return;$('#sheetEditor').classList.add('hidden');$('#sheetLibrary').classList.remove('hidden');activePanel='';document.body.classList.remove('panel-open');loadLibrary()};$('#editLayout').onclick=()=>$('#layoutConfigurator').classList.toggle('hidden');$('#closePanel').onclick=()=>{$('#sidePanel').classList.add('hidden');activePanel='';document.body.classList.remove('panel-open','story-open');$('#sidePanel').classList.remove('story-panel')};$$('.side-tab').forEach(b=>b.onclick=()=>openPanel(b.dataset.panel));['charName','charSex','charAge','charPower','charCD'].forEach(id=>$('#'+id).addEventListener('input',mark));$('#portraitInput').onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>3e6)return toast('Use uma imagem de até 3 MB.',true);const r=new FileReader();r.onload=()=>{data.portrait=r.result;mark();render()};r.readAsDataURL(f)};window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});$('#rollCampaign').addEventListener('change',e=>connectRollCampaign(e.target.value));sheetSocket.on('room:state',()=>{if(rollCampaignCode){$('#liveRollState').textContent='ao vivo';$('#liveRollState').classList.add('live')}});sheetSocket.on('dice:result',r=>{if(rollCampaignCode)toast(`${r.characterName?r.characterName+' · ':''}${r.label||'Rolagem'}: ${r.total}`)});sheetSocket.on('app:error',m=>toast(m,true));

// ===== Ficha 3.0: navegação central e painel visual de dados =====
let selectedManualDie=20;
function renderCenterCollection(key, labels){
  const host=document.querySelector(key==='abilities'?'#abilitiesCenter':'#passivesCenter'); if(!host||!data)return;
  host.innerHTML='<div class="center-collection"><div class="collection-form-slot"></div><div class="collection-list"></div></div>';
  const form=host.querySelector('.collection-form-slot'), list=host.querySelector('.collection-list'), arr=data[key]||[];
  form.innerHTML=`<section class="collection-creator"><span class="mini-label">CRIAR ${key==='abilities'?'HABILIDADE':'PASSIVA'}</span><input class="draft-name" placeholder="${labels.name}"><textarea class="draft-description" rows="3" placeholder="${labels.description}"></textarea>${labels.damage?'<label>Dano<input class="draft-damage" placeholder="Ex.: 2d6 + 3"></label>':''}<button class="button button-primary save-new" type="button">${labels.save}</button></section>`;
  form.querySelector('.save-new').onclick=()=>{const name=form.querySelector('.draft-name').value.trim(),description=form.querySelector('.draft-description').value.trim(),damage=form.querySelector('.draft-damage')?.value.trim()||'';if(!name)return toast('Dê um nome antes de salvar.',true);arr.push({name,description,damage});mark();renderCenterCollection(key,labels);toast('Registro salvo.');};
  if(!arr.length)list.innerHTML='<p class="empty-panel">Nada salvo ainda.</p>';
  arr.forEach((item,i)=>{const el=document.createElement('article');el.className='collection-saved';el.innerHTML=`<div class="saved-summary"><div><span class="mini-label">${key==='abilities'?'HABILIDADE':'PASSIVA'}</span><h3>${esc(item.name||'Sem nome')}</h3></div><div class="saved-actions"><button class="icon-button edit">✎</button><button class="icon-button remove">×</button></div></div><p>${esc(item.description||'Sem descrição.')}</p>${labels.damage&&item.damage?`<button type="button" class="damage-badge" data-damage="${esc(item.damage)}" data-label="${esc(item.name)}" title="Rolar dano na mesa">Rolar dano · ${esc(item.damage)}</button>`:''}<div class="saved-editor hidden"><input class="edit-name" value="${esc(item.name)}"><textarea rows="3">${esc(item.description)}</textarea>${labels.damage?`<label>Dano<input class="edit-damage" value="${esc(item.damage||'')}"></label>`:''}<button class="button button-secondary save-edit">Salvar alterações</button></div>`;const ed=el.querySelector('.saved-editor');el.querySelector('.edit').onclick=()=>ed.classList.toggle('hidden');el.querySelector('.save-edit').onclick=()=>{item.name=el.querySelector('.edit-name').value.trim()||item.name;item.description=ed.querySelector('textarea').value.trim();if(labels.damage)item.damage=el.querySelector('.edit-damage').value.trim();mark();renderCenterCollection(key,labels);toast('Alterações salvas.');};el.querySelector('.remove').onclick=()=>{if(confirm('Excluir este registro?')){arr.splice(i,1);mark();renderCenterCollection(key,labels)}};list.append(el);});
}
function refreshCenterCollections(){if(!data)return;renderCenterCollection('abilities',{name:'Nome da habilidade',description:'Como funciona',damage:'Dano',save:'Salvar habilidade'});renderCenterCollection('passives',{name:'Nome da passiva',description:'Descrição / efeito',save:'Salvar passiva'});}
document.querySelectorAll('.inner-tab').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.inner-tab').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.center-view').forEach(x=>x.classList.add('hidden'));const target=document.querySelector('#center'+btn.dataset.centerTab[0].toUpperCase()+btn.dataset.centerTab.slice(1));target?.classList.remove('hidden');if(btn.dataset.centerTab==='abilities'||btn.dataset.centerTab==='passives')refreshCenterCollections();}));
document.querySelector('#skillSearch')?.addEventListener('input',e=>{const q=e.target.value.trim().toLocaleUpperCase('pt-BR');document.querySelectorAll('#skillsGrid .skill-line').forEach(row=>{row.style.display=!q||row.textContent.toLocaleUpperCase('pt-BR').includes(q)?'grid':'none'});});
document.querySelectorAll('.die-choice').forEach(btn=>btn.addEventListener('click',()=>{selectedManualDie=+btn.dataset.sides;document.querySelectorAll('.die-choice').forEach(x=>x.classList.toggle('active',x===btn));}));
document.querySelector('#manualRoll')?.addEventListener('click',()=>sendSheetRoll(selectedManualDie,+document.querySelector('#manualModifier').value||0,`D${selectedManualDie}`));
const _renderV3=render;render=function(){_renderV3();refreshCenterCollections();};


function applySheetTheme(theme){
  const allowed=['red','blue','white','purple','green'];
  theme=allowed.includes(theme)?theme:'red';
  const ws=document.querySelector('#sheetWorkspace');if(ws)ws.dataset.theme=theme;
  document.querySelectorAll('.theme-swatch').forEach(b=>b.classList.toggle('active',b.dataset.theme===theme));
}
document.querySelectorAll('.theme-swatch').forEach(btn=>btn.addEventListener('click',()=>{if(!data)return;data.theme=btn.dataset.theme;applySheetTheme(data.theme);mark();}));

// ===== Layout livre: posições visuais salvas por ficha =====
let layoutEditActive=false;
const oldEditHandler=document.querySelector('#editLayout').onclick;
document.querySelector('#editLayout').onclick=()=>{oldEditHandler?.();layoutEditActive=!document.querySelector('#layoutConfigurator').classList.contains('hidden');document.body.classList.toggle('sheet-drag-mode',layoutEditActive);prepareDraggables();};
function prepareDraggables(){if(!data)return;data.layoutPositions=data.layoutPositions||{};const groups=[['.identity-stack','identity'],['.resource-card','resource'],['.stat-orb','attribute'],['#skillsGrid .skill-line','skill'],['#combatGrid .skill-line','combat']];groups.forEach(([sel,prefix])=>document.querySelectorAll(sel).forEach((el,i)=>{const key=prefix+'-'+i;el.dataset.dragKey=key;el.classList.add('sheet-draggable');const pos=data.layoutPositions[key];if(pos){el.style.transform=`translate(${pos.x}px,${pos.y}px)`;el.style.zIndex=pos.z||''}if(el.dataset.dragReady)return;el.dataset.dragReady='1';el.addEventListener('pointerdown',e=>{if(!layoutEditActive||e.target.matches('input,button,textarea,label'))return;e.preventDefault();const startX=e.clientX,startY=e.clientY,old=data.layoutPositions[key]||{x:0,y:0};el.setPointerCapture(e.pointerId);el.classList.add('dragging');const move=ev=>{const x=old.x+ev.clientX-startX,y=old.y+ev.clientY-startY;el.style.transform=`translate(${x}px,${y}px)`};const up=ev=>{const x=old.x+ev.clientX-startX,y=old.y+ev.clientY-startY;data.layoutPositions[key]={x,y,z:5};el.classList.remove('dragging');el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);mark()};el.addEventListener('pointermove',move);el.addEventListener('pointerup',up)});}));}
const previousRender=render;render=function(){previousRender();requestAnimationFrame(prepareDraggables)};
// ===== Biblioteca de Magias/Habilidades reutilizável na ficha =====
const _renderCenterCollectionLibrary=renderCenterCollection;
renderCenterCollection=async function(key,labels){_renderCenterCollectionLibrary(key,labels);if(key!=='abilities'||!data)return;const host=document.querySelector('#abilitiesCenter .collection-form-slot');if(!host)return;try{const lib=await api('/api/grimoire');const entries=lib.entries||[];const wrap=document.createElement('div');wrap.className='library-import';wrap.innerHTML=`<span class="mini-label">BIBLIOTECA SALVA</span><div style="display:flex;gap:8px"><select class="library-select"><option value="">Selecione uma magia ou habilidade...</option>${entries.map(x=>`<option value="${x.id}">${x.isStandard?'★ ':''}${esc(x.name)} · ${x.kind==='spell'?'Magia':'Habilidade'}</option>`).join('')}</select><button class="button button-secondary import-entry">Adicionar à ficha</button></div>`;host.append(wrap);wrap.querySelector('.import-entry').onclick=()=>{const id=wrap.querySelector('.library-select').value,e=entries.find(x=>x.id===id);if(!e)return toast('Escolha um registro.',true);data.abilities.push({name:e.name,description:e.description,damage:e.damage,sourceKind:e.kind,libraryId:e.id});mark();_renderCenterCollectionLibrary('abilities',labels);toast(`${e.name} adicionado à ficha.`)};}catch{}}
