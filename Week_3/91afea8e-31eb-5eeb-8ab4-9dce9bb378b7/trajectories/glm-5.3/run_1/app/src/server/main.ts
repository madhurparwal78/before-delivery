import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "./config.js";
import { Router, type Ctx } from "./http.js";
import { ApiError, copy } from "./errors.js";
import { schema } from "./schema.js";
import { seedIfEmpty } from "./seed.js";
import { pool, query, one } from "./db.js";
import * as auth from "./auth.js";
import catalogRouter from "./api_catalog.js";
import authRouter from "./api_auth.js";
import cartRouter from "./api_cart.js";
import ordersRouter from "./api_orders.js";
import sellerRouter from "./api_seller.js";
import supportRouter from "./api_support.js";
import { renderPage } from "./pages.js";

const api = new Router();
for (const r of [catalogRouter, authRouter, cartRouter, ordersRouter, sellerRouter, supportRouter]) {
  api.merge(r);
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_JSON = config.limits.jsonBodyBytes;
const MAX_MULTIPART = config.limits.multipartBodyBytes;

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json",
};

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "internal", message: "Something went wrong." }));
    } else {
      res.end();
    }
    console.error("unhandled", e);
  }
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = (req.method ?? "GET").toUpperCase();

  // never serve source, env, manifests, lockfiles or maps
  const forbiddenPatterns = [/^\/src\//, /^\/dist\/client\//, /^\/\.env/, /^\/run\.json/, /^\/package(-lock)?\.json/, /^\/tsconfig/, /\.ts$/m, /\.map$/];
  if (forbiddenPatterns.some((p) => p.test(pathname)) || pathname.startsWith("/api/")) {
    // API handled below; static denials fall through to 404
  }

  res.setHeader("X-Content-Type-Options", "nosniff");

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    await handleApi(req, res, url, pathname, method);
    return;
  }

  await handlePage(req, res, url, pathname, method);
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, pathname: string, method: string): Promise<void> {
  const cookies = auth.parseCookies(req);
  const ctx: Ctx = {
    req, res, method, path: pathname, query: url.searchParams, params: {}, body: null, rawBody: Buffer.alloc(0),
    cookies, ip: clientIp(req), origin: (req.headers.origin as string) ?? null,
    host: (req.headers.host as string) ?? null, account: null, sessionId: null, setCookies: [], idempotencyReplay: false,
  };

  const sendError = (err: ApiError) => {
    if (res.headersSent) { res.end(); return; }
    res.statusCode = err.status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (err.retryAfter !== null) {
      res.setHeader("Retry-After", String(err.retryAfter));
    }
    res.end(JSON.stringify(err.body()));
  };

  try {
    const match = api.match(method, pathname);
    if (!match) {
      const allowed = api.allowedMethods(pathname);
      if (allowed.length > 0) {
        // a shared link answers read_only for any method but GET
        if (pathname.startsWith("/api/shared/")) {
          res.setHeader("Allow", "GET");
          sendError(new ApiError(405, "read_only", copy.readOnly));
          return;
        }
        res.setHeader("Allow", allowed.join(", "));
        sendError(new ApiError(405, "not_found", copy.notFound));
        return;
      }
      sendError(new ApiError(404, "not_found", copy.notFound));
      return;
    }

    // error precedence 1: body size
    const contentLength = Number(req.headers["content-length"] ?? "0");
    const contentType = (req.headers["content-type"] ?? "").toLowerCase();
    const isMultipart = contentType.includes("multipart/form-data");
    const maxBody = isMultipart ? MAX_MULTIPART : MAX_JSON;
    if (contentLength > maxBody) {
      sendError(new ApiError(413, "too_large", copy.tooLarge));
      return;
    }

    // parse body
    if (method !== "GET" && method !== "HEAD") {
      const raw = await readRawBody(req, maxBody);
      if (raw.length > maxBody) {
        sendError(new ApiError(413, "too_large", copy.tooLarge));
        return;
      }
      ctx.rawBody = raw;
      if (raw.length > 0) {
        if (isMultipart) {
          ctx.body = parseMultipart(raw, contentType);
        } else {
          try {
            ctx.body = JSON.parse(raw.toString("utf8"));
          } catch {
            sendError(new ApiError(400, "validation_failed", copy.validationFailed));
            return;
          }
        }
      } else {
        ctx.body = {};
      }
    }

    // error precedence 2: foreign Origin
    if (STATE_CHANGING.has(method) && ctx.origin) {
      const host = ctx.host ?? "";
      const self = `http://${host}`;
      const selfHttps = `https://${host}`;
      if (ctx.origin !== self && ctx.origin !== selfHttps) {
        sendError(new ApiError(403, "cross_site_request", copy.crossSiteRequest));
        return;
      }
    }

    // load the session; half-signed-in reaches nothing but the code step
    const session = await auth.loadSession(cookies);
    if (session) {
      ctx.account = { id: session.account.account_id, role: session.account.role, name: session.account.name, firstName: session.account.name.split(" ")[0] };
      ctx.sessionId = session.sessionId;
    }

    ctx.params = match.params;
    const result = await match.route.handler(ctx);
    for (const cookie of ctx.setCookies) {
      res.appendHeader("Set-Cookie", cookie);
    }
    if (Buffer.isBuffer(result)) {
      if (!res.headersSent) res.writeHead(res.statusCode, res.getHeaders());
      res.end(result);
      return;
    }
    if (result === null || result === undefined) {
      if (!res.headersSent) res.writeHead(res.statusCode, { "Content-Type": "application/json; charset=utf-8" });
      res.end();
      return;
    }
    const body = JSON.stringify(result);
    if (!res.headersSent) {
      if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.writeHead(res.statusCode, res.getHeaders());
    }
    res.end(body);
  } catch (e) {
    if (e instanceof ApiError) {
      sendError(e);
      return;
    }
    console.error("api error", e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "internal", message: "Something went wrong." }));
    } else {
      res.end();
    }
  }
}

