// The request pipeline. Every API request runs the same ordered checks:
//   1. 413 payload_too_large, 415 unsupported_media_type, 403 cross_origin
//   2. 401 unauthenticated   3. 403 forbidden   4. idempotency (422 / replay / 409)
//   then the handler, which decides 404 → 428/412 → 409 → 422 → 503 in that order.
// Every error leaves through `ApiError` / `FieldErrors` and `send`, so there is one error shape.
import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userFromCookie, type User, type Role } from "./auth.ts";
import { withIdempotency } from "./domain/idempotency.ts";
import { ServiceDown } from "./services/serviceDown.ts";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly extra: Record<string, unknown> = {}) {
    super(code);
  }
}

export class FieldErrors extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("validation");
  }
}

export const notFound = () => new ApiError(404, "not_found");

let origin = "";
/** The origin people reach this instance on, fixed by the first request it serves; mail links use it. */
export const appOrigin = () => origin;

export type UploadedFile = { filename: string; data: Buffer };
export type Upload = { fields: Record<string, string>; file: UploadedFile | null };

export type Ctx = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  user: User | null;
  body: unknown;
  upload: Upload;
};

export type Reply = {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
};

export type SignedInCtx = Ctx & { user: User };

type Access = "public" | "signed-in" | readonly Role[];

type Route = {
  method: string;
  pattern: RegExp;
  keys: string[];
  access: Access;
  multipartLimit: number | null;
  idempotent: boolean;
  handle: (ctx: Ctx) => Promise<Reply>;
};

const JSON_LIMIT = 100_000;
const MULTIPART_ENVELOPE = 64 * 1024;
const routes: Route[] = [];

type RouteOptions = { multipartLimit?: number; idempotent?: boolean };

export function route(method: string, path: string, access: "public", handle: (ctx: Ctx) => Promise<Reply>, options?: RouteOptions): void;
export function route(method: string, path: string, access: "signed-in" | readonly Role[], handle: (ctx: SignedInCtx) => Promise<Reply>, options?: RouteOptions): void;
export function route(method: string, path: string, access: Access, handle: (ctx: SignedInCtx) => Promise<Reply>, options: RouteOptions = {}): void {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/:([a-zA-Z]+)/g, (_, key: string) => { keys.push(key); return "([^/]+)"; }) + "$");
  routes.push({
    method, pattern, keys, access,
    multipartLimit: options.multipartLimit ?? null,
    idempotent: options.idempotent ?? false,
    handle: handle as (ctx: Ctx) => Promise<Reply>,
  });
}

export const ok = (body: unknown, status = 200): Reply => ({ status, body });

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": payload.length, ...headers });
  res.end(payload);
}

export function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) return { status: error.status, body: { error: error.code, ...error.extra } };
  if (error instanceof FieldErrors) return { status: 422, body: { errors: error.errors } };
  if (error instanceof ServiceDown) {
    return { status: 503, body: { error: error.service === "killbill" ? "payment_unavailable" : "storage_unavailable" } };
  }
  console.error(error);
  return { status: 500, body: { error: "internal_error" } };
}

