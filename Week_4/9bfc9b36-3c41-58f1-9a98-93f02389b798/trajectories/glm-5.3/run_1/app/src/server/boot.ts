import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readConfig } from './config.ts';
import type { Config } from './config.ts';
import { createDb, type Db } from './db.ts';
import { Keycloak } from './keycloak.ts';
import { Store } from './store.ts';
import { seedLoft } from './seedrun.ts';
import { renderCutSheet } from './cutsheet.ts';

export interface Ctx {
  config: Config;
  db: Db;
  keycloak: Keycloak;
  store: Store;
  dbUp: boolean;
  identityUp: boolean;
}

export async function boot(): Promise<Ctx> {
  const config = readConfig();
  const db = createDb(config.databaseUrl);
  const keycloak = new Keycloak(config);
  const store = new Store(config);
  const ctx: Ctx = { config, db, keycloak, store, dbUp: false, identityUp: false };
  void ensureSchemaSeed(ctx);
  void ensureIdentity(ctx);
  void ensureBucket(ctx);
  return ctx;
}

async function withRetry(fn: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await fn();
      return;
    } catch {
      await sleep(2000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Schema and seed under the boot lock, retried until the database answers. */
export async function ensureSchemaSeed(ctx: Ctx): Promise<void> {
  await withRetry(async () => {
    const schema = readFileSync(new URL('schema.sql', import.meta.url), 'utf8');
    await ctx.db.withClient(async (client) => {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(918273645)');
      await client.query(schema);
      const done = await client.query<{ done: boolean }>(`SELECT done FROM seed_lock WHERE id=1`);
      if (done.length === 0 || !done[0]!.done) {
        await seedLoft(client, {
          renderCutSheet: renderCutSheet,
          storePutConfirmed: (key, bytes) =>
            ctx.store.putConfirmed(key, bytes, 'image/svg+xml', { sha256: createHash('sha256').update(bytes).digest('hex') }),
        });
      }
      await client.query('COMMIT');
    });
    ctx.dbUp = true;
  });
}

export async function ensureIdentity(ctx: Ctx): Promise<void> {
  await withRetry(async () => {
    await ctx.keycloak.ensureRealmRoles();
    ctx.identityUp = true;
  });
}

export async function ensureBucket(ctx: Ctx): Promise<void> {
  await withRetry(async () => {
    await ctx.store.ensureBucket();
  });
}
