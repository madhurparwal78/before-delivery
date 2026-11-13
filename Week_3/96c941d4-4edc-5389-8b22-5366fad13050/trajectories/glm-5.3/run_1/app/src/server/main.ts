import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { config, configComplete, configDiagnostic } from './config.js';
import { routeApi } from './api.js';
import { serveStatic } from './static.js';
import { ensureSchema, pool, markSchemaNeedsRetry, withClient } from './db.js';
import { ensureBucket } from './objects.js';
import { ensureIndex } from './discovery.js';
import { CAMPAIGN_ENCOUNTERS } from '../shared/seed.js';
import { levelDigestOf } from './runs.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = join(here, '..');
const publicRoot = join(distRoot, 'public');

// Campaign definitions are immutable and are ensured on serve.
async function ensureCampaignDefinitions(): Promise<void> {
  await withClient(async (client) => {
    for (const encounter of CAMPAIGN_ENCOUNTERS) {
      const digest = levelDigestOf(encounter.definition);
      await client.query(
        `INSERT INTO campaign_definitions (id, title, digest, definition) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO NOTHING`,
        [encounter.id, encounter.title, digest, JSON.stringify(encounter.definition)],
      );
    }
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${config.publicPort}`);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      await routeApi(req, res);
      return;
    }
    const served = await serveStatic(publicRoot, res, url.pathname);
    if (!served) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Harbour record not found.', fields: {} } }));
    }
  } catch {
    try {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Harbour records unavailable. Try again.', fields: {} } }));
    } catch {
      // response already sent
    }
  }
});

server.on('requestError', () => undefined);

async function initialize(): Promise<void> {
  if (!configComplete()) {
    console.error(configDiagnostic());
    return;
  }
  // Apply schema, index settings and seed data idempotently on serve.
  try {
    await ensureSchema();
    try {
      const campaignTable = await pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'campaign_definitions'",
      );
      if (campaignTable.rowCount === 0) {
        await pool.query(`CREATE TABLE IF NOT EXISTS campaign_definitions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          digest TEXT NOT NULL,
          definition JSONB NOT NULL
        )`);
      }
    } catch {
      markSchemaNeedsRetry();
    }
    await ensureCampaignDefinitions();
  } catch (e) {
    console.error('Initialization deferred: database unavailable at boot; static pages remain available.');
    markSchemaNeedsRetry();
  }
  try {
    await ensureBucket();
  } catch {
    console.error('Initialization deferred: object storage unavailable at boot.');
  }
  try {
    await ensureIndex();
  } catch {
    console.error('Initialization deferred: discovery unavailable at boot.');
  }
}

initialize().then(() => {
  const port = config.publicPort;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Squallglass harbour listening on 0.0.0.0:${port}`);
  });
});

// Periodic reconciliation settles queued discovery work once the provider recovers.
setInterval(() => {
  import('./api.js').then((m) => m.reconcileIndexWork()).catch(() => undefined);
}, 5000).unref?.();
