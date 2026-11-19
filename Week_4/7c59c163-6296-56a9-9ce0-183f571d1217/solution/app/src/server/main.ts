import http from "node:http";
import { pipeline } from "./auth.js";
import { pollOverdue } from "./billing.js";
import { config } from "./config.js";
import { compile, makeDispatcher, serveStatic } from "./http.js";
import { ensureCatalog, ensureOverdueConfig } from "./killbill.js";
import { sweepMarkets } from "./markets.js";
import { drainOutbox } from "./outbox.js";
import { builderRoutes } from "./routes/builder.js";
import { depositRoutes } from "./routes/deposits.js";
import { marketRoutes } from "./routes/markets.js";
import { orderRoutes } from "./routes/orders.js";
import { platformRoutes } from "./routes/platform.js";
import { sessionRoutes } from "./routes/session.js";
import { venueRoutes } from "./routes/venue.js";
import { applySchema } from "./schema.js";
import { bootstrapKeycloak, seed } from "./seed.js";
import { statementTick } from "./statements.js";
import { withSharedLock } from "./valkey.js";

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Startup tasks, applied idempotently on every serve. Each is tried once before the listener opens;
 * a task whose provider is unreachable is retried every 10 seconds while the server runs.
 */
const STARTUP: { name: string; run: () => Promise<void> }[] = [
  { name: "schema", run: applySchema },
  { name: "keycloak roles and groups", run: bootstrapKeycloak },
  { name: "kill bill catalog and overdue", run: () => withSharedLock("killbill-config", async () => {
    await ensureCatalog();
    await ensureOverdueConfig();
  }) },
  { name: "seed", run: seed },
];

async function runStartup(pending: typeof STARTUP): Promise<typeof STARTUP> {
  const failed: typeof STARTUP = [];
  for (const task of pending) {
    if (failed.some((f) => f.name === "schema")) {
      failed.push(task);
      continue;
    }
    try {
      await task.run();
    } catch (error) {
      console.error(`startup: ${task.name} failed, retrying in 10 s: ${describe(error)}`);
      failed.push(task);
    }
  }
  return failed;
}

function every(seconds: number, name: string, work: () => Promise<void>): void {
  const loop = () => {
    work()
      .catch((error: unknown) => console.error(`${name}: ${describe(error)}`))
      .finally(() => setTimeout(loop, seconds * 1000));
  };
  setTimeout(loop, seconds * 1000);
}

async function main(): Promise<void> {
  let pending = await runStartup(STARTUP);
  const retry = async () => {
    if (pending.length > 0) pending = await runStartup(pending);
  };
  every(10, "startup retry", retry);

  const routes = compile([...platformRoutes, ...sessionRoutes, ...marketRoutes, ...orderRoutes, ...depositRoutes, ...builderRoutes, ...venueRoutes]);
  const server = http.createServer(makeDispatcher(routes, pipeline, serveStatic));
  server.keepAliveTimeout = 65_000;
  server.listen(config.port, "0.0.0.0", () => console.log(`Plumtide Venue serving on 0.0.0.0:${config.port}`));

  every(1, "outbox", drainOutbox);
  every(0.5, "market timers", sweepMarkets);
  every(config.overduePollSeconds, "overdue checks", pollOverdue);
  every(60, "statements", statementTick);
}

void main();
