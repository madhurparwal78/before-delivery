import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COPY } from "../shared/copy";
import { matchRoute } from "../shared/routes";
import { config } from "./config";
import { pool, one } from "./db";
import { ApiError, LockStoreError, StorageError, errorBody, linkNotFound, lockStoreUnavailable, notFound, storageUnavailable, unauthenticated, validation } from "./errors";

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  query: URLSearchParams;
  user: User;
  body: unknown;
  raw: Buffer;
  now: Date;
}

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: Uint8Array;
  headers?: Record<string, string>;
}

/** Returned by handlers that took over the response (server-sent events). */
export const STREAMED = Symbol("streamed");
type HandlerResult = Reply | typeof STREAMED;
type Handler = (ctx: Ctx) => Promise<HandlerResult>;

interface RouteOptions {
  public?: boolean;
  upload?: boolean;
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  options: RouteOptions;
}

const routes: Route[] = [];
const JSON_LIMIT = 1_000_000;
const UPLOAD_LIMIT = 10_000_000;
export const SESSION_COOKIE = "rw_session";

export function route(method: string, pattern: string, handler: Handler, options: RouteOptions = {}): void {
  const keys: string[] = [];
  const source = pattern.replace(/:([A-Za-z0-9]+)/g, (_m, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler, options });
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isViewVerify(pathname: string): boolean {
  return /^\/api\/view\/[^/]+\/scenes\/[^/]+\/verify$/.test(pathname);
}

async function readBody(req: IncomingMessage, limit: number, tooLarge: string): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new ApiError(413, "payload_too_large", tooLarge);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ApiError(413, "payload_too_large", tooLarge);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function ownOrigin(req: IncomingMessage, origin: string): boolean {
  const host = req.headers.host;
  return origin === `http://${host}` || origin === `https://${host}` || origin === new URL(config.publicUrl).origin;
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function authenticate(req: IncomingMessage, now: Date): Promise<User | null> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return null;
  const row = await one<{ id: string; email: string; display_name: string }>(
    pool,
    "SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2",
    [hashToken(token), now],
  );
  return row ? { id: row.id, email: row.email, displayName: row.display_name } : null;
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'",
};

function send(req: IncomingMessage, res: ServerResponse, status: number, body: Uint8Array | string | null, headers: Record<string, string>): void {
  const payload = body === null ? Buffer.alloc(0) : typeof body === "string" ? Buffer.from(body) : body;
  res.writeHead(status, { ...SECURITY_HEADERS, "x-server-time": new Date().toISOString(), "content-length": String(payload.length), ...headers });
  res.end(req.method === "HEAD" ? undefined : payload);
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  send(req, res, status, JSON.stringify(value), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
}

function sendError(req: IncomingMessage, res: ServerResponse, error: ApiError): void {
  sendJson(req, res, error.status, errorBody(error), error.headers);
}

function parseJson(raw: Buffer): unknown {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw validation({});
  }
}

// A path segment that is not valid percent-encoding, or that decodes to a NUL byte, names no resource.
function decodePathPart(raw: string, linkPath: boolean): string {
  const missing = (): ApiError => (linkPath ? linkNotFound() : notFound());
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw missing();
  }
  if (decoded.includes("\0")) throw missing();
  return decoded;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const isView = url.pathname.startsWith("/api/view/");
  if (isView && !["GET", "HEAD"].includes(method) && !(method === "POST" && isViewVerify(url.pathname))) {
    throw new ApiError(405, "read_only", "This link is read-only.", undefined, undefined, { allow: "GET, HEAD" });
  }
  const lookup = method === "HEAD" && isView ? "GET" : method;
  let match: RegExpMatchArray | null = null;
  const found = routes.find((r) => r.method === lookup && (match = url.pathname.match(r.pattern)) !== null);
  if (!found || !match) throw new ApiError(404, "not_found", "We couldn't find that.");
  const params: Record<string, string> = {};
  found.keys.forEach((key, i) => (params[key] = decodePathPart((match as RegExpMatchArray)[i + 1], isView || url.pathname.startsWith("/api/labs/"))));

  let raw: Buffer = Buffer.alloc(0);
  if (BODY_METHODS.has(method)) {
    raw = await readBody(req, found.options.upload ? UPLOAD_LIMIT : JSON_LIMIT, found.options.upload ? COPY.uploadTooLarge : "Send a body of 1,000,000 bytes or fewer.");
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (raw.length > 0 && type !== (found.options.upload ? "application/octet-stream" : "application/json")) {
      throw new ApiError(415, "unsupported_media_type", "Send application/json.");
    }
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const origin = req.headers.origin;
    if (typeof origin === "string" && !ownOrigin(req, origin)) throw new ApiError(403, "cross_origin", "Requests from another origin are refused.");
  }
  const now = new Date();
  const user = found.options.public ? null : await authenticate(req, now);
  if (!found.options.public && !user) throw unauthenticated();
  const ctx: Ctx = {
    req,
    res,
    url,
    method,
    params,
    query: url.searchParams,
    user: user as User,
    body: found.options.upload ? null : parseJson(raw),
    raw,
    now,
  };
  const result = await found.handler(ctx);
  if (result === STREAMED) return;
  if (result.bytes) send(req, res, result.status, result.bytes, result.headers ?? {});
  else sendJson(req, res, result.status, result.json, result.headers);
}

const CLIENT_DIR = fileURLToPath(new URL("../client/", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.includes("\0")) return false;
  const relative = path.normalize(decoded).replace(/^([/\\])+/, "");
  const file = path.join(CLIENT_DIR, relative);
  if (!file.startsWith(CLIENT_DIR) || relative === "" || relative === "index.html" || !existsSync(file) || !statSync(file).isFile()) return false;
  const type = MIME[path.extname(file)] ?? "application/octet-stream";
  const immutable = pathname.startsWith("/assets/") || pathname.startsWith("/fonts/");
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": type,
    "content-length": String(statSync(file).size),
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
  return true;
}

function servePage(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const known = matchRoute(pathname).name !== "not-found";
  const index = path.join(CLIENT_DIR, "index.html");
  send(req, res, known ? 200 : 404, readFileSync(index), { "content-type": MIME[".html"], "cache-control": "no-store" });
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      await handleApi(req, res, url);
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && serveStatic(req, res, url.pathname)) return;
    if (req.method === "GET" || req.method === "HEAD") servePage(req, res, url.pathname);
    else send(req, res, 404, readFileSync(path.join(CLIENT_DIR, "index.html")), { "content-type": MIME[".html"] });
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof ApiError) {
      sendError(req, res, error);
      return;
    }
    if (error instanceof LockStoreError) {
      sendError(req, res, lockStoreUnavailable());
      return;
    }
    if (error instanceof StorageError) {
      sendError(req, res, storageUnavailable());
      return;
    }
    process.stderr.write(`unhandled error: ${error instanceof Error ? error.message : String(error)}\n`);
    sendJson(req, res, 500, { error: { code: "internal", message: "Something went wrong on our side." } });
  }
}
