// The HTTP boundary: routing, the error shape and its precedence, body limits, content types,
// same-origin checks, sessions and the static client.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Role, User } from "../shared/api";
import { one, pool } from "./db";

const JSON_LIMIT = 65_536;
const PHOTO_LIMIT = 5_000_000;
const DRAIN_LIMIT = 64 * 1024 * 1024;

type ErrorCode =
  | "bad_json" | "unauthenticated" | "invalid_credentials" | "card_declined" | "payment_failed" | "cross_origin"
  | "forbidden" | "not_found" | "already_held" | "board_state" | "hold_not_active" | "ticket_state" | "offcut_not_cut"
  | "lineage_cycle" | "idempotency_conflict" | "too_large" | "unsupported_media_type" | "validation"
  | "unsupported_version" | "wrong_board" | "billing_unavailable" | "storage_unavailable";

const STATUS: Record<ErrorCode, number> = {
  bad_json: 400, unauthenticated: 401, invalid_credentials: 401, card_declined: 402, payment_failed: 402,
  cross_origin: 403, forbidden: 403, not_found: 404, already_held: 409, board_state: 409, hold_not_active: 409,
  ticket_state: 409, offcut_not_cut: 409, lineage_cycle: 409, idempotency_conflict: 409, too_large: 413,
  unsupported_media_type: 415, validation: 422, unsupported_version: 422, wrong_board: 422,
  billing_unavailable: 503, storage_unavailable: 503,
};

const MESSAGES: Record<ErrorCode, string> = {
  bad_json: "The body is not valid JSON.",
  unauthenticated: "Sign in first.",
  invalid_credentials: "That email and password don't match.",
  card_declined: "The card was declined.",
  payment_failed: "Billing did not confirm the payment.",
  cross_origin: "Requests from another origin are refused.",
  forbidden: "Your role may not use this route.",
  not_found: "Not found.",
  already_held: "The board already has a hold.",
  board_state: "The board's status does not allow this.",
  hold_not_active: "The hold is no longer active.",
  ticket_state: "The ticket's status does not allow this.",
  offcut_not_cut: "The offcut's cut ticket is not done.",
  lineage_cycle: "A board cannot be its own ancestor.",
  idempotency_conflict: "This key was used for a different request.",
  too_large: "The body is too large.",
  unsupported_media_type: "Unsupported content type.",
  validation: "Some fields are not valid.",
  unsupported_version: "This layout file is from a newer version.",
  wrong_board: "This layout file is for another board.",
  billing_unavailable: "Billing is unreachable.",
  storage_unavailable: "Photo storage is unreachable.",
};

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, readonly fields?: Record<string, string>) {
    super(MESSAGES[code]);
    this.status = STATUS[code];
  }

  body(): { error: string; message: string; fields?: Record<string, string> } {
    return this.fields ? { error: this.code, message: this.message, fields: this.fields } : { error: this.code, message: this.message };
  }
}

/** Collects per-field validation messages and throws once, as one 422. */
export class Fields {
  readonly errors: Record<string, string> = {};
  add(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }
  get empty(): boolean {
    return Object.keys(this.errors).length === 0;
  }
  throwIfAny(): void {
    if (!this.empty) throw new ApiError("validation", this.errors);
  }
}

export interface Reply {
  status: number;
  body?: unknown;
  raw?: { bytes: Buffer; contentType: string; headers?: Record<string, string> };
  cookie?: string;
}

export interface Context {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  raw: Buffer;
  contentType: string;
  /** The signed-in person, or null. */
  user: User | null;
  sessionToken: string | null;
}

type Handler = (ctx: Context) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  kind: "json" | "photo";
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, pathPattern: string, handler: Handler, kind: "json" | "photo" = "json"): void {
  const keys: string[] = [];
  const source = pathPattern.replace(/:([a-z_]+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, kind, handler });
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function requireUser(ctx: Context): User {
  if (ctx.user === null) throw new ApiError("unauthenticated");
  return ctx.user;
}

/** Step 5 of the precedence: the signed-in role may not use this route. */
export function requireRole(user: User, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw new ApiError("forbidden");
}

export const isStaff = (user: User | null): boolean => user !== null && (user.role === "owner" || user.role === "hand");

export const ok = (body: unknown, status = 200): Reply => ({ status, body });

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    ...extra,
  });
  res.end(text);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | "too_large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) over = true;
    if (!over) chunks.push(buf);
    if (size > DRAIN_LIMIT) {
      req.destroy();
      break;
    }
  }
  return over ? "too_large" : Buffer.concat(chunks);
}

