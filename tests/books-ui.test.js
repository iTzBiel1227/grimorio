import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/books.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/livros.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const sample = { id: 'book-123', title: 'Livro de Regras', description: 'Regras para a aventura.', coverData: '' };

function file(content, options = {}) {
  return { content, size: options.size ?? Buffer.byteLength(content), type: options.type ?? 'application/pdf', slice(start, end) { return { text: async () => content.slice(start, end) }; } };
}

async function harness({ admin = true, search = '', failPublish = false, existing = [sample] } = {}) {
  const nodes = new Map();
  const calls = [];
  let persisted = existing.map(book => ({ ...book }));
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const result = {
      id, value: '', files: [], hidden: id === 'adminAdd', open: false, disabled: false, textContent: '', innerHTML: '', attributes: {}, events: {},
      addEventListener(name, listener) { (this.events[name] ||= []).push(listener); },
      async emit(name, event = {}) { for (const listener of this.events[name] || []) await listener({ preventDefault() {}, ...event }); },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this[name]; },
      setCustomValidity(message) { this.validation = message; },
      reportValidity() { return Boolean(node('bookTitle').value && !node('bookTitle').validation && node('bookPdf').files.length); },
      showModal() { this.open = true; },
      close() { this.open = false; void this.emit('close'); },
      focus() { this.focused = true; },
      reset() { for (const id of ['bookTitle', 'bookDescription', 'bookPdf', 'bookCover']) { node(id).value = ''; node(id).files = []; } },
      querySelectorAll(selector) { return selector === '[data-close-upload]' ? [node('cancelUpload')] : ['bookTitle', 'bookDescription', 'bookPdf', 'bookCover', 'publishBook', 'cancelUpload'].map(node); },
    };
    nodes.set(id, result);
    return result;
  }
  const location = { href: `http://localhost/livros.html${search}`, search };
  const context = {
    document: { getElementById: node }, URL, URLSearchParams, location,
    history: { replaceState(_state, _title, address) { location.href = address.href; location.search = address.search; } },
    FileReader: class {
      readAsDataURL(input) { this.result = `data:${input.type};base64,${Buffer.from(input.content).toString('base64')}`; this.onload(); }
    },
    Grimorio: {
      esc: value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]),
      api: async (url, options = {}) => {
        calls.push({ url, options });
        if (url === '/api/content/permissions') return { canManageContent: admin };
        if (url === '/api/books' && options.method === 'POST') {
          if (failPublish) throw new Error('Publicação indisponível. Tente novamente.');
          const payload = JSON.parse(options.body);
          persisted.push({ id: 'created-book', ...payload });
          return { id: 'created-book' };
        }
        if (url === '/api/books') return { books: persisted };
        throw new Error(`Unexpected request ${url}`);
      },
    },
  };
  vm.runInNewContext(source, context, { filename: 'books.js' });
  await tick();
  return { node, nodes, calls, location, context, async submit() { await node('bookForm').emit('submit'); await tick(); } };
}

