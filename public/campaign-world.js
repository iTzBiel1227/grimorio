(function (root) {
  'use strict';
  root.GrimorioCampaignWorld = { create };

  function create({ code, onAccessDenied }) {
    const { api, esc } = root.Grimorio;
    const el = id => document.getElementById(id);
    const endpoint = `/api/campaigns/${encodeURIComponent(code)}/world`;
    const tabs = new Set(['npcs', 'relations', 'map']);
    let context, world, sheets = [], sheetsLoaded = false, activeTab = '', dirty = true, loading = false, again = false;
    let suspended = false, epoch = 0, timer, busy = false, editing = null, dialogDirty = false;
    let selectedMarker = '', zoom = 1, mapAction = null, imageDraft = '', imageRead = 0;
    const canManage = () => Boolean(context?.permissions?.canManage && world?.canManage);
    const byNpc = id => world?.npcs.find(npc => npc.id === id);
    const message = (value = '', error = false) => {
      for (const id of ['worldNpcsFeedback', 'worldRelationsFeedback', 'worldMapFeedback']) {
        el(id).textContent = value; el(id).classList.toggle('error', error);
      }
    };
    const empty = (title, text) => `<div class="hub-empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
    const badge = item => `<span class="world-visibility ${item.isPublic ? 'shared' : 'private'}">${item.isPublic ? 'Compartilhado' : 'Só o Mestre'}</span>`;
    const sheetLink = id => `/ficha.html?campaign=${encodeURIComponent(code)}&sheet=${encodeURIComponent(id)}`;
    const actions = (kind, item) => canManage() ? `<div class="campaign-actions world-card-actions"><button type="button" class="button button-secondary" data-world-edit="${kind}" data-id="${esc(item.id)}">Editar</button><button type="button" class="text-button world-delete" data-world-delete="${kind}" data-id="${esc(item.id)}">Excluir</button></div>` : '';
    const secret = item => canManage() && item.secret ? `<details class="world-secret"><summary>◉ Segredo do Mestre</summary><p class="preserve-lines">${esc(item.secret)}</p></details>` : '';

    el('hubNpcs').innerHTML = `<div class="hub-section-head world-section-head"><div><span class="mini-label">ROSTOS DA AVENTURA</span><h2>NPCs da campanha</h2></div><button id="worldNewNpc" type="button" class="button button-primary" hidden>Novo NPC</button></div><p class="hub-help" id="worldNpcHelp"></p><div class="world-search-row"><label for="worldNpcSearch">Buscar NPC</label><input id="worldNpcSearch" type="search" placeholder="Nome ou descrição" maxlength="200"><span id="worldNpcCount" class="hub-help"></span></div><p id="worldNpcsFeedback" class="form-feedback" role="status"></p><div id="worldNpcCards" class="world-grid"></div>`;
    el('hubRelations').innerHTML = `<div class="hub-section-head world-section-head"><div><span class="mini-label">LAÇOS E RIVALIDADES</span><h2>Relações</h2></div><button id="worldNewRelation" type="button" class="button button-primary" hidden>Nova relação</button></div><p class="hub-help">Encontros, alianças e conflitos entre NPCs e personagens. Cada pessoa vê apenas os vínculos liberados para ela.</p><p id="worldRelationsFeedback" class="form-feedback" role="status"></p><div id="worldRelationCards" class="world-relation-list"></div>`;
    el('hubMap').innerHTML = `<div class="hub-section-head world-section-head"><div><span class="mini-label">LUGARES PARA DESCOBRIR</span><h2 id="worldMapTitle">Mapa da campanha</h2></div><div class="campaign-actions"><button id="worldManageMap" type="button" class="button button-secondary" hidden>Editar mapa</button><button id="worldNewMarker" type="button" class="button button-primary" hidden>Novo local</button></div></div><p class="hub-help">Explore os locais da campanha. Use o zoom e role o mapa para navegar; a lista de locais também abre cada marcador.</p><p id="worldMapFeedback" class="form-feedback" role="status"></p><div class="world-map-layout"><div class="world-map-main"><div class="world-map-toolbar"><div class="campaign-actions"><button id="worldZoomOut" type="button" class="button button-secondary" aria-label="Diminuir zoom">−</button><button id="worldZoomReset" type="button" class="button button-secondary" aria-label="Restaurar zoom">100%</button><button id="worldZoomIn" type="button" class="button button-secondary" aria-label="Aumentar zoom">+</button></div><button id="worldPlaceMarker" type="button" class="text-button" hidden>Marcar no mapa</button><button id="worldCancelPlacement" type="button" class="text-button" hidden>Cancelar marcação</button></div><p id="worldMapInstruction" class="hub-help" aria-live="polite"></p><div id="worldMapViewport" class="world-map-viewport" tabindex="0" role="region" aria-label="Mapa com rolagem"><div id="worldMapPlane" class="world-map-plane"><img id="worldMapImage" alt="Mapa compartilhado da campanha" draggable="false" hidden><div id="worldMapBlank" class="world-map-blank"><span aria-hidden="true">✦</span><p>Um mundo para explorar</p><small>O Mestre pode enviar uma imagem para este mapa.</small></div><div id="worldMapPins"></div></div></div></div><aside class="world-map-side"><div id="worldMarkerDetail" class="panel world-marker-detail"></div><h3 class="world-locations-title">Locais</h3><div id="worldMarkerList" class="world-marker-list"></div></aside></div>`;
    const dialog = document.createElement('dialog'); dialog.id = 'worldEditDialog'; dialog.className = 'panel world-edit-dialog'; dialog.setAttribute('aria-labelledby', 'worldEditTitle');
    dialog.innerHTML = `<button type="button" class="modal-close" id="worldCloseEdit" aria-label="Fechar edição">×</button><span class="mini-label">CONSTRUA SUA CAMPANHA</span><h2 id="worldEditTitle"></h2><form id="worldEditForm"><div id="worldEditFields"></div><p id="worldEditFeedback" class="form-feedback" role="status"></p><div class="campaign-actions"><button id="worldSave" type="submit" class="button button-primary">Salvar</button><button id="worldCancelEdit" type="button" class="button button-secondary">Cancelar</button><button id="worldReloadEdit" type="button" class="text-button" hidden>Recarregar versão salva</button></div></form>`;
    document.body.append(dialog);

    function renderNpcs() {
      const query = el('worldNpcSearch').value.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
      const npcs = world.npcs.filter(npc => `${npc.name} ${npc.description}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').includes(query));
      el('worldNpcCount').textContent = `${npcs.length} de ${world.npcs.length} NPCs`;
      el('worldNpcCards').innerHTML = npcs.map(npc => `<article class="panel world-card world-npc-card" data-npc-id="${esc(npc.id)}"><div class="world-card-top"><span class="mini-label">NPC</span>${badge(npc)}</div><h3>${esc(npc.name)}</h3><p class="preserve-lines">${esc(npc.description || 'A história deste personagem ainda será contada.')}</p>${npc.linkedSheetId ? `<a class="world-sheet-link" href="${sheetLink(npc.linkedSheetId)}">Abrir ficha vinculada ↗</a>` : ''}${secret(npc)}${actions('npc', npc)}</article>`).join('') || empty(query ? 'Nenhum NPC encontrado' : 'Quem habita este mundo?', query ? 'Experimente outro nome ou descrição.' : canManage() ? 'Crie o primeiro NPC. Você decide quando compartilhá-lo com os jogadores.' : 'Os NPCs compartilhados pelo Mestre aparecerão aqui.');
    }
    function renderRelations() {
      el('worldRelationCards').innerHTML = world.relations.map(relation => {
        const from = byNpc(relation.fromNpcId), to = byNpc(relation.toNpcId);
        return `<article class="panel world-relation-card" data-relation-id="${esc(relation.id)}"><div class="world-card-top"><span class="mini-label">${esc(relation.label)}</span>${badge(relation)}</div><h3><span>${esc(from?.name || 'NPC indisponível')}</span><span class="world-relation-arrow" aria-label="relacionado a">→</span>${relation.toSheetId ? `<a href="${sheetLink(relation.toSheetId)}">${esc(relation.toSheetName || 'Personagem')} ↗</a>` : `<span>${esc(to?.name || 'NPC indisponível')}</span>`}</h3><p class="preserve-lines">${esc(relation.description || 'Um vínculo que faz parte desta história.')}</p>${actions('relation', relation)}</article>`;
      }).join('') || empty('Toda história cria laços', canManage() ? 'Ligue um NPC a outro NPC ou a uma ficha da companhia.' : 'Os vínculos compartilhados e autorizados aparecerão aqui.');
    }
    function renderMap() {
      el('worldMapTitle').textContent = world.map.title;
      const image = el('worldMapImage'), source = world.map.imageData || '';
      if (image.dataset.source !== source) {
        image.dataset.source = source;
        image.hidden = !source; el('worldMapBlank').hidden = Boolean(source);
        el('worldMapPlane').style.aspectRatio = '16 / 10';
        if (source) image.src = source; else image.removeAttribute('src');
      }
      if (!world.markers.some(marker => marker.id === selectedMarker)) selectedMarker = '';
      el('worldMapPins').innerHTML = world.markers.map((marker, index) => `<button type="button" class="world-map-pin ${marker.isPublic ? '' : 'private'} ${marker.id === selectedMarker ? 'selected' : ''}" style="left:clamp(18px,${Number(marker.x)}%,calc(100% - 18px));top:clamp(18px,${Number(marker.y)}%,calc(100% - 18px))" data-world-select="${esc(marker.id)}" aria-label="Local ${index + 1}: ${esc(marker.name)}" aria-pressed="${marker.id === selectedMarker}" title="${esc(marker.name)}">${index + 1}</button>`).join('');
      el('worldMarkerList').innerHTML = world.markers.map((marker, index) => `<button type="button" data-world-select="${esc(marker.id)}" class="world-location ${marker.id === selectedMarker ? 'selected' : ''}" aria-pressed="${marker.id === selectedMarker}"><span>${index + 1}</span><strong>${esc(marker.name)}</strong>${!marker.isPublic ? '<small>Só o Mestre</small>' : ''}</button>`).join('') || '<p class="hub-help">Nenhum local compartilhado ainda.</p>';
      renderMarkerDetail();
    }
    function renderMarkerDetail() {
      const marker = world.markers.find(item => item.id === selectedMarker);
      el('worldMarkerDetail').innerHTML = marker ? `${badge(marker)}<h3>${esc(marker.name)}</h3><p class="preserve-lines">${esc(marker.description || 'Um lugar para escrever novas histórias.')}</p>${marker.npcId ? `<p class="world-marker-npc">NPC · ${esc(byNpc(marker.npcId)?.name || 'Indisponível')}</p>` : ''}${secret(marker)}${actions('marker', marker)}${canManage() ? '<button type="button" id="worldMoveMarker" class="text-button">Reposicionar no mapa</button>' : ''}` : '<span class="mini-label">EXPLORE A REGIÃO</span><h3>Escolha um local</h3><p class="hub-help">Selecione um marcador ou um nome na lista para conhecer sua história.</p>';
      if (el('worldMoveMarker')) el('worldMoveMarker').onclick = () => setMapAction({ kind: 'move', marker: { ...marker } });
    }
    function render() {
      for (const id of ['worldNewNpc', 'worldNewRelation', 'worldManageMap', 'worldNewMarker', 'worldPlaceMarker']) el(id).hidden = !canManage();
      el('worldNpcHelp').textContent = canManage() ? 'Organize personagens, mantenha segredos só para você e compartilhe as descobertas com o grupo.' : 'Conheça os personagens que o grupo já encontrou nesta aventura.';
      renderNpcs(); renderRelations(); renderMap();
    }
    async function refresh() {
      if (suspended || !context || !tabs.has(activeTab)) { dirty = true; return; }
      if (loading) { again = true; return; }
      loading = true; const revision = epoch; message(world ? 'Atualizando…' : 'Carregando o mundo da campanha…');
      try {
        const result = await api(endpoint);
        if (revision !== epoch || suspended) return;
        world = result; dirty = false; render(); message();
        if (!canManage() && dialog.open) closeEdit(true);
      } catch (error) {
        if (revision !== epoch || suspended) return;
        message(error.message || 'Não foi possível carregar. Use Atualizar para tentar novamente.', true);
        if ([401, 403, 404].includes(error.status) || error.code === '42501') { clear(); onAccessDenied?.(error); }
      } finally {
        loading = false;
        if (again && !suspended) { again = false; invalidate(); }
      }
    }
    function invalidate({ sheets: invalidateSheets = false } = {}) {
      dirty = true; if (invalidateSheets) sheetsLoaded = false;
      clearTimeout(timer); if (!suspended && tabs.has(activeTab)) timer = setTimeout(refresh, 180);
    }
    async function loadSheets() {
      if (sheetsLoaded) return;
      const result = await api(`/api/campaigns/${encodeURIComponent(code)}/sheets`);
      sheets = result.sheets || []; sheetsLoaded = true;
    }
    const option = (value, text, selected) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(text)}</option>`;
    const npcOptions = (selected, exclude = '') => world.npcs.filter(npc => npc.id !== exclude).map(npc => option(npc.id, `${npc.name}${npc.isPublic ? '' : ' · só o Mestre'}`, selected)).join('');
    const sheetOptions = selected => sheets.map(sheet => option(sheet.id, `${sheet.name || 'Personagem'}${sheet.ownerName ? ' · ' + sheet.ownerName : ''}`, selected)).join('');
    const textField = (id, label, value, max, area = false) => `<label for="${id}">${label}</label>${area ? `<textarea id="${id}" rows="4" maxlength="${max}">${esc(value || '')}</textarea>` : `<input id="${id}" value="${esc(value || '')}" maxlength="${max}" required>`}`;
    const visibilityField = item => `<label class="world-checkbox"><input id="worldIsPublic" type="checkbox" ${item.isPublic ? 'checked' : ''}><span>Compartilhar com os jogadores</span></label><p class="hub-help world-visibility-help">Desmarcado: só o Mestre vê. Vínculos e locais também dependem da visibilidade dos NPCs e das permissões das fichas.</p>`;
    const secretField = item => `<div class="world-secret-editor"><span class="private-label">◉ VISÍVEL APENAS PARA O MESTRE</span>${textField('worldSecret', 'Segredo e preparação', item.secret, 10000, true)}</div>`;
    function showEdit(kind, item = {}) {
      if (!canManage() || busy) return;
      editing = { kind, item: { ...item } }; dialogDirty = false; imageDraft = ''; imageRead++;
      el('worldEditFeedback').textContent = ''; el('worldEditFeedback').classList.remove('error'); el('worldReloadEdit').hidden = true;
      el('worldEditTitle').textContent = kind === 'map' ? 'Editar mapa' : `${item.id ? 'Editar' : 'Criar'} ${kind === 'npc' ? 'NPC' : kind === 'relation' ? 'relação' : 'local'}`;
      let fields = '';
      if (kind === 'npc') fields = textField('worldName', 'Nome', item.name, 100) + textField('worldDescription', 'Descrição compartilhável', item.description, 4000, true) + `<label for="worldLinkedSheet">Ficha vinculada (opcional)</label><select id="worldLinkedSheet">${option('', 'Sem ficha vinculada', item.linkedSheetId || '')}${sheetOptions(item.linkedSheetId)}</select><p class="hub-help">Vincular uma ficha mantém suas permissões atuais.</p>` + visibilityField(item) + secretField(item);
      if (kind === 'relation') fields = `<label for="worldFromNpc">NPC de origem</label><select id="worldFromNpc" required><option value="">Escolha um NPC</option>${npcOptions(item.fromNpcId)}</select><label for="worldTarget">Relacionado a</label><select id="worldTarget" required><option value="">Escolha outro NPC ou uma ficha</option><optgroup label="NPCs">${world.npcs.map(npc => option('npc:' + npc.id, npc.name, item.toNpcId ? 'npc:' + item.toNpcId : '')).join('')}</optgroup><optgroup label="Personagens">${sheets.map(sheet => option('sheet:' + sheet.id, sheet.name || 'Personagem', item.toSheetId ? 'sheet:' + item.toSheetId : '')).join('')}</optgroup></select>` + textField('worldRelationLabel', 'Relação', item.label, 120) + textField('worldDescription', 'História deste vínculo', item.description, 2000, true) + visibilityField(item);
      if (kind === 'marker') fields = textField('worldName', 'Nome do local', item.name, 100) + textField('worldDescription', 'Descrição compartilhável', item.description, 2000, true) + `<div class="world-coordinate-fields"><div><label for="worldMarkerX">Horizontal (%)</label><input id="worldMarkerX" type="number" min="0" max="100" step="0.01" value="${Number(item.x ?? 50)}" required></div><div><label for="worldMarkerY">Vertical (%)</label><input id="worldMarkerY" type="number" min="0" max="100" step="0.01" value="${Number(item.y ?? 50)}" required></div></div><label for="worldMarkerNpc">NPC neste local (opcional)</label><select id="worldMarkerNpc">${option('', 'Sem NPC associado', item.npcId || '')}${npcOptions(item.npcId)}</select>` + visibilityField(item) + secretField(item);
      if (kind === 'map') {
        imageDraft = item.imageData || '';
        fields = textField('worldMapName', 'Título do mapa', item.title || 'Mapa da campanha', 120) + `<p class="hub-help">A imagem é compartilhada com todos os membros. Guarde segredos nas notas privadas dos locais.</p><label for="worldMapFile">Imagem do mapa</label><input id="worldMapFile" type="file" accept="image/png,image/jpeg,image/webp"><p class="hub-help">PNG, JPG ou WebP · até 3 MB. Trocar a imagem conserva as posições dos locais.</p><img id="worldMapPreview" class="world-map-preview" alt="Prévia do mapa" ${imageDraft ? `src="${esc(imageDraft)}"` : 'hidden'}><button id="worldRemoveImage" type="button" class="text-button" ${imageDraft ? '' : 'hidden'}>Remover imagem</button>`;
      }
      el('worldEditFields').innerHTML = fields;
      if (kind === 'map') {
        el('worldMapFile').onchange = readMapImage;
        el('worldRemoveImage').onclick = () => { imageRead++; imageDraft = ''; dialogDirty = true; el('worldMapFile').value = ''; el('worldMapPreview').hidden = true; el('worldMapPreview').removeAttribute('src'); el('worldRemoveImage').hidden = true; el('worldSave').disabled = false; };
      }
      if (!dialog.open) dialog.showModal();
      el('worldEditFields').querySelector('input,select,textarea')?.focus();
    }
    async function openEdit(kind, item = {}) {
      if (!canManage() || busy) return;
      try { if (kind === 'npc' || kind === 'relation') await loadSheets(); showEdit(kind, item); }
      catch (error) { message(error.message || 'Não foi possível carregar as fichas para edição.', true); }
    }
    function editError(error) {
      const conflict = error.status === 409 || error.code === '40001';
      el('worldEditFeedback').textContent = conflict ? 'Este registro mudou em outra janela. Seu rascunho foi preservado. Recarregue a versão salva para revisar antes de editar novamente.' : error.message || 'Não foi possível salvar. Tente novamente.';
      el('worldEditFeedback').classList.add('error'); el('worldReloadEdit').hidden = !conflict;
    }
    async function readMapImage() {
      const file = el('worldMapFile').files?.[0], revision = ++imageRead;
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) { editError(Error('Escolha uma imagem PNG, JPG ou WebP de até 3 MB.')); el('worldMapFile').value = ''; return; }
      el('worldSave').disabled = true;
      try {
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Não foi possível ler a imagem.')); reader.readAsDataURL(file); });
        const image = new Image(); image.src = data; await image.decode();
        if (revision !== imageRead || !dialog.open) return;
        imageDraft = data; el('worldMapPreview').src = data; el('worldMapPreview').hidden = false; el('worldRemoveImage').hidden = false; el('worldEditFeedback').textContent = ''; dialogDirty = true;
      } catch { if (revision === imageRead) editError(Error('A imagem não pôde ser aberta. Escolha outro arquivo.')); }
      finally { if (revision === imageRead) el('worldSave').disabled = false; }
    }
    function closeEdit(force = false) {
      if (!force && (busy || (dialogDirty && !root.confirm('Descartar as alterações não salvas?')))) return;
      imageRead++; dialog.close(); editing = null; dialogDirty = false; el('worldEditFields').replaceChildren(); el('worldSave').disabled = false;
    }
    function mutation(kind, action, item, data) {
      const body = { kind, action, ...(item?.id ? { id: item.id } : {}), ...(item?.version !== undefined ? { expectedVersion: item.version } : {}), ...(data ? { data } : {}) };
      return api(endpoint, { method: 'POST', body: JSON.stringify(body) });
    }
    function formData() {
      const kind = editing.kind;
      if (kind === 'map') return { title: el('worldMapName').value.trim(), imageData: imageDraft };
      const data = { description: el('worldDescription').value.trim(), isPublic: el('worldIsPublic').checked };
      if (kind === 'relation') {
        const target = el('worldTarget').value;
        return { ...data, label: el('worldRelationLabel').value.trim(), fromNpcId: el('worldFromNpc').value, toNpcId: target.startsWith('npc:') ? target.slice(4) : null, toSheetId: target.startsWith('sheet:') ? target.slice(6) : null };
      }
      return { ...data, name: el('worldName').value.trim(), secret: el('worldSecret').value, ...(kind === 'npc' ? { linkedSheetId: el('worldLinkedSheet').value || null } : { x: Number(el('worldMarkerX').value), y: Number(el('worldMarkerY').value), npcId: el('worldMarkerNpc').value || null }) };
    }
    el('worldEditForm').onsubmit = async event => {
      event.preventDefault(); if (busy || !canManage() || !editing || el('worldSave').disabled) return;
      const data = formData();
      if (!(data.name ?? data.label ?? data.title).trim()) { editError(Error('Informe um nome ou título válido.')); return; }
      if (editing.kind === 'relation' && data.fromNpcId === data.toNpcId) { editError(Error('Escolha dois personagens diferentes para a relação.')); return; }
      busy = true; el('worldSave').disabled = true; el('worldEditFeedback').textContent = 'Salvando…';
      try {
        const result = await mutation(editing.kind, 'save', editing.item, data);
        if (editing.kind === 'marker') selectedMarker = result.id;
        closeEdit(true); await refresh(); message('Alterações salvas.');
      } catch (error) { editError(error); }
      finally { busy = false; el('worldSave').disabled = false; }
    };
    el('worldEditForm').addEventListener('input', () => { dialogDirty = true; });
    el('worldCloseEdit').onclick = () => closeEdit(); el('worldCancelEdit').onclick = () => closeEdit();
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeEdit(); });
    el('worldReloadEdit').onclick = async () => {
      if (!editing || busy || !root.confirm('Recarregar vai descartar este rascunho. Continuar?')) return;
      const { kind, item } = editing; await refresh();
      const latest = kind === 'map' ? world?.map : world?.[kind === 'npc' ? 'npcs' : kind === 'marker' ? 'markers' : 'relations'].find(row => row.id === item.id);
      if (!latest) { closeEdit(true); message('Este registro foi excluído em outra janela.', true); return; }
      showEdit(kind, latest);
    };
    async function remove(kind, item) {
      if (busy || !canManage()) return;
      const question = kind === 'npc' ? `Excluir ${item.name}? As relações e os locais associados a este NPC também serão excluídos. A ficha vinculada será preservada.` : `Excluir ${kind === 'marker' ? 'o local ' + item.name : 'esta relação'}?`;
      if (!root.confirm(question)) return;
      busy = true;
      try { await mutation(kind, 'delete', item); await refresh(); message('Registro excluído.'); }
      catch (error) { message(error.status === 409 || error.code === '40001' ? 'Este registro mudou. Atualize e confira a versão mais recente antes de excluir.' : error.message, true); }
      finally { busy = false; }
    }
    for (const panel of ['hubNpcs', 'hubRelations', 'hubMap']) el(panel).addEventListener('click', event => {
      const select = event.target.closest('[data-world-select]');
      if (select) { selectedMarker = select.dataset.worldSelect; renderMap(); return; }
      const button = event.target.closest('[data-world-edit],[data-world-delete]'); if (!button || !world) return;
      const kind = button.dataset.worldEdit || button.dataset.worldDelete;
      const item = world[kind === 'npc' ? 'npcs' : kind === 'marker' ? 'markers' : 'relations'].find(row => row.id === button.dataset.id);
      if (item) button.dataset.worldEdit ? openEdit(kind, item) : remove(kind, item);
    });
    el('worldNewNpc').onclick = () => openEdit('npc');
    el('worldNewRelation').onclick = () => openEdit('relation');
    el('worldNewMarker').onclick = () => openEdit('marker');
    el('worldManageMap').onclick = () => openEdit('map', world.map);
    el('worldNpcSearch').oninput = () => { if (world) renderNpcs(); };
    function applyZoom(value) {
      zoom = Math.max(1, Math.min(3, value)); el('worldMapPlane').style.width = `${zoom * 100}%`; el('worldZoomReset').textContent = `${Math.round(zoom * 100)}%`;
      el('worldZoomOut').disabled = zoom <= 1; el('worldZoomIn').disabled = zoom >= 3;
    }
    el('worldZoomIn').onclick = () => applyZoom(zoom + .25); el('worldZoomOut').onclick = () => applyZoom(zoom - .25);
    el('worldZoomReset').onclick = () => { applyZoom(1); el('worldMapViewport').scrollTo(0, 0); }; applyZoom(1);
    el('worldMapImage').onload = () => { const image = el('worldMapImage'); if (image.naturalWidth && image.naturalHeight) el('worldMapPlane').style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`; };
    el('worldMapImage').onerror = () => { el('worldMapImage').hidden = true; el('worldMapBlank').hidden = false; message('Não foi possível abrir a imagem do mapa. Os locais continuam disponíveis.', true); };
    function setMapAction(action) {
      mapAction = action; el('worldMapPlane').classList.toggle('placing', Boolean(action)); el('worldCancelPlacement').hidden = !action;
      el('worldMapInstruction').textContent = action ? action.kind === 'move' ? `Clique no novo ponto de ${action.marker.name}. Você também pode editar as coordenadas no formulário do local.` : 'Clique no mapa para posicionar um novo local. Ou use Novo local e informe as coordenadas.' : '';
      if (action) el('worldMapViewport').focus({ preventScroll: true });
    }
    el('worldPlaceMarker').onclick = () => setMapAction({ kind: 'create' }); el('worldCancelPlacement').onclick = () => setMapAction(null);
    el('worldMapViewport').addEventListener('keydown', event => { if (event.key === 'Escape') { setMapAction(null); event.preventDefault(); } });
    el('worldMapPlane').addEventListener('click', async event => {
      if (!mapAction || !canManage() || busy || event.target.closest('[data-world-select]')) return;
      const rect = el('worldMapPlane').getBoundingClientRect();
      const position = { x: Math.round(Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)) * 100) / 100, y: Math.round(Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) * 100) / 100 };
      const action = mapAction; setMapAction(null);
      if (action.kind === 'create') { openEdit('marker', position); return; }
      busy = true;
      try {
        const marker = action.marker;
        await mutation('marker', 'save', marker, { name: marker.name, description: marker.description, npcId: marker.npcId, isPublic: marker.isPublic, secret: marker.secret || '', ...position });
        await refresh(); message('Local reposicionado.');
      } catch (error) { message(error.status === 409 || error.code === '40001' ? 'Este local mudou. Atualize antes de reposicioná-lo.' : error.message, true); }
      finally { busy = false; }
    });
    function clear() {
      epoch++; world = null; context = null; dirty = true; sheets = []; sheetsLoaded = false; selectedMarker = ''; clearTimeout(timer); closeEdit(true); setMapAction(null);
      for (const id of ['worldNpcCards', 'worldRelationCards', 'worldMarkerDetail', 'worldMarkerList', 'worldMapPins']) el(id).replaceChildren();
      el('worldMapImage').removeAttribute('src'); el('worldMapImage').dataset.source = ''; el('worldMapImage').hidden = true; el('worldMapBlank').hidden = false;
    }
    return {
      setContext(info) { context = info; if (world && !info.permissions?.canManage && world.canManage) { clear(); context = info; invalidate({ sheets: true }); } },
      selectTab(tab) { activeTab = tab; setMapAction(null); if (tabs.has(tab) && dirty) refresh(); },
      refresh, invalidate, clear,
      suspend() { suspended = true; epoch++; clearTimeout(timer); },
      resume() { suspended = false; invalidate({ sheets: true }); }
    };
  }
})(window);
