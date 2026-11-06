// Bellroll server: built assets and the API on 0.0.0.0:APP_PUBLIC_PORT. Health answers 503 until Postgres is reached
// and the schema and seed are in place; Kill Bill and storage outages never stop it from starting.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { now, nowSecond } from "./clock.js";
import { withClient } from "./db/pool.js";
import { ensureSchemaAndSeed } from "./db/schema.js";
import { expireLapsedHolds } from "./domain/contractStates.js";
import { ApiError } from "./http/errors.js";
import { createApi, sendError, type RequestTarget } from "./http/router.js";
import { routes } from "./http/routes.js";
import { ensureTenant } from "./services/killbill.js";
import { startDispatcher } from "./services/mail.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

let ready = false;

/** Holds lapse on every surface without a request to trigger them: each API request settles them first. */
const api = createApi(routes, async () => {
  if (!ready) throw new ApiError(503, "starting", "Bellroll is starting up.");
  await withClient((db) => expireLapsedHolds(db, now()));
});

async function serveStatic(pathname: string): Promise<{ status: number; type: string; body: Buffer }> {
  const notFoundPage = { status: 404, type: "application/json; charset=utf-8",
    body: Buffer.from(JSON.stringify(new ApiError(404, "not_found", "Not found.").body())) };
  const file = normalize(join(PUBLIC_DIR, decodeURIComponent(pathname)));
  const inside = relative(PUBLIC_DIR, file);
  if (inside.startsWith("..") || inside.split(sep).some((part) => part.startsWith("."))) return notFoundPage;
  const isAppRoute = !extname(pathname);
  try {
    const target = isAppRoute ? join(PUBLIC_DIR, "index.html") : file;
    return { status: 200, type: TYPES[extname(target)] ?? "application/octet-stream", body: await readFile(target) };
  } catch {
    return notFoundPage;
  }
}

const server = createServer((request, response) => {
  const target = request.url ?? "/";
  const queryAt = target.indexOf("?");
  const url: RequestTarget = queryAt < 0
    ? { pathname: target, searchParams: new URLSearchParams() }
    : { pathname: target.slice(0, queryAt), searchParams: new URLSearchParams(target.slice(queryAt + 1)) };
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/health" && request.method === "GET") {
      response.writeHead(ready ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ status: ready ? "ok" : "starting" }));
      return;
    }
    void api(request, response, url);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendError(response, new ApiError(404, "not_found", "Not found."));
    return;
  }
  void serveStatic(url.pathname).then(({ status, type, body }) => {
    response.writeHead(status, { "content-type": type, "cache-control": "no-cache", "x-content-type-options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : body);
  });
});

server.listen(config.port, "0.0.0.0", () => console.log(`Bellroll listening on 0.0.0.0:${config.port}`));

async function start(): Promise<void> {
  for (;;) {
    try {
      await withClient((db) => ensureSchemaAndSeed(db, nowSecond()));
      ready = true;
      break;
    } catch (error) {
      console.error("waiting for Postgres:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  setInterval(() => void withClient((db) => expireLapsedHolds(db, now()))
    .catch((error: unknown) => console.error("hold sweep failed", error instanceof Error ? error.message : error)), 1_000);
  startDispatcher();
  ensureTenant().catch(() => console.error("Kill Bill is unreachable at boot; billing actions answer 503 until it is back"));
}

void start();
