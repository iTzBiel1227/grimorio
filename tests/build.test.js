import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
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
    env: { ...process.env, GRIMORIO_BACKEND: 'sqlite', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' },
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

test('Supabase build connects every page to the bundled client and refuses secret keys', async t => {
  const temporaryRoot = path.join(project, '.tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const fixture = await mkdtemp(path.join(temporaryRoot, 'build-test-'));
  t.after(async () => {
    if (path.dirname(fixture) !== temporaryRoot) throw new Error('Unexpected test directory');
    await rm(fixture, { recursive: true, force: true });
  });
  await mkdir(path.join(fixture, 'scripts'));
  await cp(path.join(project, 'scripts/build.mjs'), path.join(fixture, 'scripts/build.mjs'));
  await cp(source, path.join(fixture, 'public'), { recursive: true });
  const execute = values => spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: fixture, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GRIMORIO_BACKEND: 'supabase', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', ...values },
  });
  const build = execute({});
  assert.ifError(build.error);
  assert.equal(build.status, 0, build.stderr);
  const published = path.join(fixture, 'dist');
  const runtime = await readFile(path.join(published, 'supabase-runtime.js'), 'utf8');
  assert.ok(runtime.includes('https://example.supabase.co'));
  for (const name of (await readdir(published)).filter(file => file.endsWith('.html'))) {
    const html = await readFile(path.join(published, name), 'utf8');
    assert.ok(html.indexOf('/supabase-runtime.js') < html.indexOf('/shell.js'), name);
    assert.ok(!html.includes('/socket.io/socket.io.js'), name);
  }
  for (const key of ['sb_secret_do_not_publish', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`, '']) {
    const rejected = execute({ SUPABASE_PUBLISHABLE_KEY: key });
    assert.notEqual(rejected.status, 0, 'a secret or missing key must stop the build');
    assert.ok(!rejected.stderr.includes('sb_secret_do_not_publish'), 'never log credential values');
  }
});
