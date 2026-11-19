import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { JSON_LIMIT_BYTES, MULTIPART_EXTRA_BYTES, config } from "../config";
import { now, plusSeconds, syncClock } from "../clock";
import { lockKey, pool, transaction, type TxHandle } from "../db";
import { memberBySession } from "../services/auth";
import type { MemberRow } from "../services/views";
import { ApiError, apiErrors, respondError } from "./errors";

interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
  /** Computed after COMMIT (mail attempts) so the answer reports their outcome. */
  finalize?: () => Promise<unknown>;
}

export interface Ctx {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  member: MemberRow | null;
  /** Parsed JSON body, undefined when the request had none. */
  body: unknown;
  /** Raw body bytes for multipart routes. */
  raw: Buffer;
  db: TxHandle;
  idempotencyKey: string | null;
  sessionToken: string | null;
}

/**
 * The order in which a request is judged; the first failing stage answers:
 * size and type (413, 415), session (401), lookup (404), role (403), idempotent replay, limit (429),
 * state conflicts (409), input (422), dependency (503, raised while running).
 */
interface RouteDef<Loaded> {
  method: "GET" | "POST" | "PATCH";
  pattern: string;
  auth?: "member" | "public" | "grading";
  body?: "json" | "multipart";
  idempotent?: boolean;
  /** Run in a transaction even for GET (a read that settles due state). */
  transactional?: boolean;
  load?: (ctx: Ctx) => Promise<Loaded>;
  role?: (ctx: Ctx, loaded: Loaded) => void;
  limit?: (ctx: Ctx, loaded: Loaded) => Promise<void>;
  conflicts?: (ctx: Ctx, loaded: Loaded) => Promise<void>;
  validate?: (ctx: Ctx, loaded: Loaded) => Promise<void>;
  run: (ctx: Ctx, loaded: Loaded) => Promise<Reply>;
}

export interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handle: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>;
}

/** An idempotency key is kept for 24 hours of server time. */
const KEY_KEPT_SECONDS = 24 * 3600;

export const SESSION_COOKIE = "ls_session";

export function readSession(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > limit) {
      reject(apiErrors.payloadTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners("data");
        reject(apiErrors.payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => reject(apiErrors.payloadTooLarge()));
  });
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** PostgreSQL refuses a NUL byte in text, so a body that holds one is invalid input, not a server fault. */
function holdsNul(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (Array.isArray(value)) return value.some(holdsNul);
  if (value && typeof value === "object") return Object.entries(value).some(([key, inner]) => holdsNul(key) || holdsNul(inner));
  return false;
}

function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

function send(res: ServerResponse, reply: Reply, body: unknown): void {
  const payload = reply.raw ?? (body === undefined ? "" : JSON.stringify(body));
  const bytes = typeof payload === "string" ? Buffer.from(payload) : payload;
  res.writeHead(reply.status, {
    "content-type": reply.contentType ?? "application/json; charset=utf-8",
    "content-length": bytes.length,
    "cache-control": "no-store",
    ...reply.headers,
  });
  res.end(bytes);
}

function bodyToText(reply: Reply): string {
  return JSON.stringify(reply.body ?? null);
}

export function route<Loaded = void>(def: RouteDef<Loaded>): Route {
  const names: string[] = [];
  const source = def.pattern.replace(/:([a-z]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  const writes = def.method !== "GET";
  const auth = def.auth ?? "member";

  const judge = async (ctx: Ctx): Promise<Reply> => {
    const loaded = (await def.load?.(ctx)) as Loaded;
    def.role?.(ctx, loaded);
    const requestHash = createHash("sha256").update(stable(ctx.body ?? null)).digest("hex");
    if (def.idempotent && ctx.idempotencyKey && ctx.member) {
      await lockKey(ctx.db, `${ctx.member.id}|${ctx.url.pathname}|${ctx.idempotencyKey}`);
      await ctx.db.query("DELETE FROM idempotency_keys WHERE member_id = $1 AND path = $2 AND key = $3 AND created_at <= $4", [
        ctx.member.id, ctx.url.pathname, ctx.idempotencyKey, plusSeconds(now(), -KEY_KEPT_SECONDS),
      ]);
      const { rows } = await ctx.db.query<{ request_hash: string; status: number; body: string }>(
        "SELECT request_hash, status, body FROM idempotency_keys WHERE member_id = $1 AND path = $2 AND key = $3",
        [ctx.member.id, ctx.url.pathname, ctx.idempotencyKey],
      );
      const stored = rows[0];
      if (stored) {
        if (stored.request_hash !== requestHash) throw apiErrors.idempotencyConflict();
        return { status: stored.status, body: JSON.parse(stored.body), headers: { "idempotent-replay": "true" } };
      }
    }
    await def.limit?.(ctx, loaded);
    await def.conflicts?.(ctx, loaded);
    if (holdsNul(ctx.body)) throw apiErrors.validation({ body: "Text cannot hold NUL characters." });
    if (def.idempotent && !ctx.idempotencyKey) throw apiErrors.validation({ idempotency_key: "Send an Idempotency-Key header." });
    await def.validate?.(ctx, loaded);
    const reply = await def.run(ctx, loaded);
    if (def.idempotent && ctx.idempotencyKey && ctx.member && reply.status >= 200 && reply.status < 300) {
      await ctx.db.query(
        "INSERT INTO idempotency_keys (member_id, path, key, request_hash, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [ctx.member.id, ctx.url.pathname, ctx.idempotencyKey, requestHash, reply.status, bodyToText(reply), now()],
      );
    }
    return reply;
  };

  const handle: Route["handle"] = async (req, res, params) => {
    try {
      const limit = def.body === "multipart" ? config.idDocMaxBytes + MULTIPART_EXTRA_BYTES : JSON_LIMIT_BYTES;
      const raw = writes ? await readBody(req, limit) : Buffer.alloc(0);
      let body: unknown;
      if (writes && raw.length > 0 && def.body !== "multipart") {
        if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw apiErrors.unsupportedMediaType();
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          throw apiErrors.validation({ body: "Send valid JSON." });
        }
      }
      if (writes && crossOrigin(req)) throw apiErrors.forbidden();
      await syncClock(pool);
      const url = new URL(req.url ?? "/", "http://placeholder");
      const token = readSession(req);
      const member = token ? ((await memberBySession(pool, token)) ?? null) : null;
      if (auth === "grading") {
        const supplied = req.headers["x-grading-token"];
        if (!config.gradingToken || supplied !== config.gradingToken) throw apiErrors.notFound();
      } else if (auth === "member" && !member) {
        throw apiErrors.unauthenticated();
      }
      const key = req.headers["idempotency-key"];
      const idempotencyKey = typeof key === "string" && key.length >= 1 && key.length <= 100 ? key : null;
      const base = { req, url, params, member, body, raw, idempotencyKey, sessionToken: token };
      let reply: Reply;
      if (writes || def.transactional) {
        reply = await transaction((db) => judge({ ...base, db }));
      } else {
        const reader: TxHandle = { query: (text, values) => pool.query(text, values), afterCommit: () => undefined };
        reply = await judge({ ...base, db: reader });
      }
      const finalBody = reply.finalize ? await reply.finalize() : reply.body;
      send(res, reply, finalBody);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 413) res.setHeader("connection", "close");
        respondError(res, error);
        return;
      }
      console.error(`request failed: ${error instanceof Error ? error.name : "unknown error"}`);
      respondError(res, apiErrors.internal());
    }
  };

  return { method: def.method, pattern: new RegExp(`^${source}$`), names, handle };
}
