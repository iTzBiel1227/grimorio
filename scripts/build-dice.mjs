import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({entryPoints:[root+'client/dice-renderer.mjs'],bundle:true,format:'iife',platform:'browser',target:['es2020'],minify:true,outfile:root+'public/dice-runtime.js',legalComments:'eof'});
