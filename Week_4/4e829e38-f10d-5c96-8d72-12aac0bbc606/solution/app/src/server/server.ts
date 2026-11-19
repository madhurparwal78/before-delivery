import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { personForToken } from "./auth.js";
import { config } from "./config.js";
import { now, realNow } from "./clock.js";
import { applySchema, pool, transaction } from "./db.js";
import { heartbeat, listen } from "./events.js";
import { ApiError, findRoute, notFound, sendJson, sendNoContent, sessionToken, unauthenticated, type Ctx } from "./http.js";
import { ensureBucket, StorageUnavailable } from "./s3.js";
import { runDueWork } from "./schedule.js";
import { seedStarter } from "./seed.js";
import { NO_CONTENT, RAW, state } from "./state.js";
import "./routes/accounts.js";
import "./routes/projects.js";
import "./routes/tasks.js";
import "./routes/team.js";
import "./routes/storage.js";
import "./routes/live.js";
import "./routes/grading.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const extension = path.extname(pathname);
  const relative = extension ? pathname : "/index.html";
  const file = path.normalize(path.join(publicDir, relative));
  if (!file.startsWith(publicDir) || (extension && !CONTENT_TYPES[extension])) return void sendJson(res, 404, { error: "not_found" });
  try {
    const bytes = await readFile(file);
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream", "content-length": bytes.length,
      "cache-control": extension === ".woff2" ? "public, max-age=86400" : "no-cache", "x-content-type-options": "nosniff",
    });
    res.end(bytes);
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const isApi = url.pathname.startsWith("/api/") || url.pathname.startsWith("/grading/");
  if (!isApi) {
    if (req.method !== "GET" && req.method !== "HEAD") return void sendJson(res, 404, { error: "not_found" });
    return serveStatic(url.pathname, res);
  }
  try {
    const found = findRoute(req.method ?? "GET", url.pathname);
    if (!found) throw notFound();
    const personId = await personForToken(pool, sessionToken(req));
    if (!personId && !found.route.open) throw unauthenticated();
    const ctx: Ctx = { req, res, url, params: found.params, personId: personId ?? "" };
    const result = await found.route.handler(ctx);
    if (result === RAW) return;
    if (result === NO_CONTENT) return sendNoContent(res);
    sendJson(res, found.route.status, result);
  } catch (error) {
    if (res.headersSent) return void res.end();
    if (error instanceof ApiError) return sendJson(res, error.status, error.body, error.headers);
    if (error instanceof StorageUnavailable) return sendJson(res, 503, { error: "storage_unavailable" });
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    sendJson(res, 500, { error: "server_error" });
  }
}

async function boot(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(7003)");
        const people = await tx.query("SELECT 1 FROM people LIMIT 1");
        if (!people.rowCount) await seedStarter(tx, await now(tx));
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await ensureBucket();
  await listen();
  state.ready = true;
}

const server = createServer((req, res) => void handle(req, res));
server.keepAliveTimeout = 65_000;
server.listen(config.port, "0.0.0.0");
setInterval(heartbeat, 15_000).unref();
process.on("unhandledRejection", (reason) => process.stderr.write(`${String(reason)}\n`));

if (!config.grading) {
  let lastTick = realNow();
  setInterval(() => {
    if (!state.ready) return;
    const current = realNow();
    const previous = lastTick;
    lastTick = current;
    void runDueWork(previous, current, previous).catch(() => undefined);
  }, config.dueTickMs).unref();
}

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
void boot();
