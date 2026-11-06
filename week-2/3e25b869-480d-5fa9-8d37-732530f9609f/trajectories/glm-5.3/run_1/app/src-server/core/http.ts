// HTTP core: request context, the single error shape and precedence helpers,
// cookies, sessions, body validation with per-route allowed keys, and idempotency.
import { createHmac, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { Env } from "./env.js";
import type { Locale } from "./catalog.js";

export const MAX_BODY_BYTES = 65_536;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public messageOverride: string | null = null,
    public fields: Record<string, string> | null = null,
    public headers: Record<string, string> = {}
  ) {
    super(code);
  }
}

export interface Ctx {
  req: Request;
  url: URL;
  method: string;
  env: Env;
  pool: Pool;
  locale: Locale;
  cookies: Record<string, string>;
  body: unknown;
  setCookies: string[];
  responseHeaders: Record<string, string>;
}

export function readCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function cookieHeader(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean } = {}): string {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (opts.httpOnly !== false) cookie += "; HttpOnly";
  if (opts.maxAge !== undefined) cookie += `; Max-Age=${opts.maxAge}`;
  return cookie;
}

/** Resolve the active locale from the cookie, then Accept-Language. */
export function resolveLocale(cookies: Record<string, string>, acceptLanguage: string | null): Locale {
  const cookie = cookies["pdl_locale"];
  if (cookie === "fr-CA" || cookie === "en-CA") return cookie;
  if ((acceptLanguage ?? "").trim().toLowerCase().startsWith("fr")) return "fr-CA";
  return "en-CA";
}

/** Serialize any ApiError to the one published error body. */
export function errorBody(err: ApiError, locale: Locale): { status: number; body: string } {
  const error: Record<string, unknown> = { code: err.code, message: err.messageOverride ?? "" };
  if (err.code === "invalid") {
    if (!err.messageOverride) {
      error.message = locale === "fr-CA" ? "Vérifiez ces champs." : "Check these fields.";
    }
    if (err.fields) {
      const sorted: Record<string, string> = {};
      for (const key of Object.keys(err.fields).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        sorted[key] = err.fields[key];
      }
      error.fields = sorted;
    }
  }
  return { status: err.status, body: JSON.stringify({ error }) };
}

// ---- request body reading with the boundary checks ----

export async function readJsonBody(req: Request): Promise<unknown> {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;
  const hasBody = req.headers.get("content-length") !== null || req.headers.get("transfer-encoding") !== null;
  if (!hasBody) return {};
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type");
  }
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large");
  }
  const text = new TextDecoder().decode(buffer);
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(415, "unsupported_media_type");
  }
}

export function checkOrigin(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (origin === null) return;
  let ownOrigin: string;
  try {
    ownOrigin = new URL(req.url).origin;
  } catch {
    return;
  }
  if (origin !== ownOrigin) {
    throw new ApiError(403, "cross_origin");
  }
}

// ---- body shape: allowed keys per route ----

export type FieldKind = "cant_set" | "wrong_type" | "missing";

export interface FieldSpecEntry {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  fields?: Record<string, FieldSpecEntry>;
  items?: Record<string, FieldSpecEntry>;
}

export interface ShapeResult {
  values: Record<string, unknown>;
  errors: Record<string, FieldKind>;
}

/**
 * Walk a parsed body against the route's allowed keys. Any key outside the
 * specification is reported at its dotted path with kind "cant_set", so the
 * route can answer 422 and change nothing.
 */
export function checkShape(body: unknown, spec: Record<string, FieldSpecEntry>): ShapeResult {
  const result: ShapeResult = { values: {}, errors: {} };
  collect(body, spec, result, "");
  return result;
}

function collect(value: unknown, spec: Record<string, FieldSpecEntry>, result: ShapeResult, prefix: string): void {
  if (value === undefined || value === null) value = {};
  if (typeof value !== "object" || Array.isArray(value)) {
    for (const [key, entry] of Object.entries(spec)) {
      if (entry.required) {
        result.errors[pathFor(prefix, key)] = "missing";
      }
    }
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const entry = spec[key];
    const path = pathFor(prefix, key);
    if (!entry) {
      result.errors[path] = "cant_set";
      continue;
    }
    const kind = typeCheck(obj[key], entry);
    if (kind) {
      result.errors[path] = kind;
      continue;
    }
    const inner = obj[key];
    if (entry.type === "object" && entry.fields && typeof inner === "object" && inner !== null) {
      const sub: ShapeResult = { values: {}, errors: {} };
      collect(inner, entry.fields, sub, path);
      for (const [subPath, subValue] of Object.entries(sub.values)) {
        result.values[subPath] = subValue;
      }
      for (const [subPath, subKind] of Object.entries(sub.errors)) {
        result.errors[subPath] = subKind;
      }
      result.values[path] = sub.values;
    } else if (entry.type === "array" && entry.items && Array.isArray(inner)) {
      const cleaned: unknown[] = [];
      inner.forEach((item, index) => {
        const itemPath = `${path}.${index}`;
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          result.errors[itemPath] = "wrong_type";
          return;
        }
        const sub: ShapeResult = { values: {}, errors: {} };
        collect(item, entry.items!, sub, itemPath);
        for (const [subPath, subKind] of Object.entries(sub.errors)) {
          result.errors[subPath] = subKind;
        }
        const plain: Record<string, unknown> = {};
        for (const [subPath, subValue] of Object.entries(sub.values)) {
          plain[subPath.slice(itemPath.length + 1)] = subValue;
        }
        cleaned.push(plain);
      });
      result.values[path] = cleaned;
    } else {
      result.values[path] = inner;
    }
  }
  for (const [key, entry] of Object.entries(spec)) {
    if (entry.required && obj[key] === undefined) {
      result.errors[pathFor(prefix, key)] = "missing";
    }
  }
}

