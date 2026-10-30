import { readFile } from 'node:fs/promises';
import { config } from './src/config.js';
import { startDatabase } from './src/db.js';
import { createApp } from './src/http/app.js';

const assetVersion = await readFile(new URL('./public/assets/build.json', import.meta.url), 'utf8')
  .then((raw) => JSON.parse(raw).version)
  .catch(() => 'dev');

startDatabase();

const app = createApp({ assetVersion });
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Gigfreight dispatch desk listening on 0.0.0.0:${config.port}`);
});
