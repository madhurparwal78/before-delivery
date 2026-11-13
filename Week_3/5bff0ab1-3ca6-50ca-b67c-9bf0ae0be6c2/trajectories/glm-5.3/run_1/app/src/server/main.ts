// The main server: HTTP service, pages, the live stream, static assets.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { config } from "./config";
import { handleApi } from "./api";
import { applySchema, pool, n } from "./db";
import * as ledger from "./ledger";
import { startSweep } from "./sweep";

import {
  appNowMs} from "./clock";
import * as store from "./store";
import { renderPage } from "./pages";
import {} from "./clock";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"};

// ---------- the live stream ----------
// An open stream holds no Postgres or Valkey connection of its own. Every copy keeps
// its one subscription whatever the number of open streams.

interface StreamClient {
  res: http.ServerResponse;
  hub: string;
  model: string;
  finish: string;
  riderId: string | null;
  sessionToken: string | null;
}

const streams = new Set<StreamClient>();

function writeEvent(res: http.ServerResponse, event: string, data: string): void {
  res.write(`event: ${event}\ndata: ${data}\n\n`);
}

async function pushReading(client: StreamClient): Promise<void> {
  try {
    const caller = client.riderId ? { id: client.riderId, role: "rider" } : null;
    const reading = await store.liveReading(client.hub, client.model, client.finish, caller);
    writeEvent(client.res, "live", JSON.stringify(reading));
  } catch {
    // the next fan-out or sweep retries
  }
}

async function pushMine(client: StreamClient): Promise<void> {
  writeEvent(client.res, "mine", "{}");
}

function startPingTimer(client: StreamClient): void {
  // It sends event ping with body {} at least every 15 seconds.
  const timer = setInterval(() => {
    try {
      writeEvent(client.res, "ping", "{}");
    } catch {
      cleanup();
    }
  }, 15000);
  // A session that ends on the app clock reaches this connection as a session event.
  const sessionTimer = setInterval(() => {
    if (client.sessionToken === null) return;
    void (async () => {
      try {
        const r = await pool.query(
          `SELECT started_at_ms, ended FROM sessions WHERE token = $1`,
          [client.sessionToken]
        );
        if (!r.rowCount) return;
        const row = r.rows[0] as { started_at_ms: number; ended: boolean };
        if (row.ended || appNowMs() - n(row.started_at_ms) >= 12 * 3600000) {
          writeEvent(client.res, "session", JSON.stringify({ state: "ended" }));
          client.riderId = null;
        }
      } catch {
        // the next tick retries
      }
    })();
  }, 2000);
  const cleanup = () => {
    clearInterval(timer);
    clearInterval(sessionTimer);
    streams.delete(client);
  };
  client.res.on("close", cleanup);
}

