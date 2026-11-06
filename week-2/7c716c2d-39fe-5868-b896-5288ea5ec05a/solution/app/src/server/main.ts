// Boot: serve at once (health answers whatever is down), then bring each dependency up in the
// background, retrying until it answers. No dependency failure ends the process.
import http from "node:http";
import { config } from "./config.js";
import { bootQuery, markSchemaReady, pool } from "./db.js";
import { pruneEvents, streamTick } from "./events.js";
import { handleApi } from "./http.js";
import { route } from "./router.js";
import { loadCalendar } from "./calendar.js";
import { recordFinishedCycles } from "./cycles.js";
import { drainObjectDeletions } from "./attachments.js";
import { digestTick } from "./digest.js";
import { startSender } from "./outbox.js";
import { presenceSweep } from "./presence.js";
import { expireKnocks } from "./rooms.js";
import { ensureBucket } from "./s3.js";
import { SCHEMA } from "./schema.js";
import { registerBilling } from "./seats.js";
import { seedIfEmpty } from "./seed.js";
import { serveStatic } from "./static.js";
import { checkServices } from "./status.js";
import { query, tx } from "./db.js";
import "./chat.js";
import "./docs.js";
import "./invites.js";
import "./issues.js";
import "./people.js";
import "./workspace.js";

route("GET", "/api/health", { access: "public" }, async () => ({ status: 200, body: { status: "ok" } }));

const server = http.createServer((req, res) => {
  const url = URL.parse(req.url ?? "/", "http://app.invalid");
  if (!url) {
    res.writeHead(404).end();
    return;
  }
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) void handleApi(req, res, url);
  else void serveStatic(req, res, url);
});
server.keepAliveTimeout = 5000;
server.listen(config.port, "0.0.0.0", () => console.log(`Tallyroom serving on 0.0.0.0:${config.port}`));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `step` until it succeeds, waiting `ms` between attempts. */
async function retry(name: string, ms: number, step: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await step();
      return;
    } catch (error) {
      console.log(`${name} not ready: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(ms);
    }
  }
}

/** Runs `task` every `ms`, never overlapping itself; failures wait for the next round. */
function every(ms: number, task: () => Promise<void>): void {
  const loop = async (): Promise<void> => {
    try {
      await task();
    } catch {
      // a dependency is down; the next round tries again
    }
    setTimeout(() => void loop(), ms);
  };
  void loop();
}

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7342001)");
    try {
      await client.query(SCHEMA);
      await client.query("BEGIN");
      await seedIfEmpty(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.query("SELECT pg_advisory_unlock(7342001)");
    }
  } finally {
    client.release();
  }
}

async function recordCycles(): Promise<void> {
  for (const { id } of await query<{ id: string }>("SELECT id FROM workspaces")) {
    await tx(async (db) => recordFinishedCycles(db, id, await loadCalendar(db, id)));
  }
}

every(3000, checkServices);
void retry("storage bucket", 3000, ensureBucket);
void (async () => {
  await retry("database", 2000, async () => {
    await bootQuery("SELECT 1");
    await migrate();
  });
  markSchemaReady();
  startSender();
  every(250, presenceSweep);
  every(500, expireKnocks);
  every(1000, streamTick);
  every(10_000, recordCycles);
  every(20_000, digestTick);
  every(30_000, pruneEvents);
  every(Math.min(config.timers.outboxRetry, 10) * 1000, drainObjectDeletions);
  await retry("billing", 5000, registerBilling);
})();
