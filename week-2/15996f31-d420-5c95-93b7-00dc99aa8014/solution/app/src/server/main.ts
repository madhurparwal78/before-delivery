// Boot: listen at once on 0.0.0.0, keep retrying PostgreSQL, then run the shared workers every 10 s.
// Kill Bill, Mailpit and MinIO are only used on demand, so the server starts and stays healthy without them.

import { createServer } from "node:http";
import { authenticate } from "./auth.js";
import { config } from "./config.js";
import { connectWithRetry, isReady, pool, rows, tx } from "./db.js";
import { ApiError, compile, dispatch, send, sendError } from "./http.js";
import { assess, lockOrder } from "./model.js";
import { dropRoutes } from "./routes/drops.js";
import { fileRoutes } from "./routes/files.js";
import { inspectRoutes } from "./routes/inspect.js";
import { orchardRoutes } from "./routes/orchards.js";
import { orderRoutes } from "./routes/orders.js";
import { sessionRoutes } from "./routes/session.js";
import { growerAccount, invoiceCharges } from "./services/killbill.js";
import { flushOutbox } from "./services/mailer.js";
import { isBillingOutage, retryQueuedSettlements } from "./settlement.js";
import { serveStatic } from "./static.js";

const routes = compile([...sessionRoutes, ...orchardRoutes, ...orderRoutes, ...dropRoutes, ...inspectRoutes, ...fileRoutes]);

async function health(): Promise<boolean> {
  if (!isReady()) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/api/health") {
    req.resume();
    void health().then((ok) => send(res, { status: ok ? 200 : 503, json: { status: ok ? "ok" : "starting" } }));
    return;
  }
  if (path.startsWith("/api/") || path.startsWith("/files/")) {
    if (!isReady()) {
      req.resume();
      sendError(res, new ApiError(503, "starting", "Bloom Desk is starting. Try again in a minute."));
      return;
    }
    res.on("finish", () => {
      if (req.method !== "GET") void flushOutbox();
    });
    void dispatch(routes, authenticate, req, res, path);
    return;
  }
  void serveStatic(req, res, path);
});

/** Seeded orders past draft get their grower account and deposit invoice once Kill Bill is reachable, once only. */
async function invoiceSeededDeposits(): Promise<void> {
  const pending = await rows<{ id: string }>(pool, "SELECT id FROM orders WHERE status NOT IN ('draft', 'cancelled') AND deposit_invoice_id IS NULL");
  for (const { id } of pending) {
    try {
      await tx(async (db) => {
        const claimed = await rows(db, "SELECT id FROM orders WHERE id = $1 AND deposit_invoice_id IS NULL FOR UPDATE SKIP LOCKED", [id]);
        if (claimed.length === 0) return;
        const order = await lockOrder(db, id);
        if (order === null || order.status === "cancelled") return;
        const account = await growerAccount(db, order.orchard.grower_id);
        const invoiceId = await invoiceCharges(account, [{ cents: assess(order).depositCents, description: `Deposit · ${order.ref}` }]);
        await db.query("UPDATE orders SET deposit_invoice_id = $2 WHERE id = $1", [id, invoiceId]);
      });
    } catch (error) {
      if (!isBillingOutage(error)) console.error("seed deposit:", error instanceof Error ? error.message : error);
      return;
    }
  }
}

async function work(): Promise<void> {
  await Promise.allSettled([flushOutbox(), retryQueuedSettlements(), invoiceSeededDeposits()]);
}

server.listen(config.port, "0.0.0.0", () => console.log(`Bloom Desk listening on 0.0.0.0:${config.port}`));

void connectWithRetry().then(() => {
  console.log("PostgreSQL ready");
  void work();
  setInterval(() => void work(), 10_000);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  });
}
