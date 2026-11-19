import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { startTicker } from './extracts/ticker.ts';
import { App } from './http/app.ts';
import { createServer } from './http/server.ts';
import { StaticFiles } from './http/static.ts';
import { modules } from './modules.ts';

const config = loadConfig(process.env);
const app = new App(config);
for (const mount of modules) mount(app);

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
createServer(app, new StaticFiles(publicDir)).listen(config.port, '0.0.0.0');

void app.storage.available();
void app.db.connect(app.schemaStatements).then(() => startTicker(app));