async function handleStream(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"});
  res.write(":ok\n\n");
  const cookie = String(req.headers.cookie ?? "");
  const token = /(?:^|;\s*)mkos=([^;]+)/.exec(cookie)?.[1] ?? null;
  let riderId: string | null = null;
  if (token) {
    const r = await pool.query(
      `SELECT s.started_at_ms, s.ended, u.id, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
      [token]
    );
    if (r.rowCount) {
      const row = r.rows[0] as { started_at_ms: number; ended: boolean; id: string; role: string };
      if (row.role === "rider" && !row.ended && appNowMs() - n(row.started_at_ms) < 12 * 3600000) {
        riderId = row.id;
      }
    }
  }
  const hub = url.searchParams.get("hub") ?? "pune";
  const model = url.searchParams.get("model") ?? "megh-349";
  const finish = url.searchParams.get("finish") ?? "monsoon-slate";
  const client: StreamClient = { res, hub, model, finish, riderId, sessionToken: token };
  streams.add(client);
  startPingTimer(client);
  await pushReading(client);
}

// A hub hint makes every open stream on that hub re-read.
export function hintHub(hub: string): void {
  for (const client of streams) {
    if (client.hub === hub) {
      void pushReading(client);
    }
  }
}

// A rider hint makes the rider's streams re-read.
export function hintRider(riderId: string): void {
  for (const client of streams) {
    if (client.riderId === riderId) {
      void pushMine(client);
    }
  }
}

// Whole IST hours while the rider holds a lock: a sweep-level timer.
function startHourlyRiderFanout(): void {
  setInterval(() => {
    for (const client of streams) {
      if (client.riderId !== null) {
        void pushMine(client);
      }
    }
  }, 60000).unref?.();
}

// ---------- static ----------

const PUBLIC_DIR = join(process.cwd(), "public");

function serveStatic(res: http.ServerResponse, path: string): boolean {
  const clean = path.replace(/^\/+/, "");
  const full = join(PUBLIC_DIR, clean);
  if (!full.startsWith(PUBLIC_DIR)) return false;
  if (!existsSync(full)) return false;
  const data = readFileSync(full);
  res.writeHead(200, {
    "Content-Type": MIME[extname(full)] ?? "application/octet-stream",
    "Content-Length": data.length,
    "Cache-Control": "public, max-age=3600"});
  res.end(data);
  return true;
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  try {
    if (path === "/api/live" && req.method === "GET") {
      await handleStream(req, res, url);
      return;
    }
    if (await handleApi(req, res)) return;

    // pages
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    if (path.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: "We couldn't find that page." } }));
      return;
    }
    if (path === "/" || path === "/showroom" || path === "/test-ride" || path === "/garage" || path === "/hub") {
      const html = renderPage(path);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
      return;
    }
    if (serveStatic(res, path)) return;
    if (path === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    // The server never serves source files, environment files or credentials.
    if (path === "/.env" || path === "/package.json" || path.startsWith("/src/") || path.startsWith("/dist/") || path === "/run.json" || path === "/tsconfig.json") {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderPage("/404"));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderPage("/404"));
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "database_unreachable", message: "The database is unreachable right now. Try again in a moment." } }));
    } else {
      res.end();
    }
  }
});

async function boot(): Promise<void> {
  // A provider down at boot does not stop the server.
  const dbReady = applySchema().then(() => true).catch(() => false);
  const ledgerReady = ledger.ledgerConnect().then(() => true).catch(() => false);
  await dbReady;
  await ledgerReady;
  // Both stores are up: rebuild any ledger keys this database already holds.
  const { rebuildLedgerFromPostgres } = await import("./api");
  await rebuildLedgerFromPostgres().catch(() => {});
  if (!(await ledgerReady)) {
    const retry = setInterval(() => {
      void ledger.ledgerConnect().then(async () => {
        clearInterval(retry);
        await rebuildLedgerFromPostgres().catch(() => {});
      }).catch(() => {});
    }, 2000);
    retry.unref?.();
  }

  server.listen(config.port, "0.0.0.0", () => {
    process.stdout.write(`malhar key-on on ${config.port}\n`);
  });

  // fan-out subscription: one subscription per copy
  void ledger.ledgerConnect().then(async () => {
    await ledger.subscribeLive(
      (hub) => hintHub(hub),
      (riderId) => hintRider(riderId)
    );
  }).catch(() => {
    const retry = setInterval(() => {
      void ledger.ledgerConnect().then(async () => {
        await ledger.subscribeLive((hub) => hintHub(hub), (riderId) => hintRider(riderId));
        clearInterval(retry);
      }).catch(() => {});
    }, 3000);
    retry.unref?.();
  });

  startSweep();
  startHourlyRiderFanout();

  // the app clock is persisted, so every copy agrees: restore the bias and honour a freeze
  const [biasRow, freezeRow] = await Promise.all([
    pool.query(`SELECT value FROM app_state WHERE key = 'clock_bias_ms'`).catch(() => null),
    pool.query(`SELECT value FROM app_state WHERE key = 'clock_frozen_ms'`).catch(() => null),
  ]);
  const { setAppClock, unfreezeAppClock, readSharedFreeze } = await import("./clock");
  if (biasRow && biasRow.rowCount) {
    const bias = Number((biasRow.rows[0] as { value: string }).value);
    setAppClock(Date.now() + bias, false);
    unfreezeAppClock();
    process.stdout.write(`app clock restored: ${new Date(appNowMs()).toISOString()}\n`);
  } else {
    process.stdout.write("app clock: no stored bias, using seed start\n");
  }
  if (freezeRow && freezeRow.rowCount) {
    // a freeze set through the other copy holds here too
    await readSharedFreeze(pool.query.bind(pool));
    process.stdout.write(`app clock frozen at: ${new Date(appNowMs()).toISOString()}\n`);
  }
}

void boot();
