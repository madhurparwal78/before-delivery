import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SESSION_COOKIE, sessionMember, type Member } from "../auth.js";
import { one, pool } from "../db.js";
import { accessRemoved, ApiError, badRequest, bodyTooLarge, conflict, forbidden, internalError, notFound, sendError, sessionEnded } from "./errors.js";
import { parseMultipart, type Multipart } from "./multipart.js";
import type { Fields } from "./validate.js";

// One request pipeline for every API endpoint, in the brief's error precedence:
// 1 body limit, 2 session, 3 removed access, 4 idempotent replay; the handler then checks
// 5 not found, 6 role, 7 state, 8 validation, 9 rate limit and 10 provider outage in that order,
// throwing ApiError, which this file alone turns into the response body.

type Auth = "member" | "optional" | "public";
type BodyKind = "json" | "multipart" | "csv";

const LIMITS: Record<BodyKind, number> = { json: 65_536, multipart: 10_100_000, csv: 1_000_000 };

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer | string;
  headers?: Record<string, string>;
}

type Handler = (ctx: Ctx) => Promise<Reply>;

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: Auth;
  handler: Handler;
  body?: BodyKind;
  idempotent?: boolean;
}

export const ok = (json: unknown, status = 200, headers: Record<string, string> = {}): Reply => ({ status, json, headers });
export const noContent = (headers: Record<string, string> = {}): Reply => ({ status: 204, headers });

const RETRY_KEY_COPY = "Retry key is missing; reload and try again.";
const PRINTABLE_KEY = /^[\x20-\x7e]{1,100}$/;

export class Ctx {
  member: Member | null = null;
  sessionToken: string | null = null;
  idempotencyKey: string | null = null;
  /** True when a CSV body ran past its limit; the handler answers file_too_large at validation. */
  oversize = false;
  private parsedJson: { value: unknown } | null | undefined;

  constructor(
    readonly req: IncomingMessage,
    readonly params: Record<string, string>,
    readonly query: URLSearchParams,
    readonly raw: Buffer,
  ) {}

  /** The signed-in member on a `member` route. */
  get me(): Member {
    if (!this.member) throw sessionEnded();
    return this.member;
  }

  header(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  /** The JSON body. An unparsable body is the step-8 400 bad_request, so handlers read it after their lookups. */
  json(): unknown {
    if (this.parsedJson === undefined) {
      const text = this.raw.toString("utf8").trim();
      try {
        this.parsedJson = { value: text ? JSON.parse(text) : {} };
      } catch {
        this.parsedJson = null;
      }
    }
    if (this.parsedJson === null) throw badRequest();
    return this.parsedJson.value;
  }

  multipart(): Multipart {
    const parsed = parseMultipart(this.raw, this.header("content-type") ?? "");
    if (!parsed) throw badRequest();
    return parsed;
  }

  /** Adds the missing-retry-key error on an idempotent endpoint (step 8). */
  requireIdempotencyKey(fields: Fields): void {
    if (this.idempotencyKey === null) fields.fail("idempotencyKey", RETRY_KEY_COPY);
  }
}

interface Compiled {
  route: Route;
  pattern: RegExp;
  names: string[];
}

export class Router {
  private readonly compiled: Compiled[] = [];

