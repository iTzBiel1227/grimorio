import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const expectedRemote = 'https://github.com/iTzBiel1227/grimorio.git';
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} falhou. A sincronização foi interrompida.`);
  return capture ? result.stdout.trim() : '';
}
const git = (...args) => run('git', args, true);
try {
  if (git('remote', 'get-url', 'origin') !== expectedRemote) throw new Error('O destino origin difere do repositório autorizado. Confira antes de enviar.');
  if (git('branch', '--show-current') !== 'main') throw new Error('Execute a sincronização na branch main.');
  if (git('diff', '--name-only', '--diff-filter=U')) throw new Error('Resolva os conflitos antes de sincronizar.');
  run('git', ['fetch', 'origin', 'main']);
  const [ahead, behind] = git('rev-list', '--left-right', '--count', 'HEAD...origin/main').split(/\s+/).map(Number);
  if (behind) {
    if (ahead || git('status', '--porcelain')) throw new Error('O GitHub tem mudanças novas. Integre-as ao trabalho local antes de sincronizar.');
    run('git', ['merge', '--ff-only', 'origin/main']);
  }
  const tests = readdirSync(new URL('../tests/', import.meta.url)).filter(file => file.endsWith('.test.js')).map(file => `tests/${file}`);
  run(process.execPath, ['scripts/build-dice.mjs']);
  run(process.execPath, ['--test', ...tests]);
  for (const file of ['api-smoke.mjs', 'content-api.mjs', 'friends-api.mjs', 'community-e2e.mjs', 'dice-visuals.mjs']) run(process.execPath, [`tests/${file}`]);
  run(process.execPath, ['scripts/build.mjs']);
  run('git', ['add', '--all']);
  if (git('diff', '--cached', '--name-only')) {
    const message = process.argv.slice(2).join(' ').trim() || 'Atualiza o Grimório';
    run('git', ['commit', '-m', message]);
  }
  run('git', ['push', '-u', 'origin', 'main']);
  console.log('Grimório sincronizado: https://github.com/iTzBiel1227/grimorio');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
