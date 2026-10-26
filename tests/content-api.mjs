import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// Run the real API against a disposable database, never the project's database.
const id = randomUUID();
const port = 35000 + Math.floor(Math.random() * 10000);
const dbPath = path.join(tmpdir(), `grimorio-content-${id}.sqlite`);
const script = path.resolve('tests', `.runtime-content-${id}.mjs`);
const databaseDeclaration = 'new Database(path.join(__dirname, "grimorio.sqlite"))';
const source = readFileSync('server.js', 'utf8');
assert.ok(source.includes(databaseDeclaration), 'Database isolation must match the server before starting');
writeFileSync(script, source.replace(databaseDeclaration, `new Database(${JSON.stringify(dbPath)})`));
let child;

async function startServer() {
  child = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: String(port), ADMIN_EMAIL: ' ADMIN@EXAMPLE.TEST ' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Server startup timeout: ${errors}`)), 10000);
    child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Server exited ${code}: ${errors}`)); });
  });
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await exited;
}

async function request(url, { method = 'GET', body, token } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  return {
    status: response.status,
    headers: response.headers,
    data: response.status === 204 ? null : isJson ? await response.json() : Buffer.from(await response.arrayBuffer()),
  };
}

function makePdf() {
  // A complete one-page PDF with correct object offsets and xref table.
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 4 >>\nstream\nq\nQ\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const pdfBytes = makePdf();
const pdfData = `data:application/pdf;base64,${pdfBytes.toString('base64')}`;
const pngData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZxkAAAAASUVORK5CYII=';
const fakeImage = `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`;
const title = 'Grimório — Livro de Regras';
const book = { title: `  ${title}  `, description: '  Edição de teste  ', pdfData, coverData: pngData };

try {
  await startServer();
  const admin = await request('/api/auth/register', { method: 'POST', body: { username:'admin',birthDate:'2000-01-01',email: 'admin@example.test', password: 'test-password-123' } });
  const user = await request('/api/auth/register', { method: 'POST', body: { username:'reader',birthDate:'2000-01-01',email: 'reader@example.test', password: 'test-password-123' } });
  assert.equal(admin.status, 201);
  assert.equal(admin.data.user.role, 'admin');
  assert.equal(user.status, 201);
  assert.equal(user.data.user.role, 'user');
  const adminToken = admin.data.token;
  const userToken = user.data.token;

  assert.deepEqual((await request('/api/content/permissions')).data, { canManageContent: false });
  assert.deepEqual((await request('/api/content/permissions', { token: userToken })).data, { canManageContent: false });
  assert.deepEqual((await request('/api/content/permissions', { token: adminToken })).data, { canManageContent: true });
  assert.deepEqual((await request('/api/books')).data.books, []);
  assert.deepEqual((await request('/api/home-feature')).data, { imageData: '/assets/grimorio-book.png', bookId: '' });
  assert.equal((await request('/api/books', { method: 'POST', body: book })).status, 401);
  assert.equal((await request('/api/books', { method: 'POST', body: book, token: userToken })).status, 403);
  assert.equal((await request('/api/home-feature', { method: 'PUT', body: { imageData: pngData } })).status, 401);
  assert.equal((await request('/api/home-feature', { method: 'PUT', body: { imageData: pngData }, token: userToken })).status, 403);

  for (const invalid of [
    { ...book, title: '   ' },
    { ...book, pdfData: 'data:application/pdf;base64,bm90IGEgcGRm' },
    { ...book, pdfData: 'data:application/pdf;base64,%%%invalid%%%' },
    { ...book, coverData: fakeImage },
    { ...book, pdfData: '' },
  ]) assert.equal((await request('/api/books', { method: 'POST', body: invalid, token: adminToken })).status, 400);
  const oversizedPdf = Buffer.alloc(20 * 1024 * 1024 + 1, 32);
  oversizedPdf.write('%PDF-1.4');
  assert.equal((await request('/api/books', { method: 'POST', body: { ...book, pdfData: `data:application/pdf;base64,${oversizedPdf.toString('base64')}` }, token: adminToken })).status, 400);
  assert.equal((await request('/api/books')).data.books.length, 0, 'Rejected uploads must not create books');

  const created = await request('/api/books', { method: 'POST', body: book, token: adminToken });
  assert.equal(created.status, 201);
  const bookId = created.data.id;
  assert.ok(bookId);
  const catalog = await request('/api/books');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.books.length, 1);
  assert.equal(catalog.data.books[0].title, title);
  assert.equal(catalog.data.books[0].description, 'Edição de teste');
  assert.equal(catalog.data.books[0].coverData, pngData);
  assert.equal(catalog.data.books[0].pdfData, undefined, 'Catalog does not transfer the full PDF');
  for (const download of [false, true]) {
    const served = await request(`/api/books/${bookId}/pdf${download ? '?download=1' : ''}`);
    assert.equal(served.status, 200);
    assert.match(served.headers.get('content-type'), /^application\/pdf/);
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(served.headers.get('content-disposition').startsWith(download ? 'attachment;' : 'inline;'));
    assert.ok(served.headers.get('content-disposition').includes(encodeURIComponent(`${title}.pdf`)));
    assert.deepEqual(served.data, pdfBytes);
  }
  assert.equal((await request('/api/books/nonexistent/pdf')).status, 404);

  const feature = { imageData: pngData, bookId };
  assert.equal((await request('/api/home-feature', { method: 'PUT', body: { ...feature, bookId: 'nonexistent' }, token: adminToken })).status, 400);
  assert.equal((await request('/api/home-feature', { method: 'PUT', body: { ...feature, imageData: fakeImage }, token: adminToken })).status, 400);
  assert.deepEqual((await request('/api/home-feature', { method: 'PUT', body: feature, token: adminToken })).data, feature);
  assert.deepEqual((await request('/api/home-feature')).data, feature);

  const profile = { displayName: '  Aventureira das Cinzas  ', avatarData: pngData, role: 'admin' };
  assert.equal((await request('/api/profile', { method: 'PUT', body: profile })).status, 401);
  const updated = await request('/api/profile', { method: 'PUT', body: profile, token: userToken });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.user.displayName, 'Aventureira das Cinzas');
  assert.equal(updated.data.user.avatarData, pngData);
  assert.equal(updated.data.user.role, 'user', 'Editing a profile cannot grant administrator access');
  assert.equal((await request('/api/profile', { method: 'PUT', body: { displayName: 'Must not persist', avatarData: fakeImage }, token: userToken })).status, 400);
  const oversizedPng = Buffer.alloc(3 * 1024 * 1024 + 1);
  Buffer.from(pngData.split(',')[1], 'base64').copy(oversizedPng);
  assert.equal((await request('/api/profile', { method: 'PUT', body: { displayName: 'Must not persist', avatarData: `data:image/png;base64,${oversizedPng.toString('base64')}` }, token: userToken })).status, 400);
  assert.deepEqual((await request('/api/auth/me', { token: userToken })).data.user, updated.data.user);
  assert.equal((await request('/api/auth/me', { token: adminToken })).data.user.displayName, 'admin', 'Another account remains unchanged');

  // Verify database persistence, rather than just state retained by a running process.
  await stopServer();
  await startServer();
  assert.deepEqual((await request('/api/home-feature')).data, feature);
  assert.deepEqual((await request('/api/books')).data, catalog.data);
  assert.deepEqual((await request(`/api/books/${bookId}/pdf`)).data, pdfBytes);
  assert.deepEqual((await request('/api/auth/me', { token: userToken })).data.user, updated.data.user);
  assert.equal((await request('/api/auth/me', { token: adminToken })).data.user.role, 'admin');
  console.log('OK: permissões de administrador, catálogo e PDF, anúncio vinculado, perfil e persistência após reinício em banco isolado.');
} finally {
  await stopServer();
  for (const file of [script, dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
