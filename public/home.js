(async () => {
  const { api } = Grimorio;
  const image = document.querySelector('#featuredBookImage');
  const link = document.querySelector('#featuredBookLink');
  const artLink = document.querySelector('#featureArtLink');
  const edit = document.querySelector('#editFeature');
  const dialog = document.querySelector('#featureDialog');
  const form = document.querySelector('#featureForm');
  const file = document.querySelector('#featureFile');
  const preview = document.querySelector('#featurePreview');
  const book = document.querySelector('#featureBook');
  const error = document.querySelector('#featureError');
  let saved = {imageData:'/assets/grimorio-book.png',bookId:''};
  let pendingImage = saved.imageData;
  let busy = false;
  let reading = false;
  const apply = () => {
    image.src = saved.imageData;
    link.href = artLink.href = saved.bookId ? '/livros.html?book=' + encodeURIComponent(saved.bookId) : '/livros.html';
    link.firstChild.textContent = saved.bookId ? 'Ler o livro ' : 'Explorar o catálogo ';
  };
  try { saved = await api('/api/home-feature'); apply(); } catch { /* The packaged artwork stays visible offline. */ }
  try { edit.hidden = !(await api('/api/content/permissions')).canManageContent; } catch { edit.hidden = true; }
  const close = () => { if (!busy && !reading) dialog.close(); };
  document.querySelector('#closeFeature').onclick = close;
  document.querySelector('#cancelFeature').onclick = close;
  dialog.addEventListener('cancel', event => { if (busy || reading) event.preventDefault(); });
  edit.onclick = async () => {
    pendingImage = saved.imageData; preview.src = pendingImage; file.value = ''; error.textContent = '';
    book.replaceChildren(new Option('Abrir o catálogo', '')); dialog.showModal();
    try { const data = await api('/api/books'); book.replaceChildren(new Option('Abrir o catálogo', '')); data.books.forEach(item => book.add(new Option(item.title,item.id))); book.value = saved.bookId; }
    catch (err) { error.textContent = err.message; }
  };
  file.onchange = async () => {
    const selected = file.files[0]; if (!selected) return;
    error.textContent = '';
    if (!['image/png','image/jpeg','image/webp'].includes(selected.type) || selected.size > 3 * 1024 * 1024) { file.value = ''; error.textContent = 'Escolha uma imagem PNG, JPG ou WEBP de até 3 MB.'; return; }
    reading = true; file.disabled = true;
    try {
      const value = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Não foi possível ler a imagem.')); reader.readAsDataURL(selected); });
      const check = new Image(); check.src = value; await check.decode();
      pendingImage = value; preview.src = value;
    } catch { error.textContent = 'Não foi possível abrir esta imagem.'; file.value = ''; }
    finally { reading = false; file.disabled = false; }
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || reading) return; busy = true; error.textContent = '';
    const controls = [...form.querySelectorAll('input,select,button')]; controls.forEach(c => c.disabled = true);
    try { saved = await api('/api/home-feature',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageData:pendingImage,bookId:book.value})}); apply(); dialog.close(); }
    catch (err) { error.textContent = err.message; }
    finally { busy = false; controls.forEach(c => c.disabled = false); }
  };
})();
