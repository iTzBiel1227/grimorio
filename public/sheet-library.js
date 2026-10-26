(function (root) {
  'use strict';
  root.createSheetLibrary = ({ api, esc, open, toast, container }) => {
    let folderId = null, folders = [], sheets = [];
    const run = task => Promise.resolve().then(task).catch(error => toast(error.message, true));
    async function load() {
      const [content, structure] = await Promise.all([api('/api/sheets'), api('/api/sheet-folders')]);
      sheets = content.sheets; folders = structure.folders;
      if (folderId && !folders.some(row => row.id === folderId)) folderId = null;
      render();
    }
    function render() {
      const current = folders.find(row => row.id === folderId);
      container.innerHTML = `<div class="folder-toolbar"><nav class="folder-breadcrumb" aria-label="Pasta atual"><button class="text-button" data-root>Biblioteca</button><span>${current ? ' / ' + esc(GrimorioSheetTools.folderPath(current, folders)) : ' / Todas as pastas'}</span></nav><div><button class="button button-secondary compact" data-new-folder>+ Nova pasta</button>${current ? '<button class="icon-button" data-rename title="Renomear pasta">✎</button><button class="icon-button" data-remove title="Excluir pasta">×</button>' : ''}</div></div><div class="folder-grid"></div><div class="sheet-cards"></div>`;
      container.querySelector('[data-root]').onclick = () => { folderId = null; render(); };
      container.querySelector('[data-new-folder]').onclick = () => run(async () => {
        const name = prompt(current ? 'Nome da subpasta:' : 'Nome da pasta:')?.trim(); if (!name) return;
        await api('/api/sheet-folders', { method: 'POST', body: JSON.stringify({ name, parentId: folderId }) }); await load();
      });
      if (current) {
        container.querySelector('[data-rename]').onclick = () => run(async () => {
          const name = prompt('Nome da pasta:', current.name)?.trim(); if (!name) return;
          await api('/api/sheet-folders/' + current.id, { method: 'PUT', body: JSON.stringify({ name, parentId: current.parentId }) }); await load();
        });
        container.querySelector('[data-remove]').onclick = () => run(async () => {
          if (!confirm('Excluir esta pasta? As fichas e subpastas voltarão à biblioteca e serão preservadas.')) return;
          await api('/api/sheet-folders/' + current.id, { method: 'DELETE' }); folderId = null; await load();
        });
      }
      const grid = container.querySelector('.folder-grid');
      if (current) {
        const back = document.createElement('button'); back.className = 'folder-card'; back.textContent = '↰ Voltar uma pasta';
        back.onclick = () => { folderId = current.parentId || null; render(); }; grid.append(back);
      }
      for (const folder of folders.filter(row => (row.parentId || null) === folderId)) {
        const button = document.createElement('button'); button.className = 'folder-card';
        button.innerHTML = `<span aria-hidden="true">▱</span><strong>${esc(folder.name)}</strong><small>${sheets.filter(row => row.folderId === folder.id).length} fichas</small>`;
        button.onclick = () => { folderId = folder.id; render(); }; grid.append(button);
      }
      const cards = container.querySelector('.sheet-cards');
      const visible = sheets.filter(sheet => (sheet.folderId || null) === folderId);
      if (!visible.length) cards.innerHTML = '<div class="empty-sheet panel"><strong>Esta pasta está pronta para seus personagens.</strong><p>Crie uma ficha aqui ou mova uma da biblioteca.</p></div>';
      for (const sheet of visible) {
        const card = document.createElement('article'); card.className = 'sheet-card panel';
        card.innerHTML = `<div class="sheet-card-rune">✦</div><span class="mini-label">PERSONAGEM</span><h3>${esc(sheet.name || 'Personagem sem nome')}</h3><p>Atualizada em ${new Date(sheet.updatedAt).toLocaleDateString('pt-BR')}</p><div><button class="button button-secondary" data-open>Abrir ficha</button><button class="icon-button" data-delete title="Excluir ficha">×</button></div><label class="sheet-move-label">Mover para<select aria-label="Pasta de ${esc(sheet.name)}"><option value="">Biblioteca (sem pasta)</option>${folders.map(folder => `<option value="${esc(folder.id)}" ${folder.id === folderId ? 'selected' : ''}>${esc(GrimorioSheetTools.folderPath(folder, folders))}</option>`).join('')}</select></label>`;
        card.querySelector('[data-open]').onclick = () => run(() => open(sheet.id));
        card.querySelector('[data-delete]').onclick = () => run(async () => {
          if (!confirm('Excluir esta ficha?')) return;
          await api('/api/sheets/' + sheet.id, { method: 'DELETE' }); await load();
        });
        card.querySelector('select').onchange = event => run(async () => {
          await api('/api/sheets/' + sheet.id + '/folder', { method: 'PUT', body: JSON.stringify({ folderId: event.target.value || null }) }); await load();
        }); cards.append(card);
      }
    }
    return { load, currentFolder: () => folderId };
  };
})(window);
