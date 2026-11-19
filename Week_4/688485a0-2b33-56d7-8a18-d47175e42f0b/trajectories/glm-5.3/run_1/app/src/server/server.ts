import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { readEnv, AppState } from "./api/state.js";
import { createPool, applySchema } from "./db/db.js";
import { S3Client } from "./services/s3.js";
import { matchRoute, sendJson, sendError, RouteContext, BODY_LIMIT_JSON, BODY_LIMIT_FILE, StatusResult, RAW_RESPONSE } from "./api/http.js";
import { loadRoutes } from "./api/routes.js";

function isStatusResult(v: unknown): v is StatusResult {
  return typeof v === "object" && v !== null && "status" in v && "body" in v;
}

/**
 * The Jarful server: same-origin API and built assets (DP-88), with the
 * health route (DP-84) and the event streams (DP-54).
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** The built browser assets, next to the app root the server runs from. */
const ASSETS_DIR = resolve(process.cwd(), "dist-app");

async function serveAsset(res: ServerResponse, path: string): Promise<boolean> {
  // only names inside the built assets dir are ever served (DP-88)
  const safe = path.replace(/^\/+/, "");
  if (safe.length === 0 || safe.includes("..") || safe.includes("\0")) return false;
  const file = join(ASSETS_DIR, safe);
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "public, max-age=3600",
      "content-length": String(data.length),
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

let storageHealthy = false;

async function checkStorage(s3: S3Client): Promise<boolean> {
  try {
    storageHealthy = await s3.bucketExists();
  } catch {
    storageHealthy = false;
  }
  return storageHealthy;
}

export async function startServer(): Promise<void> {
  const env = readEnv();
  const db = createPool(env.databaseUrl);
  const s3 = new S3Client(env.s3);
  const state: AppState = { env, db, s3, limits: env.limits };

  // the server starts even when a dependency is down (DP-88)
  let schemaReady = false;
  const initDb = async (): Promise<void> => {
    try {
      await applySchema(db);
      schemaReady = true;
    } catch (err) {
      console.error("db schema not applied yet:", err instanceof Error ? err.message : err);
      setTimeout(initDb, 2000).unref();
    }
  };
  await initDb();
  await checkStorage(s3).catch(() => {
    storageHealthy = false;
  });
  // create the bucket when storage is reachable, and retry while it is not
  const ensureBucket = async (): Promise<void> => {
    try {
      await s3.ensureBucket();
    } catch {
      setTimeout(ensureBucket, 10000).unref();
    }
  };
  void ensureBucket();

  const routes = loadRoutes(state);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = (req.method ?? "GET").toUpperCase();

      // no cross-origin headers (DP-88)
      res.setHeader("x-content-type-options", "nosniff");

      if (path === "/api/health") {
        if (!schemaReady) {
          sendJson(res, 503, { status: "starting" });
          return;
        }
        await checkStorage(s3);
        sendJson(res, 200, { status: storageHealthy ? "ok" : "unavailable" });
        return;
      }

      // api routes
      if (path.startsWith("/api/")) {
        const match = matchRoute(routes.api, path, method);
        if (match) {
          const body = await readBody(req);
          const ctx: RouteContext = {
            req, res, method, path,
            query: url.searchParams,
            body,
            params: match.params,
          };
          const needsBody = match.route.method === "POST" || match.route.method === "PUT" || match.route.method === "PATCH";
          if (needsBody && !match.route.raw && ctx.body.length > 0) {
            const ct = (req.headers["content-type"] ?? "").toLowerCase();
            if (!ct.startsWith("application/json")) {
              sendJson(res, 415, { error: "unsupported_media_type" });
              return;
            }
          }
          const limit = match.route.raw ? (path.includes("grading") ? 10_000_000 : BODY_LIMIT_FILE) : BODY_LIMIT_JSON;
          if (ctx.body.length > limit) {
            sendJson(res, 413, { error: "too_large", limit });
            return;
          }
          const result = await match.route.handler(ctx);
          if (result === RAW_RESPONSE) return; // the handler wrote the response itself
          if (isStatusResult(result)) {
            sendJson(res, result.status, result.body);
            return;
          }
          sendJson(res, 200, result);
          return;
        }
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      // built assets only; source, manifest, package and env files are never served (DP-88)
      if (method === "GET" || method === "HEAD") {
        if (path === "/") {
          const index = await readFile(join(ASSETS_DIR, "index.html"));
          res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          res.end(index);
          return;
        }
        if (await serveAsset(res, path)) return;
        // client routes fall back to index.html; everything else is refused
        if (isClientRoute(path) && (await serveAsset(res, "index.html"))) return;
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end("Not found");
        return;
      }
      res.writeHead(405);
      res.end();
    } catch (err) {
      if (!res.headersSent) sendError(res, err);
      else res.end();
    }
  });

  server.listen(env.port, "0.0.0.0", () => {
    console.log(`Jarful listening on 0.0.0.0:${env.port}`);
  });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The client's own routes (no file extension), not source, manifest or config. */
function isClientRoute(path: string): boolean {
  if (path.includes("..") || path.includes("\0")) return false;
  const last = path.split("/").pop() ?? "";
  if (last.includes(".")) return false; // an asset name
  return /^\/(signup|confirm|signin|projects|invites|p\/)/.test(path);
}

export { storageHealthy };

void startServer().catch(err => {
  console.error("failed to start:", err);
  process.exit(1);
});