test('catalog is public and both dialogs stay closed until requested', async () => {
  const h = await harness({ admin: false });
  assert.equal(h.node('adminAdd').hidden, true);
  assert.match(h.node('books').innerHTML, /Livro de Regras/);
  assert.equal(h.node('bookUpload').open, false);
  assert.equal(h.node('bookReader').open, false);
  for (const id of ['bookUpload', 'bookReader']) {
    const tag = html.match(new RegExp(`<dialog[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(tag);
    assert.doesNotMatch(tag, /\sopen(?:\s|=|>)/);
  }
});

test('admin opens upload explicitly and whitespace title cannot be submitted', async () => {
  const h = await harness();
  assert.equal(h.node('adminAdd').hidden, false);
  await h.node('adminAdd').emit('click');
  assert.equal(h.node('bookUpload').open, true);
  assert.equal(h.node('bookTitle').focused, true);
  h.node('bookTitle').value = '   ';
  h.node('bookPdf').files = [file('%PDF-1.7\nvalid fixture')];
  await h.submit();
  assert.match(h.node('bookTitle').validation, /título/);
  assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 0);
  await h.node('bookTitle').emit('input');
  assert.equal(h.node('bookTitle').validation, '');
});

test('valid PDF upload normalizes MIME, trims metadata, persists and refreshes catalog', async () => {
  const h = await harness({ existing: [] });
  await h.node('adminAdd').emit('click');
  h.node('bookTitle').value = '  Novo Grimório  ';
  h.node('bookDescription').value = '  Uma nova aventura.  ';
  h.node('bookPdf').files = [file('%PDF-1.7\nfixture', { type: '' })];
  await h.submit();
  const request = h.calls.find(call => call.options.method === 'POST');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.title, 'Novo Grimório');
  assert.equal(payload.description, 'Uma nova aventura.');
  assert.equal(payload.pdfData, `data:application/pdf;base64,${Buffer.from('%PDF-1.7\nfixture').toString('base64')}`);
  assert.equal(payload.coverData, '');
  assert.match(h.node('books').innerHTML, /Novo Grimório/);
  assert.equal(h.node('bookCount').textContent, '1 livro disponível');
  assert.equal(h.node('bookUpload').open, false);
  assert.equal(h.node('publishBook').disabled, false);
  assert.match(h.node('libraryNotice').textContent, /publicado/);
});

test('fake PDF and oversize PDF are rejected before publishing', async t => {
  for (const fixture of [file('not a PDF'), file('%PDF-1.7', { size: 20 * 1024 * 1024 + 1 })]) {
    await t.test(fixture.size > 20 * 1024 * 1024 ? 'oversize' : 'invalid signature', async () => {
      const h = await harness();
      await h.node('adminAdd').emit('click');
      h.node('bookTitle').value = 'Livro';
      h.node('bookPdf').files = [fixture];
      await h.submit();
      assert.equal(h.calls.some(call => call.options.method === 'POST'), false);
      assert.ok(h.node('bookFormError').textContent);
      assert.equal(h.node('bookUpload').open, true);
      assert.equal(h.node('publishBook').disabled, false);
    });
  }
});

test('failed publication keeps the selected PDF and form ready for retry', async () => {
  const h = await harness({ failPublish: true });
  await h.node('adminAdd').emit('click');
  h.node('bookTitle').value = 'Livro';
  h.node('bookPdf').files = [file('%PDF-1.7')];
  await h.submit();
  assert.match(h.node('bookFormError').textContent, /Publicação indisponível/);
  assert.equal(h.node('bookUpload').open, true);
  assert.equal(h.node('bookTitle').value, 'Livro');
  assert.equal(h.node('bookPdf').files.length, 1);
  assert.equal(h.node('publishBook').disabled, false);
});

test('reader opens from a catalog card and unloads PDF when closed', async () => {
  const h = await harness();
  await h.node('books').emit('click', { target: { closest(selector) { return selector === '[data-read-book]' ? { dataset: { readBook: sample.id } } : null; } } });
  assert.equal(h.node('bookReader').open, true);
  assert.equal(h.node('pdfFrame').src, '/api/books/book-123/pdf#view=FitH');
  assert.equal(h.node('readerTitle').textContent, sample.title);
  assert.equal(h.node('readerOpen').href, '/api/books/book-123/pdf');
  assert.equal(h.node('readerDownload').href, '/api/books/book-123/pdf?download=1');
  assert.equal(h.location.search, '?book=book-123');
  await h.node('closeReader').emit('click');
  assert.equal(h.node('bookReader').open, false);
  assert.equal(h.node('pdfFrame').src, 'about:blank');
  assert.equal(h.location.search, '');
});

test('home link opens the requested book and missing IDs show a helpful message', async () => {
  const h = await harness({ search: '?book=book-123' });
  assert.equal(h.node('bookReader').open, true);
  assert.equal(h.node('readerTitle').textContent, sample.title);
  const missing = await harness({ search: '?book=missing' });
  assert.equal(missing.node('bookReader').open, false);
  assert.match(missing.node('libraryNotice').textContent, /não está disponível/);
});

test('untrusted book metadata is escaped before rendering catalog HTML', async () => {
  const h = await harness({ existing: [{ ...sample, title: '<img src=x onerror=alert(1)>', description: '<script>bad</script>', coverData: 'javascript:alert(1)' }] });
  assert.match(h.node('books').innerHTML, /&lt;img/);
  assert.doesNotMatch(h.node('books').innerHTML, /<script>|<img src=x|javascript:/);
});
