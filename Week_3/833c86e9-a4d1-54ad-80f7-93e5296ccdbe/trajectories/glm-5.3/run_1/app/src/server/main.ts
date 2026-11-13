import http from "node:http";
import { applySchema, insertBaseSeed } from "./db.js";
import { clock } from "./clock.js";
import { hub } from "./events.js";
import * as api from "./api.js";
import * as images from "./images.js";
import { loadContext, cookieHeader, type Ctx } from "./context.js";
import * as fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cfg, db, s3, storageAvailable, setStorageDown, markStorage } from "./runtime.js";
export { cfg, db, s3, storageAvailable, setStorageDown, markStorage };

let dbReady = false;

export async function run(): Promise<void> {
  const server = http.createServer(handle);
  server.listen(cfg.port, "0.0.0.0", () => {
    console.log(`kipwell serving on 0.0.0.0:${cfg.port}`);
  });
  // Retry Postgres until reachable; apply schema and base seed when we get there.
  const connectDb = async (): Promise<void> => {
    try {
      await db.query("SELECT 1");
      dbReady = true;
      clock.attachDb(db);
      await applySchema(db);
      await insertBaseSeed(db);
      await startStorageTasks();
    } catch (e) {
      console.error("db connect/seed failed, retrying", e instanceof Error ? e.message : e);
      setTimeout(connectDb, 1000);
    }
  };
  void connectDb();
  const heartbeat = setInterval(() => {
    for (const res of hubClients()) hub.sendComment(res);
  }, cfg.sseHeartbeatMs);
  heartbeat.unref?.();
  // 60-second clock tick.
  const tick = setInterval(() => {
    hub.broadcastClock(clock.now().toISOString());
  }, 60000);
  tick.unref?.();
}

function hubClients(): http.ServerResponse[] {
  return hub.responses();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readAsset(name: string): Buffer | null {
  for (const candidate of [path.join(__dirname, "public", name), path.join(process.cwd(), "public", name), path.join(process.cwd(), "dist", "public", name)]) {
    try { return fsSync.readFileSync(candidate); } catch { /* try next */ }
  }
  return null;
}

function readStatic(pathname: string): { body: Buffer; contentType: string } | null {
  if (pathname === "/client.js") {
    const buf = readAsset("../client.js");
    return buf ? { body: buf, contentType: "text/javascript; charset=utf-8" } : null;
  }
  if (pathname.startsWith("/fonts/")) {
    const buf = readAsset(pathname.slice(1));
    return buf ? { body: buf, contentType: pathname.endsWith(".ttf") ? "font/ttf" : "application/octet-stream" } : null;
  }
  if (pathname.startsWith("/css/")) {
    const buf = readAsset(pathname.slice(1));
    return buf ? { body: buf, contentType: "text/css; charset=utf-8" } : null;
  }
  return null;
}

const BLOCKED = new Set(["run.json", "package.json", "package-lock.json", "tsconfig.json", "build.mjs", ".env", ".env.local", "THIRD_PARTY_NOTICES.md"]);

export function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  void (async () => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);
    try {
      // Same-origin writes only.
      const origin = req.headers.origin;
      if (origin) {
        const host = req.headers.host ?? "";
        const o = new URL(origin);
        if (o.host !== host) {
          return sendJson(res, 403, { error: "cross_origin" });
        }
      }
      // Never serve source, manifest, lockfiles or credentials.
      const base = path.posix.basename(pathname);
      const isBlockedFile = BLOCKED.has(base) || pathname.startsWith("/src/") || pathname.startsWith("/node_modules/") || pathname.endsWith(".ts") || pathname.endsWith(".mjs");
      if (isBlockedFile) return sendNotFound(res, pathname);
      if (pathname === "/api/health") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (!dbReady) { res.statusCode = 503; return res.end(JSON.stringify({ status: "starting" })); }
        const ok = await checkStorage();
        return res.end(JSON.stringify({ status: ok ? "ok" : "unavailable" }));
      }
      // Static assets are served whether or not Postgres is reachable yet.
      const staticAsset = readStatic(pathname);
      if (staticAsset) {
        res.writeHead(200, { "Content-Type": staticAsset.contentType, "Cache-Control": "public, max-age=3600" });
        return res.end(staticAsset.body);
      }
      if (!dbReady) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (pathname.startsWith("/api/")) { res.statusCode = 503; return res.end(JSON.stringify({ status: "starting" })); }
        // serve the app shell; API calls will retry once ready
        return serveShell(res);
      }
      let ctx: Ctx | null = null;
      try { ctx = await loadContext(db, req.headers.cookie); } catch { return sendJson(res, 503, { status: "starting" }); }

      if (pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        hub.add(res, ctx.visitorId, ctx.username);
        // send current clock and pending state of this context's holds and quotes
        res.write(`event: clock\ndata: ${JSON.stringify({ now: clock.now().toISOString() })}\n\n`);
        await api.sendContextState(res, ctx);
        return;
      }
      if (pathname.startsWith("/api/")) {
        setCookies(res, ctx);
        const result = await api.route(req, res, pathname, url, ctx, () => setCookies(res, ctx));
        if (result === "handled") return;
        if (result && typeof result === "object" && "status" in result) {
          return sendJson(res, result.status, result.body as Record<string, unknown>, result.headers);
        }
        return sendJson(res, 404, { error: "not_found" });
      }
      if (pathname.startsWith("/images/") && pathname.endsWith(".svg")) {
        const buf = readAsset(pathname.slice(1));
        if (buf) { res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" }); return res.end(buf); }
      }
      if (pathname.startsWith("/images/")) {
        const m = /^\/images\/([A-Za-z0-9-]+)\/(\d+)\.svg$/.exec(pathname);
        if (!m) return sendNotFound(res, pathname);
        const img = await images.serveImage(m[1], Number(m[2]));
        if (img === null) return sendJson(res, 404, { error: "not_found" });
        if (img === "unavailable") return sendJson(res, 503, { error: "storage_unavailable" });
        res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" });
        return res.end(img);
      }
      // invoice route serves stored HTML
      if (/^\/bookings\/[A-Za-z0-9-]+\/invoice$/.test(pathname)) {
        const code = pathname.split("/")[2];
        const html = await api.serveInvoice(code);
        if (html === "unavailable") {
          res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(api.storageDocPage(ctx.lang));
        }
        if (html === null) return sendNotFoundPage(res);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(html);
      }
      // app pages
      const known = await api.pageKnown(pathname);
      setCookies(res, ctx);
      if (known) return serveShell(res);
      return sendNotFoundPage(res);
    } catch (e) {
      console.error("request error", pathname, e);
      if (!res.headersSent) return sendJson(res, 500, { error: "internal" });
      try { res.end(); } catch { /* already gone */ }
    }
  })();
}

