/** The one process: API, browser app, schema and seed, and the background loops. */

import express from "express";
import type { NextFunction, Request, Response } from "express";
import { config, loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { applySchema, seed } from "./db/seed.js";
import { installRoutes } from "./api/routes.js";
import { apiError } from "./api/errors.js";
import { sendError } from "./api/boundary.js";
import { setRuntimePool } from "./runtime.js";
import * as kb from "./billing/killbill.js";
import { refreshBilling, loadBillingRowById } from "./billing/status.js";
import { settlePendingPayments } from "./billing/payments.js";
import { provisionSeededServer } from "./billing/checkout.js";
import { scanDeadlines } from "./tables/engine.js";
import { retryPendingResults } from "./tables/settle.js";
import { retryHeldMail } from "./mail/mailer.js";
import { retryCheckpoints } from "./parties/checkpoints.js";
import { scanWeather } from "./world/weather.js";
import { pruneEvents } from "./api/events.js";
import { approvePayment } from "./billing/payments.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

async function main(): Promise<void> {
  loadConfig();
  const cfg = config();
  const pool = createPool(cfg.databaseUrl);
  setRuntimePool(pool);

  // Postgres: retry every 2 seconds until it connects.
  for (;;) {
    try {
      await applySchema(pool);
      await seed(pool);
      break;
    } catch (err) {
      console.error("Database not ready:", err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  installRoutes(app, pool);

  // One error responder for everything, including the global handler.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    console.error("Unhandled request error:", err);
    const message = err instanceof Error && err.message === "PayloadTooLargeError" ? "The body is too large." : "Something went wrong.";
    sendError(res, apiError(500, "internal_error", message));
  });

  // The browser app: only built assets, never source or credentials.
  const publicDir = join(process.cwd(), "public");
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    const path = req.path;
    const blocked =
      path.startsWith("/src") ||
      path.endsWith(".map") ||
      path.startsWith("/.env") ||
      path.startsWith("/.git") ||
      path.startsWith("/node_modules") ||
      path === "/run.json" ||
      path.startsWith("/dist");
    if (blocked) {
      // Never served: the client router renders the not-found page.
      res.status(404).sendFile(join(publicDir, "index.html"));
      return;
    }
    const file = join(publicDir, path === "/" ? "index.html" : path);
    if (!existsSync(file) || !file.startsWith(publicDir)) {
      next();
      return;
    }
    res.sendFile(file);
  });

  // Every other GET renders the app; the client router shows the not-found screen
  // for unknown paths. API paths answer with the one error shape.
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith("/api/")) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.status(200).sendFile(join(publicDir, "index.html"));
  });

  // ---- Background loops ----
  // Kill Bill tenant and catalog, then provision each seeded server's records and approve
  // its first invoice; the state machine turns each server active once the balance is read back.
  void (async () => {
    for (;;) {
      try {
        const tenant = await kb.findTenant();
        const active = tenant ?? (await kb.createTenant());
        if (active !== null) {
          await kb.ensureCatalog();
          const servers = await pool.query<{ id: string; name: string; plan: "hamlet" | "borough"; killbill_account_id: string | null }>(
            "SELECT id, name, plan, killbill_account_id FROM servers"
          );
          for (const server of servers.rows) {
            if (server.killbill_account_id === null) {
              const client = await pool.connect();
              try {
                await client.query("BEGIN");
                await provisionSeededServer(client, server.id, server.name, server.plan);
                await client.query("COMMIT");
              } catch (err) {
                await client.query("ROLLBACK").catch(() => undefined);
                if (!(err instanceof kb.KillBillError)) throw err;
              } finally {
                client.release();
              }
            }
          }
          // Approve the first invoice of any pending server, whichever instance gets there first.
          const pending = await pool.query<{ id: string }>("SELECT id FROM servers WHERE status = 'pending_approval' AND killbill_account_id IS NOT NULL");
          for (const server of pending.rows) {
            await approvePayment(pool, server.id);
            await refreshBilling(pool, server.id);
          }
        }
        break;
      } catch (err) {
        if (!(err instanceof kb.KillBillError)) {
          console.error("Billing setup error:", err instanceof Error ? err.message : err);
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();

  // Re-read Kill Bill on every server at least every 10 seconds.
  setInterval(async () => {
    try {
      const servers = await pool.query<{ id: string }>("SELECT id FROM servers WHERE killbill_account_id IS NOT NULL");
      for (const server of servers.rows) {
        await refreshBilling(pool, server.id);
      }
    } catch {
      // the next tick retries
    }
  }, 10000);

  // The settler, at least every 5 seconds.
  setInterval(() => {
    void settlePendingPayments(pool).catch(() => undefined);
  }, 5000);

  // The suspension check, at least once a second.
  setInterval(async () => {
    try {
      const servers = await pool.query<{ id: string; status: string; suspends_at: Date | null }>(
        "SELECT id, status, suspends_at FROM servers WHERE suspends_at IS NOT NULL AND status <> 'suspended'"
      );
      for (const server of servers.rows) {
        if (server.suspends_at !== null && Date.now() >= server.suspends_at.getTime()) {
          await refreshBilling(pool, server.id);
          const after = await loadBillingRowById(pool, server.id);
          if (after !== null && after.status === "suspended") {
            await retryPendingResults(pool);
          }
        }
      }
    } catch {
      // the next tick retries
    }
  }, 1000);

  // The turn clock, at least once a second.
  setInterval(() => {
    void scanDeadlines(pool).catch(() => undefined);
  }, 1000);

  // Held mail, result bundles and checkpoints, at least every 10 seconds.
  setInterval(() => {
    void retryHeldMail(pool).catch(() => undefined);
  }, 10000);
  setInterval(() => {
    void retryPendingResults(pool).catch(() => undefined);
  }, 10000);
  setInterval(() => {
    void retryCheckpoints(pool).catch(() => undefined);
  }, 10000);
  // Weather pushes, once a second is more than enough for the period bounds.
  setInterval(() => {
    void scanWeather(pool).catch(() => undefined);
  }, 2000);

  // Prune the 30 minutes of event history.
  setInterval(() => {
    void pruneEvents(pool).catch(() => undefined);
  }, 60000);

  const port = cfg.port;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Plotwright listening on 0.0.0.0:${port}`);
  });
}

void main;
main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
