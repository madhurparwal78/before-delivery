import { Pool } from './db.js';
import { getConfig } from './config.js';
import { StatementStore } from './store.js';
import { applySchema } from './schema.js';
import { seedIfEmpty } from './seed.js';

export interface App {
  db: Pool;
  store: StatementStore;
  ready: boolean;
}

export interface BootResult {
  db: Pool;
  store: StatementStore;
}

/** Boot: schema, seed and bucket, retrying until Postgres answers. */
export async function boot(): Promise<BootResult> {
  const db = new Pool();
  for (;;) {
    try {
      await applySchema(db);
      break;
    } catch (err) {
      if ((err as { status?: number }).status === 503) {
        await new Promise((resolve): void => { setTimeout(resolve, 2_000); });
        continue;
      }
      throw err;
    }
  }
  const store = new StatementStore();
  await seedIfEmpty(db, new Date());
  void store.ensureBucket().catch((): void => undefined);
  return { db, store };
}

export function healthPayload(app: { ready: boolean }): { status: number; body: { status: string } } {
  return app.ready ? { status: 200, body: { status: 'ok' } } : { status: 503, body: { status: 'starting' } };
}

export function configSummary(): { gracePeriod: number; stalenessLimit: number; quoteLifetime: number; pollSeconds: number } {
  const cfg = getConfig();
  return {
    gracePeriod: cfg.graceSeconds,
    stalenessLimit: cfg.stalenessSeconds,
    quoteLifetime: cfg.quoteTtlSeconds,
    pollSeconds: cfg.oraclePollSeconds,
  };
}
