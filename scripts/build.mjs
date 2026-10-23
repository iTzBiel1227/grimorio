import { cpSync, existsSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This application has physical HTML pages, not a Vite/React bundle.
// Only public assets belong in the static deployment, never the server/database.
const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const source = join(root, 'public');
const output = join(root, 'dist');

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

console.log('Build concluído: interface estática em dist/ (entrada: dist/index.html).');
console.log('Login, livros e sessões ainda exigem o backend Node/SQLite/Socket.IO em execução.');