function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

export const SESSION_COOKIE = "kerfwell_session";

async function sessionUser(token: string | null): Promise<User | null> {
  if (token === null || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await one<User>(pool,
    "SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1", [token]);
  return row ?? null;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host;
  return host !== undefined && (origin === `http://${host}` || origin === `https://${host}`);
}

const STATIC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const STATIC_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};
const CLIENT_ROUTES = [/^\/$/, /^\/sign-in$/, /^\/account$/, /^\/yard$/, /^\/owner$/, /^\/boards\/[^/]+$/, /^\/tickets\/[^/]+$/];
const STATIC_FILES = /^\/(assets\/app\.js|styles\.css|favicon\.svg|fonts\/[a-z0-9-]+\.woff2)$/;

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const isFile = STATIC_FILES.test(pathname);
  const isPage = CLIENT_ROUTES.some((r) => r.test(pathname));
  const file = path.join(STATIC_ROOT, isFile ? pathname : "index.html");
  const info = await stat(file);
  res.writeHead(isFile || isPage ? 200 : 404, {
    "Content-Type": STATIC_TYPES[path.extname(file)] ?? "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": isFile ? "public, max-age=3600" : "no-cache",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

// A path segment that is not valid percent-encoding, or decodes to a control character, names no record.
function decodeParam(segment: string): string {
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    throw new ApiError("not_found");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new ApiError("not_found");
  return value;
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url ?? "/", "http://app.invalid");
  const method = req.method ?? "GET";
  try {
    if (!url.pathname.startsWith("/api/")) {
      if (method !== "GET" && method !== "HEAD") throw new ApiError("not_found");
      await serveStatic(req, res, url.pathname);
      return;
    }
    // 1. Boundary checks: origin, size, content type, JSON.
    const changes = method === "POST" || method === "PUT" || method === "DELETE";
    if (changes && !sameOrigin(req)) throw new ApiError("cross_origin");
    let matched: Route | undefined;
    let params: Record<string, string> = {};
    for (const r of routes) {
      const m = r.method === method ? r.pattern.exec(url.pathname) : null;
      if (m) {
        matched = r;
        params = Object.fromEntries(r.keys.map((k, i) => [k, decodeParam(m[i + 1] ?? "")]));
        break;
      }
    }
    const raw = await readBody(req, matched?.kind === "photo" ? PHOTO_LIMIT : JSON_LIMIT);
    if (raw === "too_large") throw new ApiError("too_large");
    if (matched === undefined) throw new ApiError("not_found");
    const contentType = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    let body: unknown = null;
    if (method === "POST" || method === "PUT") {
      if (matched.kind === "photo") {
        if (contentType !== "image/jpeg" && contentType !== "image/png") throw new ApiError("unsupported_media_type");
      } else {
        if (contentType !== "application/json") throw new ApiError("unsupported_media_type");
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          throw new ApiError("bad_json");
        }
      }
    }
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE) ?? null;
    const ctx: Context = { req, url, params, body, raw, contentType, user: await sessionUser(token), sessionToken: token };
    const reply = await matched.handler(ctx);
    const extra: Record<string, string> = reply.cookie ? { "Set-Cookie": reply.cookie } : {};
    if (reply.raw) {
      res.writeHead(reply.status, {
        "Content-Type": reply.raw.contentType,
        "Content-Length": reply.raw.bytes.length,
        "Cache-Control": "no-store",
        ...reply.raw.headers,
      });
      res.end(reply.raw.bytes);
    } else if (reply.body === undefined) {
      res.writeHead(reply.status, extra);
      res.end();
    } else {
      sendJson(res, reply.status, reply.body, extra);
    }
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error instanceof ApiError) {
      sendJson(res, error.status, error.body());
      return;
    }
    console.error(`${method} ${url.pathname} failed:`, error);
    sendJson(res, 500, { error: "internal", message: "Something went wrong." });
  }
}
