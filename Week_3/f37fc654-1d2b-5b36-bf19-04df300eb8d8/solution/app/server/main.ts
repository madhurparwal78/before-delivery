// Spindrift Commission Stage: one HTTP server for the built app, its assets and the API.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { BANNERS } from "../shared/copy.js";
import { registerAuth, requireCaller } from "./auth.js";
import { config } from "./config.js";
import { isDatabaseDown, migrate, pool, tx } from "./db.js";
import { attachStream, listen } from "./events.js";
import { ApiError, BodyTooLarge, Router, parseCookies, readBody, send, type Request } from "./http.js";
import { runWorker, wakeWorker } from "./jobs.js";
import { ensureRealm } from "./keycloak.js";
import { hasCatalog, uploadCatalog } from "./providers/killbill.js";
import { ProviderRefused, ServiceDown } from "./providers/reach.js";
import { registerBriefs } from "./routes/briefs.js";
import { registerCheckout } from "./routes/checkout.js";
import { registerCommissions } from "./routes/commissions.js";
import { registerCrew } from "./routes/crew.js";
import { registerCrm } from "./routes/crm.js";
import { registerFiles } from "./routes/files.js";
import { registerFunders } from "./routes/funders.js";
import { registerHolds } from "./routes/holds.js";
import { registerLayout } from "./routes/layout.js";
import { registerMaintenance } from "./routes/maintenance.js";
import { registerOps } from "./routes/ops.js";
import { registerRenders } from "./routes/renders.js";
import { registerVenues } from "./routes/venues.js";
import { handlers, sweeps } from "./worker.js";

const router = new Router();
for (const register of [registerAuth, registerOps, registerVenues, registerBriefs, registerCommissions, registerFiles, registerRenders,
  registerLayout, registerHolds, registerCheckout, registerFunders, registerCrew, registerCrm, registerMaintenance]) register(router);

const UNAVAILABLE: Record<string, string> = {
  killbill: "billing_unavailable", minio: "storage_unavailable", svix: "webhooks_unavailable", keycloak: "signin_unavailable",
};

function errorReply(error: unknown): { status: number; body: unknown } {
  if (error instanceof ApiError) return { status: error.status, body: error.body };
  if (error instanceof ServiceDown) {
    return { status: 503, body: { error: { code: UNAVAILABLE[error.service] ?? `${error.service}_unavailable`, message: BANNERS[error.service] } } };
  }
  if (isDatabaseDown(error) || (error instanceof Error && "code" in error && (error as { code: unknown }).code === "42P01")) {
    return { status: 503, body: { error: { code: "database_unavailable", message: BANNERS.postgres } } };
  }
  if (error instanceof ProviderRefused) {
    console.error(error.message);
    return { status: 502, body: { error: { code: "provider_error", message: `${error.service} refused the request.` } } };
  }
  console.error(error);
  return { status: 500, body: { error: { code: "internal" } } };
}

// ---- Static app ----------------------------------------------------------------------------------

const CLIENT_DIR = fileURLToPath(new URL("../client/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

function serveStatic(path: string, res: ServerResponse): void {
  const extension = extname(path);
  const file = extension ? normalize(join(CLIENT_DIR, path)) : join(CLIENT_DIR, "index.html");
  const allowed = file.startsWith(CLIENT_DIR) && extension !== ".map" && existsSync(file) && statSync(file).isFile() && (extension === "" || extension in TYPES);
  if (!allowed) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const immutable = path.startsWith("/assets/") || path.startsWith("/fonts/");
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

// ---- Requests ------------------------------------------------------------------------------------

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", config.publicUrl);
  const method = req.method ?? "GET";
  const isApi = url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/");
  if (!isApi) {
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    serveStatic(decodeURIComponent(url.pathname), res);
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  if (url.pathname === "/api/events" && method === "GET") {
    try {
      attachStream(await requireCaller({ method, url, params: {}, headers: req.headers, cookies, raw: Buffer.alloc(0) }), res);
    } catch (error) {
      send(res, errorReply(error));
    }
    return;
  }
  const found = router.match(method, url.pathname);
  if (found === null) {
    send(res, { status: 404, body: { error: { code: "not_found" } } });
    return;
  }
  if (found === "method") {
    send(res, { status: 405, body: { error: { code: "method_not_allowed" } } });
    return;
  }
  let raw: Buffer;
  try {
    raw = await readBody(req, found.route.bodyLimit);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      send(res, { status: 413, body: { error: { code: "body_too_large" } }, headers: { Connection: "close" } });
      return;
    }
    throw error;
  }
  const request: Request = { method, url, params: found.params, headers: req.headers, cookies, raw };
  try {
    send(res, await found.route.handler(request));
  } catch (error) {
    send(res, errorReply(error));
  }
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (!res.headersSent) send(res, errorReply(error));
    else res.destroy();
  });
});
server.requestTimeout = 120_000;
server.listen(config.port, "0.0.0.0");

/** Keeps trying a setup step until it succeeds, without blocking the server. */
async function untilDone(step: () => Promise<void>, everyMs: number): Promise<void> {
  for (;;) {
    try {
      await step();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, everyMs));
    }
  }
}

void (async () => {
  await untilDone(migrate, 2000);
  void listen(wakeWorker);
  void runWorker(handlers, sweeps);
})();
void untilDone(ensureRealm, 5000);
// The Kill Bill catalog is uploaded once per tenant; instances sharing the database take turns.
void untilDone(async () => {
  if (await hasCatalog()) return;
  await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(7302115)");
    if (!(await hasCatalog())) await uploadCatalog();
  });
}, 5000);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close();
    pool.end().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
