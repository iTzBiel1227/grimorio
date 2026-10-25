import { cpSync, existsSync, lstatSync, realpathSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// This application has physical HTML pages, not a Vite/React bundle.
// Only public assets belong in the static deployment, never the server/database.
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const source = join(root, 'public');
const output = join(root, 'dist');
const configPath = join(root, 'supabase', 'frontend.json');
const configuration = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
const environmentConfigured = Boolean(process.env.SUPABASE_URL || process.env.SUPABASE_PUBLISHABLE_KEY);
const localMode = process.env.GRIMORIO_BACKEND === 'sqlite';
const supabaseUrl = localMode ? '' : String(environmentConfigured ? process.env.SUPABASE_URL || '' : configuration.url || '').trim();
const publishableKey = localMode ? '' : String(environmentConfigured ? process.env.SUPABASE_PUBLISHABLE_KEY || '' : configuration.publishableKey || '').trim();
if (Boolean(supabaseUrl) !== Boolean(publishableKey)) {
  throw new Error('Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY juntas para publicar com Supabase.');
}
if (supabaseUrl) {
  const url = new URL(supabaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SUPABASE_URL deve ser a origem HTTPS do projeto, sem caminho ou credenciais.');
  }
  let role;
  try { role = JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url').toString()).role; } catch {}
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey) && role !== 'anon') {
    throw new Error('Use somente a chave publishable (ou anon legada). Chaves secretas/service_role não podem ir para o navegador.');
  }
}

if (!existsSync(join(source, 'index.html'))) {
  throw new Error('Build interrompido: public/index.html não foi encontrado.');
}

// Validate the exact target before replacing any previously generated output.
if (dirname(output) !== root || (existsSync(output) &&
    (lstatSync(output).isSymbolicLink() || realpathSync(output) !== output))) {
  throw new Error('Build interrompido: dist deve ser uma pasta dentro deste projeto.');
}
rmSync(output, { recursive: true, force: true });
cpSync(source, output, { recursive: true });

if (supabaseUrl) {
  const configuration = JSON.stringify({ url: supabaseUrl, publishableKey });
  await build({
    stdin: {
      contents: `import { createClient } from '@supabase/supabase-js';
import './public/supabase-client.js';
import './public/supabase-realtime.js';
window.GRIMORIO_SUPABASE = ${configuration};
window.GrimorioSupabase = window.createGrimorioSupabaseAdapter(createClient, window.GRIMORIO_SUPABASE);
window.GrimorioSupabaseRealtime.install(window.GrimorioSupabase.client);`,
      resolveDir: root,
      sourcefile: 'supabase-bootstrap.js',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    outfile: join(output, 'supabase-runtime.js'),
  });
  for (const name of readdirSync(output).filter(file => file.endsWith('.html'))) {
    const file = join(output, name);
    const html = readFileSync(file, 'utf8')
      .replace(/<script\s+src=["']\/socket\.io\/socket\.io\.js["']\s*><\/script>/gi, '')
      .replace(/<\/head>/i, '<script src="/supabase-runtime.js"></script></head>');
    writeFileSync(file, html);
  }
}

console.log('Build concluído: interface estática em dist/ (entrada: dist/index.html).');
console.log(supabaseUrl
  ? 'Modo Supabase: interface configurada para Auth, banco, PDFs e sessões no projeto informado.'
  : 'Modo local: login, livros e sessões exigem o backend Node/SQLite/Socket.IO em execução.');
