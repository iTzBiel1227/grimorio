(() => {
  'use strict';
  const { api, esc } = Grimorio;
  const byId = id => document.getElementById(id);
  const catalog = byId('books');
  const count = byId('bookCount');
  const notice = byId('libraryNotice');
  const upload = byId('bookUpload');
  const form = byId('bookForm');
  const titleInput = byId('bookTitle');
  const descriptionInput = byId('bookDescription');
  const pdfInput = byId('bookPdf');
  const coverInput = byId('bookCover');
  const preview = byId('coverPreview');
  const formError = byId('bookFormError');
  const publish = byId('publishBook');
  const reader = byId('bookReader');
  const frame = byId('pdfFrame');
  let books = [];
  let saving = false;
  let previewUrl = '';
  let coverVersion = 0;

  function clearCover() {
    coverVersion++;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    coverInput.value = '';
    preview.removeAttribute('src');
    preview.hidden = true;
    byId('removeCover').hidden = true;
  }

  function showUpload() {
    formError.textContent = '';
    if (!upload.open) upload.showModal();
    titleInput.focus();
  }

  function closeUpload() {
    if (!saving) upload.close();
  }
  byId('adminAdd').addEventListener('click', showUpload);
  upload.querySelectorAll('[data-close-upload]').forEach(button => button.addEventListener('click', closeUpload));
  upload.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  upload.addEventListener('close', () => { form.reset(); clearCover(); formError.textContent = ''; titleInput.setCustomValidity(''); byId('pdfHint').textContent = 'Até 20 MB. O arquivo ficará disponível para leitura e download.'; });
  byId('removeCover').addEventListener('click', clearCover);
  titleInput.addEventListener('input', () => titleInput.setCustomValidity(''));

  function dismissOnBackdrop(dialog, close) {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
  }
  dismissOnBackdrop(upload, closeUpload);
  dismissOnBackdrop(reader, () => reader.close());

  function readData(file, mime) {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onerror = () => reject(new Error('Não foi possível ler o arquivo. Selecione-o novamente.'));
      fileReader.onload = () => resolve(`data:${mime};base64,${String(fileReader.result).split(',')[1]}`);
      fileReader.readAsDataURL(file);
    });
  }

  pdfInput.addEventListener('change', () => {
    const file = pdfInput.files[0];
    formError.textContent = '';
    if (file && !titleInput.value.trim()) {
      titleInput.value = file.name.replace(/\.pdf$/i, '').slice(0,120);
      titleInput.setCustomValidity('');
    }
    byId('pdfHint').textContent = file ? file.name + ' · ' + (file.size / 1024 / 1024).toFixed(1) + ' MB selecionados' : 'Até 20 MB. O arquivo ficará disponível para leitura e download.';
  });

  function imageType(file) {
    const types = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };
    if (!types[file.type]) throw new Error('Escolha uma capa JPG, PNG ou WebP.');
    if (file.size > 3 * 1024 * 1024) throw new Error('A capa deve ter no máximo 3 MB.');
    return file.type;
  }

  coverInput.addEventListener('change', async () => {
    const file = coverInput.files[0];
    if (!file) { clearCover(); return; }
    const version = ++coverVersion;
    formError.textContent = '';
    try {
      imageType(file);
      const nextUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = nextUrl;
      try { await image.decode(); } catch { URL.revokeObjectURL(nextUrl); throw new Error('Não foi possível abrir esta imagem. Escolha outra capa.'); }
      if (version !== coverVersion) { URL.revokeObjectURL(nextUrl); return; }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = nextUrl;
      preview.src = previewUrl;
      preview.hidden = false;
      byId('removeCover').hidden = false;
    } catch (error) {
      if (version !== coverVersion) return;
      clearCover();
      formError.textContent = error.message;
    }
  });

  async function pdfData(file) {
    if (!file) throw new Error('Selecione o arquivo PDF do livro.');
    if (file.size > 20 * 1024 * 1024) throw new Error('O PDF deve ter no máximo 20 MB.');
    const signature = await file.slice(0, 5).text();
    if (signature !== '%PDF-') throw new Error('O arquivo selecionado não é um PDF válido.');
    return readData(file, 'application/pdf');
  }

  function safeCover(value) {
    return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value || '') ? value : '';
  }

  function renderCatalog() {
    count.textContent = `${books.length} ${books.length === 1 ? 'livro disponível' : 'livros disponíveis'}`;
    catalog.innerHTML = books.length ? books.map(book => {
      const cover = safeCover(book.coverData);
      return `<article class="panel book-card"><div class="book-cover">${cover ? `<img src="${esc(cover)}" alt="Capa de ${esc(book.title)}" loading="lazy">` : `<div class="book-placeholder"><span aria-hidden="true">✦</span><small>${esc(book.title)}</small></div>`}</div><span class="mini-label">PDF · BIBLIOTECA GRIMÓRIO</span><h3>${esc(book.title)}</h3><p>${esc(book.description || 'Abra o livro para descobrir suas páginas.')}</p><button type="button" class="button button-secondary" data-read-book="${esc(book.id)}" aria-label="Ler ${esc(book.title)}">Ler livro <span aria-hidden="true">↗</span></button></article>`;
    }).join('') : '<div class="library-empty"><span aria-hidden="true">▣</span><h2>Uma biblioteca de possibilidades</h2><p>Os livros publicados aparecerão aqui, prontos para acompanhar suas próximas aventuras.</p></div>';
  }

  async function loadBooks() {
    catalog.setAttribute('aria-busy', 'true');
    try {
      const data = await api('/api/books');
      books = data.books || [];
      renderCatalog();
      return true;
    } catch (error) {
      count.textContent = 'Catálogo indisponível';
      catalog.innerHTML = `<div class="library-empty"><h2>Não foi possível carregar os livros</h2><p>${esc(error.message)}</p><button type="button" class="button button-secondary" data-retry>Tentar novamente</button></div>`;
      return false;
    } finally { catalog.setAttribute('aria-busy', 'false'); }
  }

  function openReader(book) {
    const url = globalThis.GrimorioSupabase ? globalThis.GrimorioSupabase.publicPdfUrl(book) : `/api/books/${encodeURIComponent(book.id)}/pdf`;
    byId('readerTitle').textContent = book.title;
    frame.title = `Leitor de PDF — ${book.title}`;
    frame.src = `${url}#view=FitH`;
    byId('readerOpen').href = url;
    byId('readerDownload').href = globalThis.GrimorioSupabase ? globalThis.GrimorioSupabase.publicPdfUrl(book, true) : `${url}?download=1`;
    byId('readerDownload').download = `${book.title.replace(/[<>:"/\\|?*]/g, '_')}.pdf`;
    if (!reader.open) reader.showModal();
    const address = new URL(location.href);
    address.searchParams.set('book', book.id);
    history.replaceState(null, '', address);
  }

  function readLinkedBook() {
    const selected = new URLSearchParams(location.search).get('book');
    if (!selected) return;
    const book = books.find(item => item.id === selected);
    if (book) openReader(book);
    else notice.textContent = 'Este livro não está disponível no catálogo. Escolha outro livro abaixo.';
  }

  byId('closeReader').addEventListener('click', () => reader.close());
  reader.addEventListener('close', () => {
    frame.src = 'about:blank';
    const address = new URL(location.href);
    address.searchParams.delete('book');
    history.replaceState(null, '', address);
  });
  catalog.addEventListener('click', async event => {
    const button = event.target.closest('[data-read-book]');
    if (button) { const book = books.find(item => item.id === button.dataset.readBook); if (book) openReader(book); }
    if (event.target.closest('[data-retry]') && await loadBooks()) readLinkedBook();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    titleInput.value = titleInput.value.trim();
    titleInput.setCustomValidity(titleInput.value ? '' : 'Informe o título do livro.');
    if (!form.reportValidity()) return;
    saving = true;
    formError.textContent = '';
    const controls = [...upload.querySelectorAll('button,input,textarea')];
    controls.forEach(control => { control.disabled = true; });
    publish.textContent = 'Publicando…';
    try {
      const pdf = pdfInput.files[0];
      const cover = coverInput.files[0];
      const payload = { title: titleInput.value, description: descriptionInput.value.trim(), pdfData: await pdfData(pdf), coverData: cover ? await readData(cover, imageType(cover)) : '' };
      await api('/api/books', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      upload.close();
      notice.textContent = 'Livro publicado! O PDF já está disponível para leitura.';
      await loadBooks();
    } catch (error) { formError.textContent = error.message; }
    finally {
      saving = false;
      controls.forEach(control => { control.disabled = false; });
      publish.textContent = 'Publicar no catálogo';
    }
  });

  async function permissions() {
    try { const data = await api('/api/content/permissions'); byId('adminAdd').hidden = !data.canManageContent; }
    catch (error) { byId('adminAdd').hidden = true; notice.textContent = 'Não foi possível verificar a permissão para anexar PDFs. ' + error.message; }
  }
  permissions();
  loadBooks().then(loaded => { if (loaded) readLinkedBook(); });
})();