function clientIp(req: http.IncomingMessage): string {
  return (req.socket.remoteAddress ?? "0.0.0.0").replace(/^::ffff:/, "");
}

async function readRawBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new ApiError(413, "too_large", copy.tooLarge));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

interface MultipartFile { data: Buffer; filename: string }

function parseMultipart(raw: Buffer, contentType: string): { file?: MultipartFile } {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundaryMatch) return {};
  const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]}`;
  const boundaryBuffer = Buffer.from(boundary);
  const parts: Array<{ data: Buffer; filename: string }> = [];
  let start = raw.indexOf(boundaryBuffer);
  while (start !== -1) {
    const next = raw.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (next === -1) break;
    let part = raw.subarray(start + boundaryBuffer.length, next);
    if (part[0] === 0x0d && part[1] === 0x0a) part = part.subarray(2);
    if (part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) part = part.subarray(0, part.length - 2);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const nameMatch = /name="([^"]*)"/.exec(headers);
      if (nameMatch && nameMatch[1] === "file") {
        const filenameMatch = /filename="([^"]*)"/.exec(headers);
        parts.push({ data: part.subarray(headerEnd + 4), filename: filenameMatch?.[1] ?? "" });
      }
    }
    start = next;
  }
  return parts.length > 0 ? { file: parts[0] } : {};
}

// ---------- pages and static ----------

async function handlePage(req: http.IncomingMessage, res: http.ServerResponse, url: URL, pathname: string, method: string): Promise<void> {
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.end();
    return;
  }
  // static assets under /assets/, /img/, /fonts/
  if (pathname.startsWith("/assets/") || pathname.startsWith("/img/") || pathname.startsWith("/fonts/")) {
    serveStatic(res, pathname);
    return;
  }
  // never serve source files, env, manifest, lockfiles or maps
  if (/^\/(src|dist|node_modules|scripts)\//.test(pathname) || /^\/\.env/.test(pathname) || /^\/run\.json/.test(pathname)
    || /^\/(package|package-lock)\.json/.test(pathname) || /^\/tsconfig/.test(pathname)
    || pathname.endsWith(".ts") || pathname.endsWith(".map") || pathname.endsWith(".mjs")) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(notFoundPage());
    return;
  }
  const cookies = auth.parseCookies(req);
  const session = await auth.loadSession(cookies);
  const account = session ? { id: session.account.account_id, role: session.account.role, name: session.account.name, firstName: session.account.name.split(" ")[0] } : null;
  const html = renderPage(pathname, url, account);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

function serveStatic(res: http.ServerResponse, pathname: string): void {
  const root = path.join(process.cwd(), "dist", "public");
  const target = path.join(root, pathname);
  if (!target.startsWith(root)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    // procedural product art: any /img/listings/<id>.svg is generated
    if (pathname.startsWith("/img/listings/") && pathname.endsWith(".svg")) {
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(productSvg(pathname));
      return;
    }
    res.statusCode = 404;
    res.end();
    return;
  }
  const ext = path.extname(target).toLowerCase();
  res.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
  res.end(fs.readFileSync(target));
}

function productSvg(pathname: string): string {
  const id = decodeURIComponent(pathname.replace("/img/listings/", "").replace(".svg", ""));
  const hue = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-label="${id}">
  <rect width="400" height="400" fill="hsl(${hue}, 72%, 46%)"/>
  <circle cx="200" cy="170" r="70" fill="hsl(${(hue + 40) % 360}, 80%, 62%)" opacity="0.9"/>
  <rect x="120" y="230" width="160" height="18" rx="9" fill="#0b0b3a"/>
  <rect x="120" y="258" width="160" height="18" rx="9" fill="#ffd23f"/>
  <rect x="120" y="286" width="160" height="18" rx="9" fill="#ff4f9a"/>
  <text x="200" y="360" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="34" fill="#ffffff">${id}</text>
</svg>`;
}

function notFoundPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chauraha</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/styles.css"></head><body><main class="panel-black notfound"><h1>nothing here. wrong turn at the chauraha.</h1><a class="btn btn-primary" href="/">back to the bazaar</a></main><script type="module" src="/assets/app.js"></script></body></html>`;
}

// ---------- boot ----------

let schemaReady = false;

async function boot(): Promise<void> {
  // keep retrying Postgres until the schema is applied
  for (;;) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      console.error("postgres unreachable; retrying in 2s");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await applySchema();
  await seedIfEmpty();
  await markReady();
  schemaReady = true;

  // index the catalogue for search
  const { reindexAll } = await import("./indexer.js");
  reindexAll().catch((e) => console.error("index error", e));

  // document generation for shipments placed with confirmed payment or as COD
  const { documentPass, startBackgroundLoops } = await import("./jobs.js");
  startBackgroundLoops();
  await documentPass().catch((e) => console.error("document error", e));

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`chauraha listening on ${config.port}`);
  });
}

async function applySchema(): Promise<void> {
  for (;;) {
    try {
      await pool.query(schema);
      return;
    } catch (e) {
      console.error("schema apply failed; retrying", e);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function markReady(): Promise<void> {
  for (;;) {
    try {
      await query("UPDATE health_state SET schema_ready = true WHERE id = 1");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

void schemaReady;
boot().catch((e) => {
  console.error("boot failure", e);
  process.exit(1);
});
