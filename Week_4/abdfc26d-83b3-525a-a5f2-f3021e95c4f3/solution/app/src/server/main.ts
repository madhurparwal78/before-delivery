import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { authRoutes } from "./auth.js";
import { billingRoutes, pollKillBill } from "./billing.js";
import { config } from "./config.js";
import { pool, tx } from "./db.js";
import { compile, json, makeDispatcher, type Route } from "./http.js";
import { retryPendingDocuments } from "./invoices.js";
import * as killbill from "./killbill.js";
import { orderRoutes, sweepHolds } from "./orders.js";
import { sendDue } from "./outbox.js";
import { pieceRoutes } from "./pieces.js";
import { startConsumer } from "./queue.js";
import { adminOrderRoutes } from "./refunds.js";
import { processJob, renderRoutes, republishQueued } from "./renders.js";
import { migrate } from "./schema.js";
import { applySeed, ensureIdentities, ensureSeedObjects } from "./seed.js";
import { adminRoutes, mailReachable, probeAll } from "./services.js";
import { retryPendingStatements, statementRoutes } from "./statements.js";

let ready = false;

const health: Route = { method: "GET", pattern: "/api/health", handler: async () => (ready ? json(200, { status: "ok" }) : json(503, { status: "starting" })) };

const routes = compile([health, ...authRoutes, ...pieceRoutes, ...renderRoutes, ...orderRoutes, ...billingRoutes, ...adminOrderRoutes, ...statementRoutes, ...adminRoutes]);

/** Runs `work` every `seconds`, never overlapping itself, logging and surviving its failures. */
function every(seconds: number, name: string, work: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await work();
    } catch (error) {
      console.error(`${name}:`, error instanceof Error ? error.message : error);
    }
    setTimeout(() => void run(), seconds * 1000);
  };
  void run();
}

/** Retries `work` every `seconds` until it succeeds. */
async function untilDone<T>(name: string, work: () => Promise<T>, seconds = 2): Promise<T> {
  for (;;) {
    try {
      return await work();
    } catch (error) {
      console.error(`${name} (retrying):`, error instanceof Error ? error.message : error);
      await sleep(seconds * 1000);
    }
  }
}

async function start(): Promise<void> {
  const server = http.createServer(makeDispatcher(routes, () => ready));
  server.listen(config.port, "0.0.0.0", () => console.log(`Phosphene Yard listening on 0.0.0.0:${config.port}`));

  await untilDone("schema", () =>
    tx(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('phosphene-yard schema'))");
      await migrate(client);
    }),
  );
  const ids = await untilDone("keycloak identities", ensureIdentities);
  await untilDone("seed", () => applySeed(ids));
  ready = true;
  console.log("schema and seed in place");

  every(10, "service checks", probeAll);
  every(1, "hold expiry", () => sweepHolds(pool));
  every(2, "Kill Bill confirmation poll", pollKillBill);
  every(5, "outbox", async () => (mailReachable() ? sendDue() : undefined));
  every(30, "document rendering retry", async () => {
    await retryPendingDocuments();
    await retryPendingStatements();
  });
  every(10, "render queue republish", republishQueued);
  startConsumer(processJob);

  void untilDone("Kill Bill tenant setup", async () => {
    await killbill.ensureCatalog();
    await killbill.registerCallback();
  }, 15);
  void (async () => {
    while (!(await ensureSeedObjects())) await sleep(10_000);
  })();
}

void start();
