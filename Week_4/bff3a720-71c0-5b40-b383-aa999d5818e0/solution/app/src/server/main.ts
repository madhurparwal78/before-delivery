import http from "node:http";
import { config } from "./config";
import { syncClock } from "./clock";
import { pool, transaction } from "./db";
import { apiErrors, respondError } from "./http/errors";
import { readSession } from "./http/pipeline";
import { routes } from "./routes";
import { SECURITY_HEADERS, serveStatic } from "./http/static";
import { applySchema } from "./schema";
import { memberBySession } from "./services/auth";
import { healthStatus } from "./services/health";
import { startSweeper, runDueJobs } from "./services/jobs";
import { openStream, startFanOut } from "./services/live";
import { seedDemoNetwork } from "./services/seed";
import { subscriber, valkey } from "./valkey";

const BOOT_ATTEMPTS = 60;
const SCHEMA_LOCK = 7_301_001;

async function untilReachable(name: string, probe: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt += 1) {
    try {
      await probe();
      return;
    } catch {
      if (attempt === BOOT_ATTEMPTS) throw new Error(`${name} is unreachable`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** An id that does not decode, or holds a NUL byte (which PostgreSQL refuses), names no record. */
function pathParams(names: string[], match: RegExpExecArray): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    try {
      params[name] = decodeURIComponent(match[index + 1] as string);
    } catch {
      return null;
    }
    if (params[name]?.includes("\u0000")) return null;
  }
  return params;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://placeholder");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  if (url.pathname === "/health") {
    const body = JSON.stringify({ status: await healthStatus() });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
    res.end(body);
    return;
  }
  if (url.pathname === "/api/live" && req.method === "GET") {
    await syncClock(pool);
    const token = readSession(req);
    const member = token ? await memberBySession(pool, token) : undefined;
    const from = Number(url.searchParams.get("from"));
    openStream(req, res, member?.id ?? null, url.searchParams.get("ride"), url.searchParams.get("thread"), Number.isFinite(from) && from > 0 ? from : null);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    for (const candidate of routes) {
      if (candidate.method !== req.method) continue;
      const match = candidate.pattern.exec(url.pathname);
      if (!match) continue;
      const params = pathParams(candidate.names, match);
      if (!params) {
        respondError(res, apiErrors.notFound());
        return;
      }
      await candidate.handle(req, res, params);
      return;
    }
    respondError(res, apiErrors.notFound());
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    respondError(res, apiErrors.notFound());
    return;
  }
  serveStatic(req, res, url.pathname);
}

async function main(): Promise<void> {
  await untilReachable("PostgreSQL", () => pool.query("SELECT 1"));
  await untilReachable("Valkey", async () => {
    if (valkey.status === "wait") await valkey.connect();
    await valkey.ping();
  });
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    await applySchema(db);
    await syncClock(db);
    await seedDemoNetwork(db);
  });
  await subscriber.connect();
  await startFanOut();
  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) respondError(res, apiErrors.internal());
      else res.end();
    });
  });
  server.keepAliveTimeout = 65_000;
  server.listen(config.port, "0.0.0.0", () => {
    startSweeper();
    void runDueJobs();
  });
  const stop = (): void => {
    server.close();
    void pool.end().finally(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((error: unknown) => {
  console.error(`startup failed: ${error instanceof Error ? error.name : "unknown error"}`);
  process.exit(1);
});