async function checkStorage(): Promise<boolean> {
  if (!storageAvailable()) return false;
  try {
    await s3.get("__health__");
    markStorage(true);
    return true;
  } catch {
    markStorage(false);
    return false;
  }
}

let storageStarted = false;
async function startStorageTasks(): Promise<void> {
  if (storageStarted) return;
  storageStarted = true;
  try { await s3.ensureBucket(); markStorage(true); } catch { markStorage(false); }
  const retry = async (): Promise<void> => {
    if (!storageAvailable()) {
      try {
        await s3.ensureBucket();
        markStorage(true);
        await images.ensurePropertyImages();
      } catch {
        setTimeout(retry, 5000);
        return;
      }
    }
    setTimeout(retry, 5000);
  };
  void retry();
  const ensureImages = async (): Promise<void> => {
    try { await images.ensurePropertyImages(); } catch { /* retried by the loop */ }
  };
  void ensureImages();
}

function setCookies(res: http.ServerResponse, ctx: Ctx): void {
  const cookies = cookieHeader(ctx);
  if (cookies.length === 0) return;
  const existing = res.getHeader("Set-Cookie");
  const all = (Array.isArray(existing) ? existing.map(String) : existing ? [String(existing)] : []).concat(cookies);
  res.setHeader("Set-Cookie", all);
}

function sendJson(res: http.ServerResponse, status: number, body: Record<string, unknown>, headers?: Record<string, string>): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(headers ?? {})
  });
  res.end(data);
}

function sendNotFound(res: http.ServerResponse, pathname: string): void {
  sendJson(res, 404, { error: "not_found" });
}

function serveShell(res: http.ServerResponse): void {
  const buf = readAsset("index.html");
  if (buf) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(buf); return; }
  res.writeHead(500, { "Content-Type": "text/plain" });
  res.end("missing shell");
}

function sendNotFoundPage(res: http.ServerResponse): void {
  const buf = readAsset("index.html");
  if (buf) { res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(buf); return; }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

void run();
