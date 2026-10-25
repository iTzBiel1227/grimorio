import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
  throw new Error('Execute npm run build antes de abrir a prévia.');
}
const port = Number(process.env.PORT || 3001);
const app = express();
app.use(express.static(directory));
app.listen(port, '127.0.0.1', () => console.log(`Prévia do build: http://localhost:${port}`));
