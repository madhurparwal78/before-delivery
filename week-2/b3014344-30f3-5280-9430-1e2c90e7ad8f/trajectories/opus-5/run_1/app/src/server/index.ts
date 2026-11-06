import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config, SESSION_COOKIE } from "./config.js";
import { ApiError, errors, withOutageCopy } from "./errors.js";
import { applySchema, requireLedger } from "./db.js";
import { type Ctx, assertSameOrigin, clientWantsJson, cookies, sendJson } from "./http.js";
import { matchRoute, pathSegments } from "./router.js";
import { apiRoutes, guardStudioRoutes } from "./api/routes.js";
import { pageRoutes, renderErrorPage } from "./pages/routes.js";
import { sessionUser } from "./domain/accounts.js";
import { startWorkers } from "./workers/index.js";
import { runSeed } from "./seed.js";
import * as killbill from "./services/killbill.js";
import * as storage from "./services/storage.js";
import * as cms from "./services/cms.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const STATIC_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
  if (!relative.startsWith("assets/") && !relative.startsWith("fonts/")) return false;
  const extension = relative.slice(relative.lastIndexOf("."));
  const contentType = STATIC_TYPES[extension];
  if (!contentType) return false;
  try {
    const bytes = await readFile(join(publicDir, relative));
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": bytes.length.toString(),
      "Cache-Control": relative.startsWith("fonts/") ? "public, max-age=86400" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = req.headers.host ?? `127.0.0.1:${config.port}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const method = req.method ?? "GET";
  const segments = pathSegments(url.pathname);
  const isApi = url.pathname.startsWith("/api/");

  if (method === "GET" && (await serveStatic(url.pathname, res))) return;

  const ctx: Ctx = {
    req,
    res,
    method,
    url,
    params: {},
    sessionId: null,
    user: null,
    wantsJson: isApi || clientWantsJson(req),
  };

  try {
    if (url.pathname === "/api/health" || url.pathname === "/api/clock") {
      const match = matchRoute(apiRoutes, method, segments);
      if (!match) throw errors.notFound();
      await match.handler(ctx);
      return;
    }

    await requireLedger();
    const sessionId = cookies(req)[SESSION_COOKIE] ?? null;
    ctx.sessionId = sessionId;
    if (sessionId) ctx.user = await sessionUser(sessionId);
    assertSameOrigin(ctx);

    const apiMatch = matchRoute(apiRoutes, method, segments);
    if (apiMatch) {
      ctx.params = apiMatch.params;
      guardStudioRoutes(ctx);
      await withOutageCopy(apiMatch.outage, () => apiMatch.handler(ctx));
      return;
    }

    if (!isApi) {
      const pageMatch = matchRoute(pageRoutes, method, segments);
      if (pageMatch) {
        ctx.params = pageMatch.params;
        await pageMatch.handler(ctx);
        return;
      }
    }
    throw errors.notFound();
  } catch (error) {
    await respondWithError(ctx, error);
  }
}

async function respondWithError(ctx: Ctx, error: unknown): Promise<void> {
  if (ctx.res.headersSent) {
    ctx.res.end();
    return;
  }
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(500, "internal_error", "Something went wrong on our side.");
  if (!(error instanceof ApiError)) {
    process.stderr.write(`unhandled: ${(error as Error).stack ?? String(error)}\n`);
  }
  if (ctx.url.pathname.startsWith("/api/") || ctx.wantsJson) {
    sendJson(ctx.res, apiError.status, apiError.body());
    return;
  }
  await renderErrorPage(ctx, apiError);
}

async function setupLoop(): Promise<void> {
  let schemaReady = false;
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      if (!schemaReady) {
        await applySchema();
        schemaReady = true;
      }
      await killbill.ensureCatalog();
      await storage.ensureBucket();
      await cms.ensureCollection();
      await runSeed();
    } catch (error) {
      process.stderr.write(`setup retry: ${(error as Error).stack ?? String(error)}\n`);
      return;
    } finally {
      running = false;
    }
    clearInterval(timer);
  };
  const timer = setInterval(() => void run(), 15_000);
  timer.unref();
  await run();
}

const server = createServer((req, res) => {
  void handle(req, res);
});

server.listen(config.port, "0.0.0.0", () => {
  process.stdout.write(`pampero ledger listening on ${config.port}\n`);
  void setupLoop();
  startWorkers();
});
