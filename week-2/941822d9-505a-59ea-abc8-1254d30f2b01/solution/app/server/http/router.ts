import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { ApiError, fail } from "./errors.js";
import { userForSession, type SessionUser } from "../domain/users.js";

const BODY_LIMIT = 65_536;
export const SESSION_COOKIE = "credwell_session";

export interface Ctx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
  user: SessionUser | null;
  /** The origin of this request, used for absolute links in emails. */
  origin: string;
  /** The request instant: every "at the request instant" rule compares against it. */
  now: Date;
}

export type SignedInCtx = Ctx & { user: SessionUser };

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface BaseRoute {
  method: Method;
  pattern: RegExp;
  keys: string[];
  /** Verification capabilities: responses are uncached and sent without a referrer. */
  capability?: (query: URLSearchParams) => boolean;
  head?: boolean;
}

export type Route =
  | (BaseRoute & { access: "session"; handle: (ctx: SignedInCtx) => Promise<Reply> })
  | (BaseRoute & { access: "public"; handle: (ctx: Ctx) => Promise<Reply> });

type RouteOptions = Pick<BaseRoute, "capability" | "head">;

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path
    .split("/")
    .map((segment) =>
      segment.replace(/:([a-z_]+)|[.]/g, (_match, key: string | undefined) => {
        if (key === undefined) return "\\.";
        keys.push(key);
        return "([^/]+?)";
      }),
    )
    .join("/");
  return { pattern: new RegExp(`^${source}$`), keys };
}

export function signedIn(method: Method, path: string, handle: (ctx: SignedInCtx) => Promise<Reply>, options: RouteOptions = {}): Route {
  return { method, ...compile(path), access: "session", handle, ...options };
}

export function open(method: Method, path: string, handle: (ctx: Ctx) => Promise<Reply>, options: RouteOptions = {}): Route {
  return { method, ...compile(path), access: "public", handle, ...options };
}

export const CAPABILITY_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

function send(res: ServerResponse, reply: Reply, extraHeaders: Record<string, string> = {}): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...reply.headers, ...extraHeaders };
  if (reply.bytes) {
    res.writeHead(reply.status, { ...headers, "Content-Type": reply.contentType ?? "application/octet-stream", "Content-Length": String(reply.bytes.length) });
    res.end(reply.bytes);
  } else if (reply.json === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
  } else {
    const payload = Buffer.from(JSON.stringify(reply.json), "utf8");
    res.writeHead(reply.status, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": String(payload.length) });
    res.end(payload);
  }
}

const errorReply = (error: ApiError): Reply => ({ status: error.status, json: error.body });

interface RawBody {
  size: number;
  bytes: Buffer;
}

async function readBody(req: IncomingMessage): Promise<RawBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size <= BODY_LIMIT) chunks.push(piece);
    else if (size > BODY_LIMIT * 64) {
      req.destroy();
      break;
    }
  }
  return { size, bytes: Buffer.concat(chunks) };
}

const WRITES = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Boundary checks in the brief's order: 413, 415, 400 invalid_json, then the cross-origin 403. */
async function boundary(req: IncomingMessage, method: string, ownOrigin: string): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (raw.size > BODY_LIMIT) throw fail(413, "payload_too_large");
  let body: Record<string, unknown> = {};
  if (raw.size > 0) {
    const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") throw fail(415, "unsupported_media_type");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.bytes.toString("utf8"));
    } catch {
      throw fail(400, "invalid_json");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw fail(400, "invalid_json");
    body = parsed as Record<string, unknown>;
  }
  const origin = req.headers.origin;
  if (WRITES.has(method) && origin !== undefined && origin !== ownOrigin) throw fail(403, "cross_origin");
  return body;
}

export function sessionToken(headers: IncomingHttpHeaders): string | null {
  for (const part of (headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Dispatches one /api request through the brief's precedence: 405, boundary, 401, then the handler (404…503). */
export async function dispatch(routes: Route[], req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const candidates = routes.filter((r) => r.pattern.test(url.pathname));
  const capability = candidates.find((r) => r.capability)?.capability;
  const extra = capability?.(url.searchParams) ? { ...CAPABILITY_HEADERS } : {};
  if (candidates.length === 0) return send(res, errorReply(fail(404, "not_found")));
  const route = candidates.find((r) => r.method === method || (method === "HEAD" && r.method === "GET" && r.head === true));
  if (!route) {
    req.resume();
    return send(res, errorReply(fail(405, "method_not_allowed")), extra);
  }
  const host = req.headers.host ?? "";
  const ctx: Ctx = {
    method,
    path: url.pathname,
    params: {},
    query: url.searchParams,
    headers: req.headers,
    body: {},
    user: null,
    origin: `http://${host}`,
    now: new Date(),
  };
  try {
    ctx.body = await boundary(req, method, ctx.origin);
    const match = route.pattern.exec(url.pathname);
    // A path id that is not valid UTF-8 or holds a NUL names no record: 404 at step 4, after the 401 check.
    let unknownParam = false;
    route.keys.forEach((key, index) => {
      try {
        ctx.params[key] = decodeURIComponent(match?.[index + 1] ?? "");
      } catch {
        ctx.params[key] = "";
        unknownParam = true;
      }
      if (ctx.params[key]?.includes("\u0000")) unknownParam = true;
    });
    const token = sessionToken(req.headers);
    ctx.user = token === null ? null : await userForSession(token);
    let reply: Reply;
    if (route.access === "session") {
      const user = ctx.user;
      if (user === null) throw fail(401, "unauthenticated");
      if (unknownParam) throw fail(404, "not_found");
      reply = await route.handle({ ...ctx, user });
    } else {
      if (unknownParam) throw fail(404, "not_found");
      reply = await route.handle(ctx);
    }
    send(res, reply, extra);
  } catch (error) {
    if (error instanceof ApiError) return send(res, errorReply(error), extra);
    console.error(`${method} ${url.pathname} failed:`, error instanceof Error ? error.stack ?? error.message : String(error));
    send(res, errorReply(fail(500, "internal_error")), extra);
  }
}
