// Boot: schema and seed, dependency probes, the HTTP server and background loops.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { Pool } from "./db.js";
import { Storage } from "./storage.js";
import { KillBill } from "./killbill.js";
import { Outbound } from "./outbound.js";
import { Mailer } from "./mailer.js";
import { applySchemaAndSeed } from "./schema.js";
import { createState, handleApi, topupDeps, retryPendingTopUps, maybeSoftCapEmail, type AppState } from "./api.js";
import { deliverPending, onJobFinal as recordJobEvent } from "./webhooks.js";
import { Dispatcher } from "./dispatch.js";
import { sweepExpiry } from "./assets.js";

const here = dirname(fileURLToPath(import.meta.url));
const BROWSER_DIR = resolve(here, "../browser");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = new Pool(cfg.databaseUrl);
  await applySchemaAndSeed(pool);

  const storage = new Storage(cfg.s3);
  try {
    await storage.ensureBucket();
  } catch {
    // The health loop reports the outage; the app still starts.
  }
  const killbill = new KillBill(cfg.killbill);
  const outbound = new Outbound(cfg.outboundAllowedHosts);
  const mailer = new Mailer(cfg.smtp);
  const state: AppState = createState(pool, cfg, storage, killbill, outbound, mailer);

  // Dependency probes.
  async function probeStorage(): Promise<boolean> {
    try {
      await storage.get("__probe__");
      return true; // 404 means the bucket answered; a network error throws
    } catch (e) {
      return e instanceof Error && (e as { statusCode?: number }).statusCode === 404;
    }
  }
  async function probeBilling(): Promise<boolean> {
    try {
      const auth = Buffer.from(`${cfg.killbill.username}:${cfg.killbill.password}`).toString("base64");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${cfg.killbill.url}/1.0/kb/accounts?externalKey=__probe__`, {
        headers: {
          Authorization: `Basic ${auth}`,
          "X-Killbill-ApiKey": cfg.killbill.apiKey,
          "X-Killbill-ApiSecret": cfg.killbill.apiSecret,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async function healthLoop(): Promise<void> {
    const [storageUp, billingUp] = await Promise.all([probeStorage(), probeBilling()]);
    const now = new Date();
    const before = state.storageState.up;
    state.storageState = { up: storageUp, checkedAt: now };
    state.billingState = { up: billingUp, checkedAt: now };
    if (before && !storageUp) {
      // Jobs queue with a waiting reason; the dispatcher leases nothing.
    }
  }
  await healthLoop();
  setInterval(() => void healthLoop(), 10_000);

  // Soft cap emails on settle.
  const dispatcher = new Dispatcher(pool, cfg, {
    storage,
    storageUp: () => Promise.resolve(state.storageState.up),
    onJobFinal: async (jobId) => {
      await recordJobEvent(pool, jobId);
      const job = await pool.one<{ team_id: string }>(`SELECT team_id FROM jobs WHERE id = $1`, [jobId]);
      if (job) await maybeSoftCapEmail(state, job.team_id);
    },
  });
  dispatcher.start();

  // Webhook delivery loop.
  async function onEndpointDisabled(endpoint: { team_id: string; url: string }, lastStatusCode: number | null): Promise<void> {
    const team = await pool.one<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [endpoint.team_id]);
    const admins = await pool.many<{ email: string }>(`SELECT email FROM members WHERE role = 'admin'`);
    for (const a of admins) {
      mailer.send(
        a.email,
        `Webhook endpoint disabled: ${team?.name ?? endpoint.team_id}`,
        `The webhook endpoint ${endpoint.url} for ${team?.name ?? endpoint.team_id} was disabled after repeated failures.\n\nLast status code: ${lastStatusCode ?? "no answer"}\n`,
      );
    }
  }
  setInterval(() => {
    void deliverPending(pool, outbound, cfg, onEndpointDisabled).catch(() => undefined);
  }, 1_000);

  // Pending top-ups retry every 15 seconds.
  setInterval(() => {
    void retryPendingTopUps(pool, topupDeps(state)).catch(() => undefined);
  }, 15_000);

  // Retention sweeper: expired assets lose their objects within 15 seconds.
  setInterval(() => {
    void sweepExpiry(pool, { storage, outbound, storageUp: () => Promise.resolve(state.storageState.up) }).catch(() => undefined);
  }, 5_000);

  // Idempotency keys are kept 24 hours from first use.
  setInterval(() => {
    void pool.exec(`DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'`).catch(() => undefined);
  }, 60_000);

  const server = createServer((req, res) => {
    void handle(state, req, res);
  });
  const port = cfg.publicPort;
  server.listen(port, "0.0.0.0", () => {
    console.log(`lumenfold dispatch listening on 0.0.0.0:${port}`);
  });

  async function handle(state: AppState, req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith("/api/") || pathname === "/api") {
        const handled = await handleApi(state, req, res, pathname, url.searchParams);
        if (!handled) {
          res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: { code: "not_found", message: "That endpoint does not exist." } }));
        }
        return;
      }
      serveStatic(pathname, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      }
      res.end(JSON.stringify({ error: { code: "internal_error", message: "Something went wrong." } }));
    }
  }

  function serveStatic(pathname: string, res: ServerResponse): void {
    // Only built browser assets; never source, manifests, env files or dependencies.
    const safe = pathname.replace(/^\/+/, "");
    const target = resolve(BROWSER_DIR, safe === "" ? "index.html" : safe);
    if (!target.startsWith(BROWSER_DIR)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    let file = target;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // Navigation paths answer with the app shell; file-like paths 404.
      if (/\.[a-zA-Z0-9]+$/.test(safe)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      file = join(BROWSER_DIR, "index.html");
    }
    if (!existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = extname(file);
    const mime = MIME[ext] ?? "application/octet-stream";
    let body: Buffer;
    try {
      body = readFileSync(file);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mime, "Content-Length": body.byteLength, "Cache-Control": "no-store" });
    res.end(body);
  }
}

void main();
