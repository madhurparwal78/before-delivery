import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.js";
import { connectWithRetry, database, migrate } from "./db.js";
import { Refusal } from "./errors.js";
import { Context, findRoute, readBody, send, sendError } from "./http.js";
import { keepAlive } from "./live.js";
import { servePage } from "./pages.js";
import { startScheduler } from "./scheduler.js";
import { seed } from "./seed.js";
import { storageReachable } from "./storage.js";
import "./routes/auth.js";
import "./routes/files.js";
import "./routes/grading.js";
import "./routes/parties.js";
import "./routes/quests.js";
import "./routes/system.js";
import "./routes/tasks.js";

const STORAGE_PROBE_MS = 10_000;
const CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || !CHANGING.has(req.method ?? "")) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (crossOrigin(req)) throw Refusal.crossOrigin();
  const found = findRoute(req.method ?? "GET", url.pathname);
  if (url.pathname !== "/api/health" && !database.ready) throw Refusal.databaseUnavailable();
  if (!found) throw Refusal.notFound();
  const body = CHANGING.has(req.method ?? "") ? await readBody(req, found.route.limit) : { bytes: Buffer.alloc(0), oversize: false };
  send(res, await found.route.handler(new Context(req, res, url, found.params, body)));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const work = url.pathname.startsWith("/api/") ? handleApi(req, res, url) : servePage(req, res, url.pathname);
  work.catch((error: unknown) => sendError(res, error));
});
server.requestTimeout = 0;
server.listen(config.port, "0.0.0.0");

keepAlive();
void connectWithRetry(async () => {
  await migrate();
  await seed();
}).then(startScheduler);
void storageReachable();
setInterval(() => void storageReachable(), STORAGE_PROBE_MS).unref();