function sendReply(res: ServerResponse, reply: Reply): void {
  if (reply.bytes) {
    res.writeHead(reply.status, { "Content-Type": reply.contentType ?? "application/octet-stream", "Content-Length": reply.bytes.length, ...reply.headers });
    res.end(reply.bytes);
  } else if (reply.body === undefined) {
    res.writeHead(reply.status, reply.headers ?? {});
    res.end();
  } else writeJson(res, reply.status, reply.body, reply.headers);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) {
    req.resume();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(raw: Buffer, boundary: string, fileLimit: number): Upload | "too_large" {
  const delimiter = Buffer.from(`--${boundary}`);
  const upload: Upload = { fields: {}, file: null };
  let start = raw.indexOf(delimiter);
  while (start >= 0) {
    const next = raw.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    const part = raw.subarray(start + delimiter.length + 2, next - 2);
    start = next;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const head = part.subarray(0, headerEnd).toString("utf8");
    const data = part.subarray(headerEnd + 4);
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    if (filename !== undefined) {
      if (data.length > fileLimit) return "too_large";
      upload.file = { filename, data: Buffer.from(data) };
    } else if (name) upload.fields[name] = data.toString("utf8");
  }
  return upload;
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A path id that is malformed or carries a NUL byte names no record. Postgres refuses NUL in text, so it
 * becomes a character no id contains and the lookup answers not_found at its place in the precedence. */
function pathParam(raw: string): string {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return raw;
  }
  return value.replaceAll("\0", "�");
}

function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || !STATE_CHANGING.has(req.method ?? "")) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method === "HEAD" ? "GET" : req.method ?? "GET";
  let params: Record<string, string> = {};
  const found = routes.find((candidate) => {
    if (candidate.method !== method) return false;
    const m = candidate.pattern.exec(url.pathname);
    if (!m) return false;
    params = Object.fromEntries(candidate.keys.map((key, i) => [key, pathParam(m[i + 1]!)]));
    return true;
  });
  if (!found) {
    req.resume();
    return sendReply(res, errorReply(notFound()));
  }

  // 1. Size, media type and origin.
  const limit = found.multipartLimit === null ? JSON_LIMIT : found.multipartLimit + MULTIPART_ENVELOPE;
  const raw = await readBody(req, limit);
  if (raw === null) return sendReply(res, errorReply(new ApiError(413, "payload_too_large")));
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  let body: unknown = undefined;
  let upload: Upload = { fields: {}, file: null };
  if (found.multipartLimit !== null) {
    const boundary = /^multipart\/form-data;.*boundary="?([^";]+)"?/i.exec(req.headers["content-type"] ?? "")?.[1];
    if (!boundary) return sendReply(res, errorReply(new ApiError(415, "unsupported_media_type")));
    const parsed = parseMultipart(raw, boundary, found.multipartLimit);
    if (parsed === "too_large") return sendReply(res, errorReply(new ApiError(413, "payload_too_large")));
    upload = parsed;
  } else if (raw.length > 0 || (contentType && STATE_CHANGING.has(method))) {
    if (!/^application\/json\s*(;|$)/.test(contentType)) return sendReply(res, errorReply(new ApiError(415, "unsupported_media_type")));
  }
  if (crossOrigin(req)) return sendReply(res, errorReply(new ApiError(403, "cross_origin")));

  // 2–3. Who is calling, and may their role use this route.
  const user = await userFromCookie(req.headers.cookie);
  if (found.access !== "public") {
    if (!user) return sendReply(res, errorReply(new ApiError(401, "unauthenticated")));
    if (found.access !== "signed-in" && !found.access.includes(user.role)) {
      return sendReply(res, errorReply(new ApiError(403, "forbidden")));
    }
  }

  let invalidJson = false;
  if (raw.length > 0 && found.multipartLimit === null) {
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      invalidJson = true;
    }
  }
  if (!origin && req.headers.host) origin = `http://${req.headers.host}`;
  const ctx: Ctx = {
    method, path: url.pathname, params, query: url.searchParams, headers: req.headers, user, body, upload,
  };
  const run = async (): Promise<Reply> => {
    if (invalidJson) return errorReply(new FieldErrors({ body: "invalid_json" }));
    try {
      return await found.handle(ctx);
    } catch (error) {
      return errorReply(error);
    }
  };

  // 4. Idempotency, then the handler.
  const reply = found.idempotent ? await withIdempotency(ctx, raw.toString("utf8"), run) : await run();
  sendReply(res, reply);
}

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../client");
const PAGE_ROUTES = /^\/(signin|register|tickets|orders\/[^/]+|studio|curate|box-office|finance|group|admin)?\/?$/;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

function serveFile(res: ServerResponse, file: string, cacheForever: boolean, head: boolean): void {
  const size = statSync(file).size;
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Content-Length": size,
    "Cache-Control": cacheForever ? "public, max-age=31536000, immutable" : "no-cache",
    ...SECURITY_HEADERS,
  });
  if (head) res.end();
  else createReadStream(file).pipe(res);
}

function handleStatic(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const head = req.method === "HEAD";
  if (req.method !== "GET" && !head) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return void res.end("Not found");
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(CLIENT_DIR, relative);
  const isAsset = file.startsWith(CLIENT_DIR + "/") && !file.endsWith(".map") && !relative.endsWith("index.html");
  if (isAsset) {
    try {
      if (statSync(file).isFile()) return serveFile(res, file, relative.startsWith("/assets/"), head);
    } catch {
      // not a built asset: fall through to the page routes
    }
  }
  if (PAGE_ROUTES.test(url.pathname)) return serveFile(res, join(CLIENT_DIR, "index.html"), false, head);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
  res.end("Not found");
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else handleStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendReply(res, errorReply(error));
    else res.end();
  }
}
