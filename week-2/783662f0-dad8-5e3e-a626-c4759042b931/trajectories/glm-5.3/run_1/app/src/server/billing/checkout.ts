/** Checkout: renting a server opens its Kill Bill account, tag and subscription.
 * The server exists only once Kill Bill holds all three, and retries reuse what exists. */

import type { Pool, Client } from "../db/pool.js";
import { randomBytes } from "node:crypto";
import { starterLayout, SeedTables } from "../../shared/data.js";
import { newId, randomWeatherSeed } from "../db/seed.js";
import * as kb from "../billing/killbill.js";

export interface CheckoutInput {
  serverName: string;
  plan: "hamlet" | "borough";
  ownerId: string;
}

export interface CheckoutResult {
  ok: true;
  serverId: string;
  slug: string;
}

/** Creates the server in pending approval together with its Kill Bill records. */
export async function checkout(pool: Pool, input: CheckoutInput): Promise<CheckoutResult> {
  const slug = input.serverName.toLowerCase().replace(/\s+/g, "-");
  const serverId = newId();
  const externalKey = `plotwright-${serverId}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`checkout:${input.ownerId}:${slug}`]);

    // Find or create the Kill Bill account: a retry after a partial failure reuses it.
    let accountId: string | null = null;
    const existing = await client.query<{ account_id: string }>("SELECT account_id FROM kb_accounts WHERE external_key = $1", [externalKey]);
    if (existing.rows.length > 0) {
      accountId = existing.rows[0]!.account_id;
    } else {
      const account = await kb.createAccount(externalKey, input.serverName);
      await kb.addAutoPayOffTag(account.accountId);
      await client.query("INSERT INTO kb_accounts (external_key, account_id, kind) VALUES ($1,$2,'server')", [externalKey, account.accountId]);
      accountId = account.accountId;
    }

    // The base subscription, found by external key if a retry already made it.
    let subscription = await kb.findSubscriptionByExternalKey(`${externalKey}-plan`);
    if (subscription === null) {
      subscription = await kb.createSubscription(accountId, `${externalKey}-plan`, `${externalKey}-bundle`, `${input.plan}-monthly`);
    }
    await client.query(
      `INSERT INTO kb_accounts (external_key, account_id, kind) VALUES ($1,$2,'subscription')
       ON CONFLICT (external_key) DO NOTHING`,
      [`${externalKey}-sub`, subscription.subscriptionId]
    );

    const worldId = newId();
    const tiles = starterLayout(SeedTables.map((t) => ({ x: t.x, y: t.y }))).join("\n");
    await client.query(
      `INSERT INTO servers (id, slug, name, owner_id, status, plan, time_zone, weather_seed)
       VALUES ($1,$2,$3,$4,'pending_approval',$5,'UTC',$6)`,
      [serverId, slug, input.serverName, input.ownerId, input.plan, randomWeatherSeed()]
    );
    await client.query("UPDATE servers SET killbill_account_id = $1 WHERE id = $2", [accountId, serverId]);
    await client.query("INSERT INTO members (server_id, user_id) VALUES ($1,$2)", [serverId, input.ownerId]);
    await client.query("INSERT INTO seasons (server_id, n) VALUES ($1, 1)", [serverId]);
    await client.query("INSERT INTO worlds (id, server_id, slug, name, tiles) VALUES ($1,$2,'home','Home',$3)", [worldId, serverId, tiles]);
    for (const t of SeedTables) {
      await client.query(
        `INSERT INTO tables_ (id, server_id, world_id, name, game, x, y, state, stake, turn_seconds, etag)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'open',10,30,$8)`,
        [newId(), serverId, worldId, t.name, t.game, t.x, t.y, randomBytes(10).toString("hex")]
      );
    }
    await client.query("COMMIT");
    return { ok: true, serverId, slug };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Kill Bill records for a seeded server, found by external key when they already exist.
 * Approves the first invoice so the server turns active within 60 seconds. */
export async function provisionSeededServer(client: Client, serverId: string, name: string, plan: "hamlet" | "borough"): Promise<void> {
  const externalKey = `plotwright-${serverId}`;
  const existing = await client.query<{ account_id: string }>("SELECT account_id FROM kb_accounts WHERE external_key = $1", [externalKey]);
  let accountId: string | null = existing.rows.length > 0 ? existing.rows[0]!.account_id : null;
  if (accountId === null) {
    const account = await kb.createAccount(externalKey, name);
    await kb.addAutoPayOffTag(account.accountId);
    await client.query("INSERT INTO kb_accounts (external_key, account_id, kind) VALUES ($1,$2,'server')", [externalKey, account.accountId]);
    accountId = account.accountId;
  }
  let subscription = await kb.findSubscriptionByExternalKey(`${externalKey}-plan`);
  if (subscription === null) {
    subscription = await kb.createSubscription(accountId, `${externalKey}-plan`, `${externalKey}-bundle`, `${plan}-monthly`);
  }
  await client.query("UPDATE servers SET killbill_account_id = $1 WHERE id = $2", [accountId, serverId]);
}
