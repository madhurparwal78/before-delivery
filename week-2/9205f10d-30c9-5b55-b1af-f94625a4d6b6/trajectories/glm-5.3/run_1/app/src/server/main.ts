import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { ApiError } from "./errors.js";
import { JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT, Router, isSameOrigin, readBody, sendError, sendJson, type Ctx } from "./http.js";
import { SessionStore } from "./session.js";
import { buildRouter } from "./api.js";
import { buildExtraRouter } from "./api_extra.js";
import type { App } from "./requests.js";
import { MailQueue } from "./mail.js";
import { KillBill } from "./killbill.js";
import { PostingWorker } from "./posting.js";
import { S3Store } from "./s3.js";
import { seedOnce } from "./seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "../../../public");
const config = loadConfig();

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
const sessions = new SessionStore(pool);
const mail = new MailQueue(pool, config.smtp);
const killbill = new KillBill(config.killbill);
const s3 = new S3Store(config.s3);
const posting = new PostingWorker(pool, killbill);
const app: App = { pool, mail, config };

const router = new Router();
for (const route of buildRouter(app, sessions).routesOf()) router.add(route.method, route.path, route.handler);
for (const route of buildExtraRouter(app, sessions, s3).routesOf()) router.add(route.method, route.path, route.handler);

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const NEVER_SERVED = /\.(?:ts|tsx|json|map|env|md|lock|mjs)$|(^|\/)(?:package\.json|package-lock\.json|run\.json|tsconfig[^\/]*\.json|\.env.*)$/;

function isNeverServed(pathName: string): boolean {
  const clean = pathName.replace(/^\/+/, "");
  if (clean.startsWith(".") || clean.includes("/.")) return true;
  if (clean.startsWith("node_modules/") || clean.startsWith("src/") || clean.startsWith("client/") || clean.startsWith("scripts/") || clean.startsWith("dist/")) return true;
  return NEVER_SERVED.test(pathName);
}

function serveStatic(pathName: string, res: ServerResponse): boolean {
  if (pathName === "/" || pathName === "") pathName = "/index.html";
  if (pathName.includes("..")) return false;
  if (isNeverServed(pathName)) return false;
  const clean = pathName.replace(/^\/+/, "");
  const candidates = clean === "index.html"
    ? [join(PUBLIC_DIR, "index.html")]
    : [join(PUBLIC_DIR, clean)];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    if (!statSync(file).isFile()) continue;
    const type = STATIC_TYPES[extname(file)] ?? "application/octet-stream";
    const body = readFileSync(file);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": String(body.length),
      "Cache-Control": clean.startsWith("fonts/") || clean.startsWith("assets/") ? "public, max-age=86400" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
    return true;
  }
  return false;
}

function serveSpaFallback(pathName: string, res: ServerResponse): boolean {
  if (isApiPath(pathName)) return false;
  if (isNeverServed(pathName)) return false;
  const index = join(PUBLIC_DIR, "index.html");
  if (!existsSync(index)) return false;
  const body = readFileSync(index);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
  return true;
}

/** Only /api and /api/... are API calls; /api.js and friends are static files. */
function isApiPath(pathName: string): boolean {
  return pathName === "/api" || pathName.startsWith("/api/");
}

function readSessionToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "session") return rest.join("=");
  }
  return null;
}

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  } catch {
    sendJson(res, 400, { error: { code: "not_found", message: "Not found." } });
    return;
  }
  const pathName = url.pathname;

  // boundary: same-origin only for state-changing requests
  if (["POST", "PATCH", "DELETE", "PUT"].includes(method)) {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      const o = new URL(origin);
      if (o.host !== req.headers.host) {
        sendError(res, new ApiError("forbidden", "Cross-origin requests are not allowed."));
        return;
      }
    }
  }

  if (isApiPath(pathName)) {
    const isUpload = pathName === "/api/me/credentials" && method === "POST";
    const read = await readBody(req, isUpload ? UPLOAD_BODY_LIMIT : JSON_BODY_LIMIT);
    if (!read.ok) {
      const code = read.tooLarge ? "payload_too_large" : "unsupported_type";
      sendError(res, new ApiError(code, read.tooLarge ? "That request is too large." : "The request could not be read."));
      return;
    }
    const rawBody = read.buffer;
    const contentType = req.headers["content-type"] ?? "";
    let body: unknown = undefined;
    if (method !== "GET" && method !== "HEAD" && rawBody.length > 0) {
      if (isUpload) {
        if (!contentType.startsWith("multipart/form-data")) {
          sendError(res, new ApiError("unsupported_type", "Upload the certificate as multipart/form-data."));
          return;
        }
        if (rawBody.length > UPLOAD_BODY_LIMIT) {
          sendError(res, new ApiError("payload_too_large", "That request is too large."));
          return;
        }
        body = { multipart: true };
      } else {
        if (!contentType.startsWith("application/json")) {
          sendError(res, new ApiError("unsupported_type", "Send the request as application/json."));
          return;
        }
        try {
          body = JSON.parse(rawBody.toString("utf8"));
        } catch {
          sendError(res, new ApiError("validation", "The request body is not valid JSON.", {
            fields: { body: "The request body is not valid JSON." },
          }));
          return;
        }
      }
    }
    const match = router.match(method, pathName);
    const ctx: Ctx = {
      req, res, url, method, body, rawBody,
      sessionToken: readSessionToken(req),
      params: match?.params ?? {},
    };
    if (!match) {
      sendError(res, new ApiError("not_found", "Not found."));
      return;
    }
    try {
      const result = await match.handler(ctx);
      if (result === undefined) return; // handler already responded
      if (typeof result.body === "string") {
        const payload = Buffer.from(result.body, "utf8");
        res.writeHead(result.status, {
          ...(result.headers ?? {}),
          "Content-Length": String(payload.length),
          "Cache-Control": "no-store",
        });
        res.end(payload);
        return;
      }
      if (result.status === 204) {
        res.writeHead(204, ...(result.headers ? [result.headers] : []));
        res.end();
        return;
      }
      sendJson(res, result.status, result.body, result.headers);
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, err);
        return;
      }
      console.error("unhandled", err);
      if (!res.headersSent) {
        sendError(res, new ApiError("not_found", "Not found."));
      }
    }
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  if (serveStatic(pathName, res)) return;
  if (serveSpaFallback(pathName, res)) return;
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`crosshand relay listening on :${config.port}`);
});

async function start(): Promise<void> {
  let attempt = 0;
  for (;;) {
    try {
      await seedOnce(pool);
      break;
    } catch (err) {
      attempt++;
      if (attempt > 30) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  mail.start();
  posting.start();
}
void start();
