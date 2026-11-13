import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { JSON_LIMIT_BYTES, UPLOAD_LIMIT_BYTES } from "../shared/schemas.js";
import { databaseReady, isConnectionFailure } from "./db.js";
import { declaredLength, readBody } from "./body.js";
import { ApiError, apiError, notFound, payloadTooLarge, validationFailed } from "./errors.js";
import { parseJson } from "./json.js";

export type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Ctx = { req: IncomingMessage; res: ServerResponse; params: Record<string, string>; query: URLSearchParams; body: Buffer };
export type Route = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: string;
  upload?: boolean;
  public?: boolean;
  handle: (ctx: Ctx) => Promise<Reply | "streamed">;
};

const JSON_TYPE = "application/json; charset=utf-8";
const CLIENT_DIR = path.resolve(import.meta.dirname, "../../client");
const PAGES = /^\/(host(\/.*)?|stage\/[^/]+|play\/[^/]+)?$/;
const STATIC_DIRS = ["/assets/", "/fonts/"];
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: http: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function sendJson(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, "cache-control": "no-store", ...(body === undefined ? {} : { "content-type": JSON_TYPE }), ...headers });
  res.end(payload);
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split("/");
  const have = pathname.split("/");
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of want.entries()) {
    const actual = have[i] as string;
    if (part.startsWith(":")) params[part.slice(1)] = actual;
    else if (part !== actual) return null;
  }
  return params;
}

export function jsonBody(ctx: Ctx): unknown {
  const parsed = parseJson(ctx.body.toString("utf8"));
  if (parsed === undefined) throw validationFailed({ body: "Send a JSON body" });
  return parsed;
}

function refuseCrossOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host !== req.headers.host) throw apiError(403, "cross_origin");
}

function replyError(res: ServerResponse, req: IncomingMessage, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const failure = error instanceof ApiError ? error : isConnectionFailure(error) ? apiError(503, "database_unavailable") : apiError(500, "internal_error");
  if (failure.status === 500) console.error(error);
  const tooLarge = failure.status === 413;
  sendJson(res, failure.status, failure.body, tooLarge ? { connection: "close" } : {});
  if (tooLarge) {
    req.resume();
    setTimeout(() => req.destroy(), 3000).unref();
  }
}

async function serveFile(res: ServerResponse, file: string, immutable: boolean, head: boolean): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (head) res.end();
  else createReadStream(file).pipe(res);
  return true;
}

async function serveClient(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const head = req.method === "HEAD";
  if (req.method === "GET" || head) {
    if (PAGES.test(pathname) && (await serveFile(res, path.join(CLIENT_DIR, "index.html"), false, head))) return;
    const target = path.join(CLIENT_DIR, pathname);
    const inside = target.startsWith(CLIENT_DIR + path.sep);
    if (inside && STATIC_DIRS.some((dir) => pathname.startsWith(dir)) && (await serveFile(res, target, true, head))) return;
  }
  replyError(res, req, notFound());
}

async function serveApi(req: IncomingMessage, res: ServerResponse, url: URL, routes: Route[]): Promise<void> {
  let matched: { route: Route; params: Record<string, string> } | null = null;
  for (const route of routes) {
    const params = route.method === req.method ? matchPattern(route.pattern, url.pathname) : null;
    if (params) {
      matched = { route, params };
      break;
    }
  }
  if (!matched) throw notFound();
  const { route, params } = matched;
  const changesState = route.method !== "GET";
  if (changesState) refuseCrossOrigin(req);
  if (changesState && declaredLength(req) > (route.upload ? UPLOAD_LIMIT_BYTES : JSON_LIMIT_BYTES)) throw payloadTooLarge();
  const body = changesState && !route.upload ? await readBody(req, JSON_LIMIT_BYTES) : Buffer.alloc(0);
  if (!route.public && !databaseReady()) throw apiError(503, "database_unavailable");
  const reply = await route.handle({ req, res, params, query: url.searchParams, body });
  if (reply !== "streamed") sendJson(res, reply.status, reply.body, reply.headers);
}

export function createHttpServer(routes: Route[]): Server {
  return createServer((req, res) => {
    const url = new URL(req.url as string, `http://${req.headers.host}`);
    const work = url.pathname.startsWith("/api/") ? serveApi(req, res, url, routes) : serveClient(req, res, url.pathname);
    work.catch((error: unknown) => replyError(res, req, error));
  });
}