function pathFor(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

function typeCheck(value: unknown, entry: FieldSpecEntry): FieldKind | null {
  switch (entry.type) {
    case "string":
      return typeof value === "string" ? null : "wrong_type";
    case "number":
      return typeof value === "number" ? null : "wrong_type";
    case "boolean":
      return typeof value === "boolean" ? null : "wrong_type";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value) ? null : "wrong_type";
    case "array":
      return Array.isArray(value) ? null : "wrong_type";
  }
}

/** Read a validated value at its dotted path. */
export function shapeValue(result: ShapeResult, path: string): unknown {
  return result.values[path];
}

// ---- sessions ----

export const SESSION_COOKIE_CUSTOMER = "pdl_session";
export const SESSION_COOKIE_STAFF = "pdl_staff";

export interface SessionRow {
  token: string;
  customer_id: number | null;
  staff_id: number | null;
  kind: string;
  expires_at: Date;
}

function signToken(raw: string, secret: string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

async function loadSessionByCookie(ctx: Ctx, cookieName: string, kind: string): Promise<SessionRow | null> {
  const raw = ctx.cookies[cookieName];
  if (!raw) return null;
  const res = await ctx.pool.query(
    "SELECT * FROM sessions WHERE token = $1 AND kind = $2 AND expires_at > now()",
    [signToken(raw, ctx.env.sessionSecret), kind]
  );
  return (res.rows[0] as SessionRow | undefined) ?? null;
}

export function loadCustomerSession(ctx: Ctx): Promise<SessionRow | null> {
  return loadSessionByCookie(ctx, SESSION_COOKIE_CUSTOMER, "customer");
}

export function loadStaffSession(ctx: Ctx): Promise<SessionRow | null> {
  return loadSessionByCookie(ctx, SESSION_COOKIE_STAFF, "staff");
}

export async function createSession(ctx: Ctx, kind: string, customerId: number | null, staffId: number | null): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await ctx.pool.query(
    "INSERT INTO sessions (token, customer_id, staff_id, kind, expires_at) VALUES ($1, $2, $3, $4, now() + interval '12 hours')",
    [signToken(raw, ctx.env.sessionSecret), customerId, staffId, kind]
  );
  return raw;
}

export async function destroySession(ctx: Ctx, cookieName: string, kind: string): Promise<void> {
  const raw = ctx.cookies[cookieName];
  if (!raw) return;
  await ctx.pool.query("DELETE FROM sessions WHERE token = $1 AND kind = $2", [
    signToken(raw, ctx.env.sessionSecret), kind
  ]);
}

// ---- idempotency ----

const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function idempotencyKey(ctx: Ctx): string {
  const header = ctx.req.headers.get("idempotency-key");
  if (header === null) {
    throw new ApiError(400, "idempotency_key_required");
  }
  if (!IDEMPOTENCY_RE.test(header)) {
    throw new ApiError(400, "idempotency_key_invalid");
  }
  return header;
}

export function requestHash(body: unknown): string {
  return createHmac("sha256", "idempotency").update(stableStringify(body)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

interface IdempotencyRow {
  key: string;
  request_hash: string;
  status: number;
  body: string | null;
  in_progress: boolean;
  created_at: Date;
}

/** Register or replay an idempotency key. Returns the stored response when it replays. */
export async function beginIdempotency(ctx: Ctx, scope: string, key: string, body: unknown): Promise<string | null> {
  const hash = requestHash(body);
  const res = await ctx.pool.query(
    "SELECT * FROM idempotency WHERE scope = $1 AND key = $2",
    [scope, key]
  );
  const row = res.rows[0] as IdempotencyRow | undefined;
  if (!row) {
    await ctx.pool.query(
      "INSERT INTO idempotency (scope, key, request_hash, status, body, in_progress) VALUES ($1, $2, $3, 0, NULL, true)",
      [scope, key, hash]
    );
    return null;
  }
  if (row.in_progress && Date.now() - row.created_at.getTime() < 60_000) {
    throw new ApiError(409, "request_in_progress");
  }
  if (row.request_hash !== hash) {
    throw new ApiError(409, "idempotency_key_reused");
  }
  if (row.status === 0 || row.body === null) {
    return null;
  }
  return JSON.stringify({ status: row.status, body: row.body });
}

export async function finishIdempotency(ctx: Ctx, scope: string, key: string, status: number, body: string): Promise<void> {
  const store = (status >= 200 && status < 300) ||
    status === 409 || status === 410 || status === 412 || status === 422;
  if (store) {
    await ctx.pool.query(
      "UPDATE idempotency SET status = $3, body = $4, in_progress = false WHERE scope = $1 AND key = $2",
      [scope, key, status, body]
    );
  } else {
    await ctx.pool.query("DELETE FROM idempotency WHERE scope = $1 AND key = $2", [scope, key]);
  }
}
