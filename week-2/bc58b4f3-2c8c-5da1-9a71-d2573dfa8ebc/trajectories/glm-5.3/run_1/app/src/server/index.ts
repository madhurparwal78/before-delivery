import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { Pool } from "pg";
import { loadConfig } from "./config";
import { applySchema, applySeed } from "./db";
import { Router } from "./router";
import { sendJson } from "./httpio";
import { registerSessionRoutes, sessionUser, parseSessionCookie } from "./sessions";
import { rememberOrgNames } from "./assignments";
import { registerAssignmentRoutes } from "./assignments_routes";
import { registerBillingRoutes, retryQueuedPosts } from "./billing_routes";
import { registerCoverageAndOrgRoutes, registerFilesRoute } from "./coverage_org_routes";
import { flushOutbox } from "./mail";
import { ensureBucket } from "./s3";

const config = loadConfig();
const db = new Pool({ connectionString: config.databaseUrl, max: 10 });
const router = new Router();
const deps = { db, config };

registerSessionRoutes(router, db, config);
registerAssignmentRoutes(router, deps);
registerBillingRoutes(router, deps);
registerCoverageAndOrgRoutes(router, deps);
registerFilesRoute(router, deps);

router.add("GET", "/api/health", {
  roles: "any",
  handler: async (ctx) => {
    await db.query("SELECT 1");
    sendJson(ctx.res, 200, { status: "ok" });
  },
});

const PUBLIC_DIR = join(process.cwd(), "public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/** Only built client assets, fonts and the API are served; everything else is 404. */
function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (pathname.startsWith("/api/") || pathname.startsWith("/files/")) return false;
  let clean = pathname.replace(/\/+$/, "");
  if (clean === "") clean = "/index.html";
  if (clean.includes("..") || clean.includes("\\")) return false;
  const filePath = join(PUBLIC_DIR, clean);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA routes fall back to the shell.
    if (!extname(clean)) {
      serveShell(res);
      return true;
    }
    return false;
  }
  const type = MIME[extname(filePath)] ?? "application/octet-stream";
  const data = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": data.length,
    "Cache-Control": extname(filePath) === ".html" ? "no-store" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  });
  res.end(req.method === "HEAD" ? undefined : data);
  return true;
}

function serveShell(res: ServerResponse): void {
  const shellPath = join(PUBLIC_DIR, "index.html");
  if (!existsSync(shellPath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const data = readFileSync(shellPath);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  });
  res.end(data);
}

async function main(): Promise<void> {
  // Schema and seed are applied idempotently every serve.
  await applySchema(db);
  await applySeed(db);
  // Staff views name any organisation, so remember them all at boot.
  const orgs = await db.query(`SELECT code, name FROM organisations`);
  rememberOrgNames(orgs.rows as { code: string; name: string }[]);
  void ensureBucket(config);

  const server = createServer(async (req, res) => {
    try {
      const session = await sessionUser(db, parseSessionCookie(req.headers.cookie));
      const handled = await router.dispatch(req, res, session);
      if (handled) return;
      const url = new URL(req.url ?? "/", "http://localhost");
      if (serveStatic(req, res, url.pathname)) return;
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (e) {
      if (!res.writableEnded) {
        sendJson(res, 500, { error: { code: "internal", message: "Something went wrong." } });
      }
      console.error("request failed:", e);
    }
  });

  server.listen(config.publicPort, "0.0.0.0", () => {
    console.log(`teamseat listening on 0.0.0.0:${config.publicPort}`);
  });

  // Background loops: email outbox flush and queued billing retries.
  const sweep = async (): Promise<void> => {
    try {
      await flushOutbox(db, config);
    } catch {
      // Postgres hiccup; the next sweep retries.
    }
    try {
      await retryQueuedPosts(deps);
    } catch {
      // Next sweep retries.
    }
  };
  setInterval(sweep, 5_000).unref();
  void sweep();
}

void main();
