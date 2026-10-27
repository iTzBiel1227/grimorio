(() => {
  'use strict';
  const { api, esc } = Grimorio;
  const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const safeImage = value => /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\r\n]+$/i.test(String(value || '')) ? value : '';
  const filtered = (entries, kind, query) => entries.filter(entry => (kind === 'all' || entry.kind === kind) && fold([entry.name, entry.description, entry.damage].join(' ')).includes(fold(query).trim()));
  function readImage(file) {
    if (!file) return Promise.resolve('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) return Promise.reject(Error('Use uma imagem PNG, JPG ou WEBP de até 3 MB.'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => safeImage(reader.result) ? resolve(reader.result) : reject(Error('Não foi possível ler esta imagem.'));
      reader.onerror = () => reject(Error('Não foi possível ler esta imagem.'));
      reader.readAsDataURL(file);
    });
  }
  async function mount(host, { admin = false } = {}) {
    const prefix = admin ? 'adminMagic' : 'magic';
    let scope = admin ? 'admin' : 'public', kind = 'all', entries = [], editing = null, pendingImage = '', readingImage = false, saving = false, requestId = 0, imageRevision = 0;
    const endpoint = () => admin ? '/api/admin/grimoire' : '/api/grimoire';
    host.classList.add('magic-library');
    host.innerHTML = `${admin ? '<p class="magic-public-notice"><span aria-hidden="true">✦</span> Todas as criações desta área entram na biblioteca pública, disponíveis para todos.</p>' : `<div class="magic-scope-tabs" role="tablist" aria-label="Origem das magias"><button id="${prefix}PublicTab" role="tab" aria-selected="true" aria-controls="${prefix}Panel" data-scope="public">Biblioteca do Grimório <span aria-hidden="true">↗</span></button><button id="${prefix}MineTab" role="tab" aria-selected="false" tabindex="-1" aria-controls="${prefix}Panel" data-scope="mine">Minhas magias <span aria-hidden="true">◇</span></button></div>`}
      <div id="${prefix}Panel" ${admin ? '' : `role="tabpanel" aria-labelledby="${prefix}PublicTab"`}>
        <div class="magic-library-heading"><div><span class="mini-label" data-eyebrow>${admin ? 'PUBLICAÇÕES DA EQUIPE' : 'FEITO PARA TODA A COMUNIDADE'}</span><h2 data-heading>${admin ? 'Catálogo de poderes' : 'Biblioteca do Grimório'}</h2><p data-intro>${admin ? 'Crie, revise e ilustre as magias e habilidades oficiais do projeto.' : 'Magias e habilidades publicadas pelos administradores. Você pode usá-las nas suas fichas.'}</p></div><button class="button button-primary" data-new>${admin ? '+ Criar publicação' : '+ Criar minha magia'}</button></div>
        <div class="magic-toolbar"><div class="magic-filters" role="group" aria-label="Tipo de poder"><button type="button" data-kind="all" aria-pressed="true">Todos</button><button type="button" data-kind="spell" aria-pressed="false">Magias</button><button type="button" data-kind="ability" aria-pressed="false">Habilidades</button></div><label class="magic-search"><span aria-hidden="true">⌕</span><input type="search" data-search placeholder="Buscar nome, descrição ou dano…" aria-label="Buscar magias e habilidades" autocomplete="off"></label></div>
        <div class="magic-list-meta"><span data-count role="status">Carregando biblioteca…</span><button type="button" data-refresh>Atualizar</button></div><p class="magic-feedback" data-feedback role="status"></p><div class="magic-grid" data-entries></div>
      </div>
      <dialog class="magic-editor panel" aria-labelledby="${prefix}EditorTitle"><button type="button" class="modal-close" data-close aria-label="Fechar editor">×</button><span class="mini-label">${admin ? 'PUBLICAÇÃO DA EQUIPE · VISÍVEL PARA TODOS' : 'SEU GRIMÓRIO PESSOAL'}</span><h2 id="${prefix}EditorTitle">Criar magia</h2><form class="magic-entry-form"><div class="magic-form-row"><label>Tipo<select name="kind"><option value="spell">Magia</option><option value="ability">Habilidade</option></select></label><label>Nome<input name="name" maxlength="80" required placeholder="Dê um nome ao seu poder"></label></div><label>Descrição<textarea name="description" rows="5" maxlength="5000" placeholder="Como funciona, alcance, duração e efeitos…"></textarea></label><label>Dano / efeito<input name="damage" maxlength="120" placeholder="Ex.: 2d8 + 4, cura 1d6 ou efeito narrativo"></label><div class="magic-image-field"><div class="magic-image-preview"><span data-image-placeholder aria-hidden="true">✦</span><img data-image-preview alt="Prévia da ilustração" hidden></div><div><label>Imagem de representação<input type="file" name="image" accept="image/png,image/jpeg,image/webp"></label><small>PNG, JPG ou WEBP · até 3 MB</small><button type="button" data-remove-image hidden>Remover imagem</button></div></div><p class="magic-feedback" data-form-feedback role="status"></p><div class="magic-form-actions"><button class="button button-secondary" type="button" data-cancel>Cancelar</button><button class="button button-primary" type="submit">${admin ? 'Publicar para todos' : 'Salvar no meu grimório'}</button></div></form></dialog>
      <dialog class="magic-detail panel" aria-labelledby="${prefix}DetailTitle"><button type="button" class="modal-close" data-close-detail aria-label="Fechar detalhes">×</button><div data-detail></div></dialog>`;
    const find = selector => host.querySelector(selector), all = selector => [...host.querySelectorAll(selector)];
    const grid = find('[data-entries]'), editor = find('.magic-editor'), form = find('form'), message = find('[data-feedback]'), formMessage = find('[data-form-feedback]'), detail = find('.magic-detail');
    const field = name => form.elements.namedItem(name);
    function feedback(text, error = false) { message.textContent = text; message.classList.toggle('error', error); }
    function previewImage() { find('[data-image-preview]').src = pendingImage || ''; find('[data-image-preview]').hidden = !pendingImage; find('[data-image-placeholder]').hidden = Boolean(pendingImage); find('[data-remove-image]').hidden = !pendingImage; }
    function render() {
      const list = filtered(entries, kind, find('[data-search]').value);
      find('[data-count]').textContent = `${list.length} ${list.length === 1 ? 'poder encontrado' : 'poderes encontrados'}`;
      grid.innerHTML = list.map(entry => `<article class="magic-entry-card"><button type="button" class="magic-card-art" data-detail-entry="${esc(entry.id)}" aria-label="Ver ${esc(entry.name)}">${safeImage(entry.imageData) ? `<img src="${esc(entry.imageData)}" alt="" loading="lazy">` : `<span class="magic-art-rune" aria-hidden="true">${entry.kind === 'ability' ? '⚔' : '✦'}</span>`}<span class="magic-kind-badge">${entry.kind === 'ability' ? 'Habilidade' : 'Magia'}</span></button><div class="magic-card-body"><span class="magic-source">${entry.isStandard ? 'BIBLIOTECA PÚBLICA' : 'CRIAÇÃO PESSOAL'}</span><h3><button type="button" data-detail-entry="${esc(entry.id)}">${esc(entry.name)}</button></h3><p>${esc(entry.description || 'Uma página à espera da sua história.')}</p><div class="magic-card-damage"><span aria-hidden="true">◇</span><strong>${esc(entry.damage || 'Efeito narrativo')}</strong></div><div class="magic-card-actions"><button type="button" data-detail-entry="${esc(entry.id)}">Ver detalhes <span aria-hidden="true">↗</span></button>${admin || scope === 'mine' ? `<button type="button" data-edit="${esc(entry.id)}" aria-label="Editar ${esc(entry.name)}">Editar</button><button type="button" data-delete="${esc(entry.id)}" aria-label="Excluir ${esc(entry.name)}">Excluir</button>` : ''}</div></div></article>`).join('') || `<div class="magic-empty"><span aria-hidden="true">✦</span><h3>${entries.length ? 'Nenhum poder encontrado' : scope === 'public' ? 'Novos conhecimentos estão chegando' : 'Seu próximo poder começa aqui'}</h3><p>${entries.length ? 'Experimente outro termo ou tipo de poder.' : scope === 'public' ? 'Os administradores ainda não publicaram magias ou habilidades.' : 'Crie uma magia ou habilidade para usar nas suas aventuras.'}</p></div>`;
    }
    async function load() {
      const current = ++requestId;
      grid.setAttribute('aria-busy', 'true');
      find('[data-count]').textContent = 'Carregando biblioteca…';
      try {
        const response = await api(admin ? endpoint() : endpoint() + '?scope=' + scope);
        if (current !== requestId) return;
        entries = response.entries || []; render();
      } catch (error) {
        if (current !== requestId) return;
        entries = []; render(); feedback(error.message, true);
      } finally { if (current === requestId) grid.setAttribute('aria-busy', 'false'); }
    }
    async function setScope(next) {
      if (next === 'mine' && !await Grimorio.currentUser()) { Grimorio.loginRedirect(); return false; }
      scope = next; feedback('');
      all('[data-scope]').forEach(button => { const active = button.dataset.scope === scope; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
      find('[role="tabpanel"]').setAttribute('aria-labelledby', prefix + (scope === 'public' ? 'PublicTab' : 'MineTab'));
      find('[data-heading]').textContent = scope === 'public' ? 'Biblioteca do Grimório' : 'Minhas magias & habilidades';
      find('[data-eyebrow]').textContent = scope === 'public' ? 'FEITO PARA TODA A COMUNIDADE' : 'DA SUA IMAGINAÇÃO PARA A MESA';
      find('[data-intro]').textContent = scope === 'public' ? 'Magias e habilidades publicadas pelos administradores. Você pode usá-las nas suas fichas.' : 'Suas criações ficam na sua biblioteca pessoal e podem ser adicionadas às suas fichas.';
      await load(); return true;
    }
    function openEditor(entry) {
      editing = entry || null; imageRevision++; readingImage = false; form.reset(); pendingImage = safeImage(entry?.imageData);
      field('kind').value = entry?.kind || (kind === 'ability' ? 'ability' : 'spell'); field('name').value = entry?.name || ''; field('description').value = entry?.description || ''; field('damage').value = entry?.damage || '';
      find('h2[id$="EditorTitle"]').textContent = entry ? 'Editar poder' : admin ? 'Criar publicação' : 'Criar meu poder';
      formMessage.textContent = ''; formMessage.classList.remove('error'); previewImage(); editor.showModal();
    }
    const closeEditor = () => { if (!saving) { imageRevision++; readingImage = false; editor.close(); } };
    find('[data-close]').onclick = closeEditor; find('[data-cancel]').onclick = closeEditor;
    editor.addEventListener('cancel', event => { if (saving) event.preventDefault(); else { imageRevision++; readingImage = false; } });
    find('[data-close-detail]').onclick = () => detail.close();
    all('[data-scope]').forEach(button => {
      button.onclick = () => setScope(button.dataset.scope);
      button.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const target = all('[data-scope]')[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : button.dataset.scope === 'public' ? 1 : 0]; target.focus(); setScope(target.dataset.scope); };
    });
    all('[data-kind]').forEach(button => button.onclick = () => { kind = button.dataset.kind; all('[data-kind]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); render(); });
    find('[data-search]').oninput = render;
    find('[data-refresh]').onclick = () => { feedback(''); return load(); };
    find('[data-new]').onclick = async () => { if (!admin && scope !== 'mine' && !await setScope('mine')) return; openEditor(); };
    field('image').onchange = async () => {
      const revision = ++imageRevision, file = field('image').files[0]; if (!file) return;
      readingImage = true; formMessage.textContent = 'Carregando imagem…';
      try { const image = await readImage(file); if (revision !== imageRevision) return; pendingImage = image; previewImage(); formMessage.textContent = ''; formMessage.classList.remove('error'); }
      catch (error) { if (revision !== imageRevision) return; field('image').value = ''; formMessage.textContent = error.message; formMessage.classList.add('error'); }
      finally { if (revision === imageRevision) readingImage = false; }
    };
    find('[data-remove-image]').onclick = () => { imageRevision++; readingImage = false; pendingImage = ''; field('image').value = ''; previewImage(); formMessage.textContent = ''; };
    form.onsubmit = async event => {
      event.preventDefault(); if (saving) return;
      if (readingImage) { formMessage.textContent = 'Aguarde a leitura da imagem.'; return; }
      const name = field('name').value.trim(); if (!name) { field('name').focus(); formMessage.textContent = 'Dê um nome ao poder.'; return; }
      const controls = [...form.querySelectorAll('input,textarea,select,button')]; saving = true; controls.forEach(control => control.disabled = true); formMessage.textContent = 'Salvando…'; formMessage.classList.remove('error');
      try {
        await api(endpoint() + (editing ? '/' + encodeURIComponent(editing.id) : ''), { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ kind: field('kind').value, name, description: field('description').value.trim(), damage: field('damage').value.trim(), imageData: pendingImage }) });
        editor.close(); feedback(admin ? 'Publicação salva. Ela já está disponível na biblioteca de todos.' : 'Poder salvo no seu grimório.'); await load();
      } catch (error) { formMessage.textContent = error.message; formMessage.classList.add('error'); }
      finally { saving = false; controls.forEach(control => control.disabled = false); }
    };
    grid.onclick = async event => {
      const button = event.target.closest('button'); if (!button || !grid.contains(button)) return;
      const entry = entries.find(item => item.id === (button.dataset.edit || button.dataset.delete || button.dataset.detailEntry)); if (!entry) return;
      if (button.dataset.edit) { openEditor(entry); return; }
      if (button.dataset.detailEntry) {
        find('[data-detail]').innerHTML = `${safeImage(entry.imageData) ? `<img class="magic-detail-image" src="${esc(entry.imageData)}" alt="Ilustração de ${esc(entry.name)}">` : ''}<span class="mini-label">${entry.kind === 'ability' ? 'HABILIDADE' : 'MAGIA'} · ${entry.isStandard ? 'BIBLIOTECA PÚBLICA' : 'CRIAÇÃO PESSOAL'}</span><h2 id="${prefix}DetailTitle">${esc(entry.name)}</h2><p class="magic-detail-description">${esc(entry.description || 'Sem descrição.')}</p><div class="magic-card-damage"><span>DANO / EFEITO</span><strong>${esc(entry.damage || 'Efeito narrativo')}</strong></div>${scope === 'public' ? '<p class="magic-detail-hint">Na sua ficha, abra Habilidades e selecione este poder na biblioteca para adicioná-lo.</p>' : ''}`;
        detail.showModal(); return;
      }
      if (!confirm(`Excluir “${entry.name}” ${admin ? 'da biblioteca pública' : 'do seu grimório'}? As cópias já adicionadas às fichas serão mantidas.`)) return;
      button.disabled = true;
      try { await api(endpoint() + '/' + encodeURIComponent(entry.id), { method: 'DELETE' }); feedback('Poder excluído.'); await load(); }
      catch (error) { feedback(error.message, true); button.disabled = false; }
    };
    await load();
    return { reload: load };
  }
  window.GrimorioMagic = { mount, filtered, safeImage, readImage };
  const host = document.getElementById('magicLibraryRoot');
  if (host) mount(host).catch(error => { host.textContent = error.message; });
})();
