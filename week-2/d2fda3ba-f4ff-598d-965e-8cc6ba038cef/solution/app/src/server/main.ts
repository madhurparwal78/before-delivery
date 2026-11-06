// Cairn server: applies the schema, catalog and seeds, then serves the API, the public and
// preview routes and the built browser assets — nothing else.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { config } from "./config.ts";
import { prepareDatabase } from "./db.ts";
import { ApiError, crossOrigin, findRoute, hasBody, isJson, notFound, readBody, sendError, sendJson, API_LIMIT, type Ctx } from "./http.ts";
import { BillingUnavailable } from "./killbill.ts";
import { sendSoon } from "./mail.ts";
import { StorageUnavailable } from "./s3.ts";
import { bootstrapKillBill, startSweeps } from "./sweep.ts";
import { messagePage, servePublic } from "./routes/public.ts";
import "./routes/accounts.ts";
import "./routes/vaults.ts";
import "./routes/billing.ts";
import "./routes/dossiers.ts";
import "./routes/ops.ts";

const PUBLIC_DIR = new URL("./public/", import.meta.url).pathname;
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  woff2: "font/woff2", svg: "image/svg+xml", json: "application/json; charset=utf-8",
};

/** Every built asset, by URL path, read once at start. */
function loadAssets(dir: string, prefix = ""): Map<string, Buffer> {
  const assets = new Map<string, Buffer>();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      for (const [key, value] of loadAssets(path, `${prefix}/${name}`)) assets.set(key, value);
    } else {
      assets.set(`${prefix}/${name}`, readFileSync(path));
    }
  }
  return assets;
}

const assets = loadAssets(PUBLIC_DIR);
const shell = assets.get("/index.html") as Buffer;
const SHELL_ROUTES = [/^\/$/, /^\/ops$/, /^\/devices\/approve\/[^/]+$/, /^\/invites\/[^/]+$/];

function serveAsset(req: IncomingMessage, res: ServerResponse, path: string): void {
  const isShell = SHELL_ROUTES.some((r) => r.test(path));
  const body = isShell ? shell : path === "/index.html" ? undefined : assets.get(path);
  if (!body || (req.method !== "GET" && req.method !== "HEAD")) return messagePage(res, 404, "There is nothing at this address.");
  const type = isShell ? TYPES.html : TYPES[path.slice(path.lastIndexOf(".") + 1)] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff",
    ...(path === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}),
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

async function serveApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (url.pathname === "/api/health" && req.method === "GET") return sendJson(res, 200, { status: "ok" });
  const found = findRoute(req.method ?? "GET", url.pathname);
  if (hasBody(req) && !isJson(req)) throw new ApiError(415, "unsupported_media_type", "Send the request body as application/json.");
  const body = await readBody(req, found?.route.limit ?? API_LIMIT);
  if (body === null) throw new ApiError(413, "payload_too_large", "The request body is too large.");
  if (crossOrigin(req)) throw new ApiError(403, "cross_origin", "Requests must come from Cairn itself.");
  if (!found) throw notFound();
  const ctx: Ctx = { req, res, url, params: found.params, body };
  await found.route.handler(ctx);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", config.publicUrl);
  if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
    try {
      await serveApi(req, res, url);
    } catch (error) {
      if (error instanceof ApiError) return sendError(res, error);
      if (error instanceof StorageUnavailable) return sendError(res, new ApiError(503, "storage_unavailable", "Storage is unavailable right now. Nothing changed."));
      if (error instanceof BillingUnavailable) return sendError(res, new ApiError(503, "billing_unavailable", "Billing is unavailable. Your plan hasn't changed — try again shortly."));
      console.error("request failed:", req.method, url.pathname, (error as Error).stack);
      return sendError(res, new ApiError(500, "internal_error", "Something went wrong on the server."));
    }
    return;
  }
  if (crossOrigin(req)) return messagePage(res, 403, "Requests must come from Cairn itself.");
  if (url.pathname.startsWith("/d/") || url.pathname.startsWith("/p/")) return servePublic(req, res, url);
  serveAsset(req, res, url.pathname);
}

await prepareDatabase();
await bootstrapKillBill();
startSweeps();
sendSoon();

createServer((req, res) => {
  handle(req, res).catch((error: Error) => {
    console.error("request failed:", error.stack);
    if (!res.headersSent) messagePage(res, 500, "Something went wrong on the server.");
    else res.end();
  });
}).listen(config.port, "0.0.0.0", () => console.log(`Cairn listening on 0.0.0.0:${config.port}`));
