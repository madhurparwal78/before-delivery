import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { loadConfig } from "./config.ts";
import { createPool, query, one, withTransaction } from "./db.ts";
import type { Pool } from "./db.ts";
import { SCHEMA_SQL } from "./schema.ts";
import { seedIfEmpty, ensureRefSequence } from "./seed.ts";
import { buildApp } from "./api/router.ts";
import { Mailer } from "./services/mailer.ts";
import { KillBillClient } from "./services/killbill.ts";
import { Storage } from "./services/storage.ts";
import { retryQueuedSettlements } from "./api/settlement.ts";
import { audit } from "./store.ts";
import type { OrderRow } from "./store.ts";

/**
 * Seeded orders past draft get their grower accounts and deposit invoices the
 * first time Kill Bill is reachable, once only.
 */
async function backfillSeedBilling(pool: Pool, killbill: KillBillClient): Promise<void> {
  const orders = await query<OrderRow>(pool,
    `SELECT * FROM orders WHERE status NOT IN ('draft','cancelled') AND kb_deposit_invoice_id IS NULL ORDER BY created_at`);
  for (const order of orders.rows) {
    const grower = await one<{ id: string; name: string; contact_name: string; email: string }>(pool,
      "SELECT * FROM growers WHERE id = $1", [order.grower_id]);
    if (!grower) continue;
    const accountId = await killbill.ensureAccount({ id: grower.id, name: grower.name, email: grower.email });
    const invoiceId = await killbill.createChargeInvoice(accountId, [
      { description: `Deposit · ${order.ref}`, cents: order.deposit_cents },
    ]);
    const claimed = await pool.query(
      `UPDATE orders SET kb_account_id = $2, kb_deposit_invoice_id = $3
       WHERE id = $1 AND kb_deposit_invoice_id IS NULL RETURNING id`,
      [order.id, accountId, invoiceId],
    );
    if (claimed.rowCount === 0) {
      await killbill.voidInvoice(invoiceId).catch(() => undefined);
    } else {
      await withTransaction(pool, async (client) => {
        await audit(client, "order", order.id, "deposit_invoice_backfilled", "seed");
      });
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(here, "../client");

  const pool = createPool(config.databaseUrl);
  const killbill = new KillBillClient(config);
  const storage = new Storage(config);
  const mailer = new Mailer(config, pool);
  const services = { config, pool, killbill, storage, clientDir, mailer, dbReady: false };

  const app = buildApp(services);
  const server = createServer(app);
  const port = config.appPublicPort;
  server.listen(port, "0.0.0.0");

  // Keep retrying PostgreSQL; health answers "starting" until it connects.
  for (;;) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Several instances may start together against one database; the schema
  // and seed are applied under an advisory lock.
  const setupClient = await pool.connect();
  try {
    await setupClient.query("SELECT pg_advisory_lock(91472930)");
    await setupClient.query(SCHEMA_SQL);
    await seedIfEmpty(pool);
    await ensureRefSequence(pool);
  } finally {
    await setupClient.query("SELECT pg_advisory_unlock(91472930)").catch(() => undefined);
    setupClient.release();
  }
  services.dbReady = true;

  await storage.ensureBucket();
  await mailer.start(10_000);

  const backfill = async () => {
    try {
      await backfillSeedBilling(pool, killbill);
    } catch {
      // Kill Bill may be unreachable; the next tick retries.
    }
  };
  await backfill();
  const backfillTimer = setInterval(() => {
    void backfill().then(async () => {
      const left = await one<{ count: string }>(pool,
        "SELECT count(*)::text AS count FROM orders WHERE status NOT IN ('draft','cancelled') AND kb_deposit_invoice_id IS NULL");
      if (left?.count === "0") {
        clearInterval(backfillTimer);
      }
    }).catch(() => undefined);
  }, 10_000);

  const settlementTimer = setInterval(() => {
    void retryQueuedSettlements(services).catch(() => undefined);
  }, 10_000);
  settlementTimer.unref?.();

  console.log(`Bloom Desk serving on port ${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
