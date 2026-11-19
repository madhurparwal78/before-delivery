import { SCHEMA } from "./schema.ts";
import { tx } from "./pool.ts";
import { seed } from "./seed.ts";

const MIGRATE_LOCK = 482017;

/** Schema and seed under one advisory lock, so several copies starting together are safe. */
export async function migrate(): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATE_LOCK]);
    await client.query(SCHEMA);
    await seed(client);
  });
}
