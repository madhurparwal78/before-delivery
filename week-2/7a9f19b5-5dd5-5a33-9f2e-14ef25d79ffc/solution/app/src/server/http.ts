import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { ApiError, apiError, errorCode, notFound, ProviderUnavailable } from "./errors.js";
import type { Body } from "./fields.js";
import { sessionUser, type UserRow } from "./auth.js";

const JSON_LIMIT = 100_000;
export const COVER_LIMIT = 5_000_000;
/** Room for multipart boundaries and part headers around one cover file. */
const MULTIPART_OVERHEAD = 16_384;

interface Context {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: Body;
  raw: Buffer;
  user: UserRow | null;
}

export interface JsonReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface FileReply {
  status: number;
  file: Buffer;
  contentType: string;
  headers?: Record<string, string>;
}

/** The handler wrote the response itself (the live event stream). */
export const STREAMING = Symbol("streaming");

export type Reply = JsonReply | FileReply | typeof STREAMING;

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** `user` routes answer 401 to signed-out callers; `/api/admin/` routes also refuse non-admins with 403. */
  access: "public" | "user";
  multipart?: boolean;
  handler: (ctx: Context) => Promise<Reply>;
}

interface CompiledRoute extends Route {
  pattern: RegExp;
  keys: string[];
}

export function json(status: number, body?: unknown, headers?: Record<string, string>): JsonReply {
  return { status, body, ...(headers ? { headers } : {}) };
}

function compile(route: Route): CompiledRoute {
  const keys: string[] = [];
  const source = route.path.replace(/:(\w+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { ...route, pattern: new RegExp(`^${source}$`), keys };
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Oversized bodies are read to the end (up to this many bytes) so the client receives the 413 instead of a reset. */
const DRAIN_LIMIT = 32_000_000;

/** Reads the body, counting bytes; anything over `limit` answers 413 once the client has finished sending. */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
    else if (size > Math.max(limit * 4, DRAIN_LIMIT)) {
      req.destroy();
      break;
    }
  }
  if (size > limit) throw apiError(413, "payload_too_large");
  return Buffer.concat(chunks);
}

/** A path segment that cannot be decoded, or that carries a NUL byte, names no resource. */
function pathParam(raw: string): string {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    throw notFound();
  }
  if (value.includes("\u0000")) throw notFound();
  return value;
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
}

function hasBody(req: IncomingMessage): boolean {
  return Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;
}

const appOrigin = new URL(config.publicUrl).origin;

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return origin === undefined || origin === appOrigin || origin === `http://${req.headers.host}`;
}

/** Framing, in the brief's order: 413, 415, 400 invalid_json, then 403 cross_origin. */
async function frame(req: IncomingMessage, route: CompiledRoute): Promise<{ body: Body; raw: Buffer }> {
  const empty = { body: {}, raw: Buffer.alloc(0) };
  if (!STATE_CHANGING.has(route.method)) return empty;
  if (route.multipart) {
    const raw = await readBody(req, COVER_LIMIT + MULTIPART_OVERHEAD);
    if (mediaType(req) !== "multipart/form-data") throw apiError(415, "unsupported_media_type");
    if (!sameOrigin(req)) throw apiError(403, "cross_origin");
    return { body: {}, raw };
  }
  const raw = hasBody(req) ? await readBody(req, JSON_LIMIT) : Buffer.alloc(0);
  if (raw.length && mediaType(req) !== "application/json") throw apiError(415, "unsupported_media_type");
  let body: Body = {};
  if (raw.length) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      throw apiError(400, "invalid_json");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw apiError(400, "invalid_json");
    body = parsed as Body;
  }
  if (!sameOrigin(req)) throw apiError(403, "cross_origin");
  return { body, raw };
}

function send(res: ServerResponse, reply: JsonReply | FileReply): void {
  if ("file" in reply) {
    res.writeHead(reply.status, {
      "Content-Type": reply.contentType,
      "Content-Length": reply.file.length,
      "Cache-Control": "private, no-store",
      ...reply.headers,
    });
    res.end(reply.file);
    return;
  }
  const payload = reply.body === undefined ? "" : JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    ...(payload ? { "Content-Type": "application/json; charset=utf-8" } : {}),
    "Cache-Control": "no-store",
    ...reply.headers,
  });
  res.end(payload);
}

const OUTAGE_CODES: Record<ProviderUnavailable["provider"], string> = {
  killbill: "payment_unavailable",
  minio: "storage_unavailable",
  pocketbase: "collaboration_unavailable",
};

/** The one place an API error becomes a response. */
function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof ApiError) {
    send(res, json(error.status, error.body, error.status === 413 ? { Connection: "close" } : undefined));
    return;
  }
  if (error instanceof ProviderUnavailable) {
    console.error(errorCode(error));
    send(res, json(503, { error: OUTAGE_CODES[error.provider] }));
    return;
  }
  console.error("unhandled error:", errorCode(error));
  send(res, json(500, { error: "internal_error" }));
}

export function createApi(routes: Route[]) {
  const compiled = routes.map(compile);
  return async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    try {
      let match: { route: CompiledRoute; values: string[] } | undefined;
      for (const route of compiled) {
        const found = route.method === req.method ? route.pattern.exec(url.pathname) : null;
        if (found) {
          match = { route, values: found.slice(1) };
          break;
        }
      }
      if (!match) throw notFound();
      const { route, values } = match;
      const { body, raw } = await frame(req, route);
      const user = await sessionUser(req);
      if (route.access === "user" && !user) throw apiError(401, "unauthenticated");
      if (url.pathname.startsWith("/api/admin/") && user?.role !== "admin") throw apiError(403, "forbidden");
      const params = Object.fromEntries(route.keys.map((key, index) => [key, pathParam(values[index]!)]));
      const reply = await route.handler({ req, res, url, params, body, raw, user });
      if (reply !== STREAMING) send(res, reply);
    } catch (error) {
      sendError(res, error);
    }
  };
}

// ---- Static browser assets -------------------------------------------------------------------

const CLIENT_DIR = fileURLToPath(new URL("../../client/", import.meta.url));

/** Page routes the browser app answers; anything else that is not a built asset is a 404. */
const PAGES = [
  /^\/$/,
  /^\/catalogue$/,
  /^\/compare$/,
  /^\/products\/[^/]+$/,
  /^\/favourites$/,
  /^\/cart$/,
  /^\/checkout$/,
  /^\/orders\/[^/]+$/,
  /^\/signin$/,
  /^\/signup$/,
  /^\/account$/,
  /^\/projects$/,
  /^\/projects\/[^/]+$/,
  /^\/admin$/,
  /^\/newsletter\/confirm$/,
];

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

let indexHtml: Buffer | undefined;

function page(res: ServerResponse, status: number): void {
  indexHtml ??= readFileSync(join(CLIENT_DIR, "index.html"));
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", ...SECURITY_HEADERS });
  res.end(indexHtml);
}

export function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(404, SECURITY_HEADERS).end();
    return;
  }
  const path = url.pathname;
  if (PAGES.some((pattern) => pattern.test(path))) {
    page(res, 200);
    return;
  }
  const type = TYPES[extname(path)];
  let decoded = "";
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = "";
  }
  const file = normalize(join(CLIENT_DIR, decoded.replaceAll("\u0000", "")));
  if (type && path.startsWith("/assets/") && file.startsWith(CLIENT_DIR + "assets" + sep) && existsSync(file)) {
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": statSync(file).size,
      "Cache-Control": "public, max-age=31536000, immutable",
      ...SECURITY_HEADERS,
    });
    createReadStream(file).pipe(res);
    return;
  }
  page(res, 404);
}