  constructor(routes: Route[]) {
    for (const route of routes) {
      const names: string[] = [];
      const source = route.path.replace(/[.]/g, "\\.").replace(/:([a-zA-Z]+)/g, (_, name: string) => {
        names.push(name);
        return "([^/]+?)";
      });
      this.compiled.push({ route, pattern: new RegExp(`^${source}$`), names });
    }
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | "method" | null {
    let pathMatched = false;
    for (const { route, pattern, names } of this.compiled) {
      const found = pattern.exec(path);
      if (!found) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      names.forEach((name, index) => (params[name] = decodeURIComponent(found[index + 1])));
      return { route, params };
    }
    return pathMatched ? "method" : null;
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const found = this.match(req.method ?? "GET", url.pathname);
    if (found === null || found === "method") {
      sendError(res, notFound());
      return;
    }
    const { route, params } = found;
    let ctx: Ctx | undefined;
    try {
      const kind = route.body ?? "json";
      const limit = LIMITS[kind];
      const declared = Number(req.headers["content-length"] ?? 0);
      // 1. Body over the endpoint's limit, before the body is read (a CSV import answers file_too_large later).
      if (kind !== "csv" && declared > limit) throw bodyTooLarge(limit);
      const { body, overflow } = await readBody(req, limit);
      if (overflow && kind !== "csv") throw bodyTooLarge(limit);
      ctx = new Ctx(req, params, url.searchParams, body);
      ctx.oversize = overflow;
      await authenticate(ctx, route.auth);
      if (route.method !== "GET" && !sameOrigin(req)) throw forbidden();
      // 4. Idempotent replay.
      if (route.idempotent) {
        const replayed = await replay(ctx);
        if (replayed) {
          send(res, replayed);
          return;
        }
      }
      const reply = await route.handler(ctx);
      if (route.idempotent && ctx.idempotencyKey && ctx.member && reply.status >= 200 && reply.status < 300) {
        await pool.query(
          `INSERT INTO idempotency_keys (member_id, key, request_hash, status, body) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (member_id, key) DO NOTHING`,
          [ctx.member.id, ctx.idempotencyKey, requestHash(ctx), reply.status, JSON.stringify(reply.json ?? null)]);
      }
      send(res, reply);
    } catch (error) {
      if (!(error instanceof ApiError)) console.error(`${req.method} ${url.pathname} failed:`, error);
      sendError(res, error instanceof ApiError ? error : internalError());
    }
  }
}

async function authenticate(ctx: Ctx, auth: Auth): Promise<void> {
  if (auth === "public") return;
  const token = readCookie(ctx.header("cookie"), SESSION_COOKIE);
  ctx.sessionToken = token;
  const member = token ? await sessionMember(pool, token) : undefined;
  if (auth === "optional") {
    ctx.member = member && member.status === "active" ? member : null;
    return;
  }
  // 2. No valid session. 3. Removed member.
  if (!member) throw sessionEnded();
  if (member.status === "removed") throw accessRemoved();
  ctx.member = member;
}

async function replay(ctx: Ctx): Promise<Reply | null> {
  const key = ctx.header("idempotency-key");
  if (key === undefined || !PRINTABLE_KEY.test(key) || !ctx.member) return null;
  ctx.idempotencyKey = key;
  const stored = await one<{ request_hash: string; status: number; body: unknown }>(pool,
    `SELECT request_hash, status, body FROM idempotency_keys
     WHERE member_id = $1 AND key = $2 AND created_at > now() - interval '24 hours'`, [ctx.member.id, key]);
  if (!stored) {
    await pool.query("DELETE FROM idempotency_keys WHERE member_id = $1 AND key = $2", [ctx.member.id, key]);
    return null;
  }
  if (stored.request_hash !== requestHash(ctx)) throw conflict("idempotency_key_reused");
  return { status: stored.status, json: stored.body };
}

/** The request body compared as JSON with key order ignored. */
function requestHash(ctx: Ctx): string {
  let canonical: string;
  try {
    canonical = stableJson(ctx.json());
  } catch {
    canonical = ctx.raw.toString("base64");
  }
  return createHash("sha256").update(`${ctx.req.url}\n${canonical}`).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || origin === "null") return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

async function readBody(req: IncomingMessage, limit: number): Promise<{ body: Buffer; overflow: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > limit) overflow = true;
    else chunks.push(piece);
  }
  return { body: Buffer.concat(chunks), overflow };
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...reply.headers };
  if (reply.json !== undefined) {
    res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", ...headers });
    res.end(JSON.stringify(reply.json));
    return;
  }
  res.writeHead(reply.status, headers);
  res.end(reply.body ?? "");
}
