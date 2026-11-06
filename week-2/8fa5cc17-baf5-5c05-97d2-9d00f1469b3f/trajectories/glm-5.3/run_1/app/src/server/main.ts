// The HTTP server: routing, static assets, the share surface, the live sync
// channel and the database bootstrap.

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, applySchema, seedIfEmpty } from "./db.js";
import { Ctx, readConfig } from "./context.js";
import { S3 } from "./s3.js";
import { LiveSync, serveEvents } from "./sync.js";
import { handleApi } from "./api.js";
import { HttpError } from "./api-utils.js";
import { shareSurface, startShareCacheSweep } from "./surface.js";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

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
  const config = readConfig();
  const pool = createPool(config.databaseUrl);
  const s3 = new S3(config.s3);
  const ctx = new Ctx(pool, s3, config);
  const sync = new LiveSync(ctx);
  sync.startPruner();
  sync.startPoller();
  startShareCacheSweep(ctx);

  // retry the database every two seconds until it is ready
  const ready = async (): Promise<boolean> => {
    try {
      await applySchema(pool);
      await seedIfEmpty(pool);
      await ctx.reloadSettings();
      return true;
    } catch {
      return false;
    }
  };
  let dbReady = false;
  const boot = async (): Promise<void> => {
    dbReady = await ready();
    if (!dbReady) setTimeout(boot, 2000);
    else {
      ctx.dbReady = true;
    }
  };
  await boot();

  // keep the settings fresh
  setInterval(() => {
    ctx.reloadSettings().catch(() => undefined);
  }, 5000).unref();

  const server = http.createServer((req, res) => {
    handleRequest(ctx, sync, req, res).catch((e: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      try {
        res.end(JSON.stringify({ error: "internal" }));
      } catch {
        // socket gone
      }
      if (e instanceof Error && e.name !== "HttpError") {
        console.error(`request error ${req.method ?? "GET"} ${req.url ?? "/"}: ${e.message}\n${e.stack ?? ""}`);
      }
    });
  });

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`quire listening on 0.0.0.0:${config.port}`);
  });

  async function handleRequest(ctx: Ctx, sync: LiveSync, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);
    const method = (req.method ?? "GET").toUpperCase();

    // the live sync channel
    if (path === "/api/events" && method === "GET") {
      const cookie = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
      const m = /quire_session=([^;]+)/.exec(cookie);
      if (m === null) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthenticated" }));
        return;
      }
      const { findSession, touchSession } = await import("./sessions.js");
      const session = await findSession(ctx, m[1]);
      if (session === null) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthenticated" }));
        return;
      }
      await touchSession(ctx, session.id);
      await serveEvents(ctx, sync, req, res, session.id);
      return;
    }

    // API routes
    if (path === "/api" || path.startsWith("/api/")) {
      try {
        const result = await handleApi(ctx, sync, req, res, method, path, url.searchParams);
        sendApiResult(res, result);
      } catch (e) {
        if (e instanceof HttpError) {
          res.writeHead(e.status, { "Content-Type": "application/json", ...(e.headers ?? {}) });
          res.end(JSON.stringify(e.body));
        } else {
          throw e;
        }
      }
      return;
    }

    // share surface
    if (path === "/s" || path.startsWith("/s/")) {
      if (method !== "GET" && method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "application/json", Allow: "GET, HEAD" });
        res.end(JSON.stringify({ error: "read_only" }));
        return;
      }
      await shareSurface(ctx, req, res, method, path, url.searchParams);
      return;
    }

    // a share token sent to any /api route is not a credential (handled above)

    // a built client asset, when it exists
    if (await serveStatic(res, path)) return;

    // the client shell renders every workspace route, including not-found
    const html = await readFile(join(publicDir, "index.html"), "utf8");
    const headers = { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" };
    if (isWorkspacePath(path)) {
      res.writeHead(200, headers);
    } else {
      res.writeHead(404, headers);
    }
    res.end(html);
  }

  function sendApiResult(res: ServerResponse, result: { status: number; body: unknown; setCookie?: string; headers?: Record<string, string> }): void {
    const headers: Record<string, string> = { ...(result.headers ?? {}) };
    if (result.setCookie !== undefined) headers["Set-Cookie"] = result.setCookie;
    if (Buffer.isBuffer(result.body)) {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.writeHead(result.status);
      res.end(result.body);
      return;
    }
    if (result.body === null) {
      res.writeHead(result.status, headers);
      res.end();
      return;
    }
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    res.writeHead(result.status, headers);
    res.end(JSON.stringify(result.body));
  }

  /** Serve a built client asset; false when there is none. */
  async function serveStatic(res: ServerResponse, rawPath: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*$/.test(rawPath.slice(1))) return false;
    const full = join(publicDir, rawPath);
    if (!full.startsWith(publicDir + "/") && full !== join(publicDir, "index.html")) return false;
    try {
      const info = await stat(full);
      if (!info.isFile()) return false;
      const data = await readFile(full);
      const mime = MIME[extname(full)] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=3600" });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }

  function isWorkspacePath(path: string): boolean {
    return (
      path === "/" ||
      path === "/sign-in" ||
      path === "/today" ||
      path === "/timeline" ||
      path === "/graph" ||
      path === "/queries" ||
      path === "/settings" ||
      /^\/o\//.test(path) ||
      /^\/types\//.test(path) ||
      /^\/collections\//.test(path) ||
      /^\/queries\//.test(path)
    );
  }
}

main().catch(() => {
  process.exit(1);
});
