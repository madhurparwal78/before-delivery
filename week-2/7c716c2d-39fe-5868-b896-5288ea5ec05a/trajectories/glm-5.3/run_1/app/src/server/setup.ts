import { withClient } from "./db.ts";
import type { Config } from "./env.ts";
import { schemaSql } from "./schema.ts";
import { seedIfEmpty } from "./seed.ts";
import * as billing from "./billing.ts";

/** Apply the schema idempotently, seed an empty database, and register Kill Bill accounts. */
export async function applySchemaAndSeed(cfg: Config): Promise<void> {
  await withClient(async (client) => {
    await client.query(schemaSql);
    await seedIfEmpty(client);
  });
  await registerWorkspaces(cfg);
}

/** Ensure one Kill Bill account and per-seat subscription per workspace. */
export async function registerWorkspaces(cfg: Config): Promise<void> {
  await withClient(async (client) => {
    const ws = await client.query<{ id: string; name: string; seat_limit: number }>(
      "SELECT id, name, seat_limit FROM workspaces"
    );
    for (const w of ws.rows) {
      await billing.readBillingState(cfg, w.id, w.name, w.seat_limit);
    }
  });
}
