import http from 'node:http';
import { readConfig } from './config.js';
import { applySchema, createPool } from './db.js';
import { seed } from './seed.js';
import { Storage } from './storage.js';
import { Mailer } from './mailer.js';
import { handleRequest } from './router.js';

async function main(): Promise<void> {
  const config = readConfig();
  const pool = await createPool(config.databaseUrl);
  await applySchema(pool);
  await seed(pool);
  const storage = new Storage(config);
  await storage.ensureBucket();
  const mailer = new Mailer(config);

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, { pool, storage, mailer, config }).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong.' } }));
      } else {
        res.end();
      }
      console.error('unhandled', err);
    });
  });
  server.listen(config.publicPort, '0.0.0.0', () => {
    console.log(`Atelier Ourlet serving on 0.0.0.0:${config.publicPort}`);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
