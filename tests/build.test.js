import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import express from 'express';

const project = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(project, 'public');
const output = path.join(project, 'dist');

async function filesIn(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

test('production build serves every page and local asset without exposing backend files or masking API errors', async t => {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'obsolete-build-test.txt'), 'stale deployment file');
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: project, encoding: 'utf8', windowsHide: true,
  });
  assert.ifError(build.error);
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const sourceFiles = await filesIn(source);
  assert.deepEqual(await filesIn(output), sourceFiles, 'publish only the public tree and remove stale output');
  for (const file of sourceFiles) {
    assert.deepEqual(await readFile(path.join(output, file)), await readFile(path.join(source, file)), file);
  }

  const app = express();
  app.use(express.static(output));
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const requested = new Set();
  const pages = ['/', ...sourceFiles.filter(file => file.endsWith('.html')).map(file => `/${file}`)];
  for (const route of pages) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /text\/html/, route);
    const html = await response.text();
    assert.equal(html, await readFile(path.join(source, route === '/' ? 'index.html' : route.slice(1)), 'utf8'), route);
    for (const match of html.matchAll(/<(?:a|script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
      const reference = match[1];
      if (reference.startsWith('#')) continue;
      const address = new URL(reference, origin + route);
      if (address.origin !== origin || address.pathname.startsWith('/socket.io/')) continue;
      requested.add(address.href);
    }
  }
  for (const address of requested) {
    const response = await fetch(address);
    assert.equal(response.status, 200, address);
    await response.arrayBuffer();
  }
  for (const route of ['/api/missing', '/socket.io/socket.io.js', '/server.js', '/package.json', '/grimorio.sqlite', '/.env', '/obsolete-build-test.txt']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 404, `${route} must not return index.html with status 200`);
    await response.text();
  }
});
