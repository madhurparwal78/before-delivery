import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { dbPool, query } from './db.js';
import { buildApp } from './api.js';
import { plateFor, EDITION_SIZE, SEED_RATE_BPS } from './edition.js';
import { provisionRealm } from './identity.js';
import { rebuildIndexes } from './indexer.js';
import { ensureApp } from './webhooks.js';
import * as bus from './bus.js';
import { deliverEvent, publishPending, flushAlerts } from './fulfilment.js';
import { start as startSweeps } from './sweeps.js';
import { checkCrossings } from './stock.js';

interface TalePassage { passageId: string; chapter: string; text: string }

const tale = JSON.parse(readFileSync(new URL('../../tale.json', import.meta.url), 'utf8')) as TalePassage[];

async function applySchema(): Promise<void> {
  const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await dbPool.query(sql);
}

async function seedBoxes(): Promise<void> {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    for (let n = 1; n <= EDITION_SIZE; n++) {
      await client.query(
        'INSERT INTO boxes (number, plate, box_state) VALUES ($1,$2,$3) ON CONFLICT (number) DO NOTHING',
        [n, plateFor(n), 'available'],
      );
    }
    await client.query(
      `INSERT INTO rate_changes (rate_bps, effective_from)
       SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM rate_changes)`,
      [SEED_RATE_BPS, '1970-01-01T00:00:00Z'],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function seedTale(): Promise<void> {
  for (let i = 0; i < tale.length; i++) {
    await query(
      'INSERT INTO tale_passages (passage_id, chapter, ordinal, text) VALUES ($1,$2,$3,$4) ON CONFLICT (passage_id) DO UPDATE SET text = EXCLUDED.text',
      [tale[i].passageId, tale[i].chapter, i, tale[i].text],
    );
  }
}

async function provisionAll(): Promise<void> {
  // Kill Bill tenant: ensure it exists (creating a tenant is a one-time op).
  await ensureKillBillTenant().catch(() => {});
  await applySchema().catch((err) => { console.error('schema:', err.message); });
  await seedBoxes().catch((err) => { console.error('seed boxes:', err.message); });
  await seedTale().catch((err) => { console.error('seed tale:', err.message); });
  await provisionRealm().catch((err: Error) => { console.error('keycloak:', err.message); });
  await rebuildIndexes(tale).catch((err) => { console.error('rebuild indexes:', err.message); });
  await ensureApp().catch((err) => { console.error('svix:', err.message); });
  const charityEndpoint = config.charityWebhookUrl;
  if (charityEndpoint) {
    const { setEndpoint } = await import('./webhooks.js');
    await setEndpoint(charityEndpoint).catch(() => {});
  }
}

async function ensureKillBillTenant(): Promise<void> {
  try {
    const res = await fetch(`${config.killbill.url}/1.0/kb/tenants?apiKey=${encodeURIComponent(config.killbill.apiKey)}`, {
      headers: {
        authorization: 'Basic ' + Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64'),
        'X-Killbill-ApiKey': config.killbill.apiKey,
        'X-Killbill-ApiSecret': config.killbill.apiSecret,
      },
    });
    if (res.status === 200) return;
    await fetch(`${config.killbill.url}/1.0/kb/tenants`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Basic ' + Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64'),
        'X-Killbill-ApiKey': config.killbill.apiKey,
        'X-Killbill-ApiSecret': config.killbill.apiSecret,
        'X-Killbill-CreatedBy': 'svovlstik-press',
      },
      body: JSON.stringify({ apiKey: config.killbill.apiKey, apiSecret: config.killbill.apiSecret }),
    });
  } catch {
    // Kill Bill is not up yet; the app still serves.
  }
}

async function startWorkers(): Promise<void> {
  const consume = async (): Promise<void> => {
    try {
      await bus.consume(deliverEvent);
    } catch {
      setTimeout(consume, 2000);
    }
  };
  void consume();
  startSweeps();
  // Periodic catch-ups: pending events, alerts, index drift.
  setInterval(() => { publishPending().catch(() => {}); flushAlerts().catch(() => {}); }, 5000);
  setInterval(() => { rebuildIndexes(tale).catch(() => {}); }, 30_000);
  setInterval(() => { checkCrossings().catch(() => {}); }, 10_000);
}

async function main(): Promise<void> {
  console.log('Svovlstik Press: The Last Bundle');
  // Provision in the background, retrying for services that are not yet up.
  void provisionAll().then(() => {
    console.log('provisioning pass complete');
  });
  await startWorkers();
  const app = buildApp();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`listening on 0.0.0.0:${config.port}`);
  });
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});

// Keep the process alive on unhandled promise rejections from service calls.
process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection:', reason);
});
