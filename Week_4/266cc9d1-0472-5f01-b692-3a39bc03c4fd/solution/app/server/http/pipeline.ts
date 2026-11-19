// The request pipeline. The brief's error precedence is decided here and nowhere else:
//   1. 413 / 415 (body limits and type)       — readBody
//   2. authentication (401, or 404/410 links)  — route.identify
//   3. a reused Idempotency-Key                — claim
//   4. 404 unknown or out-of-scope resource    — phases.load
//   5. 403 wrong role or cross-origin          — authorize
//   6. 409 state conflicts                     — phases.conflict
//   7. 422 validation                          — wellFormed + phases.validate
//   8. 503 storage unavailable                 — phases.perform
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { staffFromRequest, linkFromToken, type LinkAccess, type Staff, type StaffRole } from "../auth.js";
import { config } from "../config.js";
import { inTransaction, pool, type Db } from "../db.js";
import { markUnderReview } from "../domain/findingsSet.js";
import { claim, settle, validKey, type IdempotencyScope } from "../idempotency.js";
import { StorageUnreachable } from "../storage.js";
import { ApiError, fail } from "./errors.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type BodyKind = "none" | "json" | "manifest" | "file";

const BODY_LIMITS: Record<BodyKind, number> = { none: 65_536, json: 65_536, manifest: 2_000_000, file: 50_000_000 };

export interface BaseContext {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  json: Record<string, unknown>;
  bytes: Buffer;
  db: Db;
  malformed: Record<string, string> | null;
}
export interface StaffContext extends BaseContext {
  staff: Staff;
}
export interface ReviewContext extends BaseContext {
  link: LinkAccess;
}

export interface Reply {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string | string[]>;
  stream?: ReadableStream<Uint8Array>;
}

/** Work that must wait for the commit (sending email) and then shapes the response. */
interface Deferred {
  afterCommit: () => Promise<Reply>;
}
type Outcome = Reply | Deferred;

export function json(status: number, body: unknown, headers: Record<string, string | string[]> = {}): Reply {
  return { status, json: body, headers };
}

export function errorReply(error: ApiError): Reply {
  return { status: error.status, json: error.body() };
}

interface Phases<C, L, V> {
  method: Method;
  path: string;
  body?: BodyKind;
  idempotent?: boolean;
  role?: StaffRole;
  load: (ctx: C) => Promise<L>;
  conflict?: (ctx: C, loaded: L) => Promise<void> | void;
  validate: (ctx: C, loaded: L) => V | Promise<V>;
  perform: (ctx: C, loaded: L, input: V) => Promise<Outcome>;
}

interface Identity {
  scope: string;
  run: (base: BaseContext) => Promise<Outcome>;
}

export interface Route {
  method: Method;
  pattern: RegExp;
  names: string[];
  body: BodyKind;
  idempotent: boolean;
  identify: (req: IncomingMessage) => Promise<Identity>;
}

export const noInput = (): undefined => undefined;

/** A path segment as text, or a 404 when it does not decode or holds a NUL (no lookup can match it). */
function pathParam(raw: string): string {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    throw fail.notFound();
  }
  if (value.includes("\u0000")) throw fail.notFound();
  return value;
}

function compile(path: string): { pattern: RegExp; names: string[] } {
  const names: string[] = [];
  const source = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        names.push(segment.slice(1));
        return "([^/]+)";
      }
      if (segment.startsWith("*")) {
        names.push(segment.slice(1));
        return "(.+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { pattern: new RegExp(`^${source}$`), names };
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const own = [new URL(config.publicUrl).origin];
  if (req.headers.host !== undefined) own.push(`http://${req.headers.host}`);
  return own.includes(origin);
}

function authorize(ctx: BaseContext, role: StaffRole | undefined, staff: Staff | null): void {
  if (role !== undefined && staff !== null && staff.role !== role) throw fail.forbidden();
  if (ctx.req.method !== "GET" && !sameOrigin(ctx.req)) throw fail.crossOrigin();
}

async function phased<C extends BaseContext, L, V>(
  ctx: C,
  phases: Phases<C, L, V>,
  staff: Staff | null,
): Promise<Outcome> {
  const loaded = await phases.load(ctx);
  authorize(ctx, phases.role, staff);
  await phases.conflict?.(ctx, loaded);
  if (ctx.malformed !== null) throw fail.validation(ctx.malformed);
  const input = await phases.validate(ctx, loaded);
  return phases.perform(ctx, loaded, input);
}

function routeOf(phases: { method: Method; path: string; body?: BodyKind; idempotent?: boolean }, identify: Route["identify"]): Route {
  const { pattern, names } = compile(phases.path);
  const body = phases.body ?? (phases.method === "GET" || phases.method === "DELETE" ? "none" : "json");
  return { method: phases.method, pattern, names, body, idempotent: phases.idempotent ?? false, identify };
}

export function publicRoute<L, V>(phases: Phases<BaseContext, L, V>): Route {
  return routeOf(phases, async () => ({ scope: "public", run: (base) => phased(base, phases, null) }));
}

export function staffRoute<L, V>(phases: Phases<StaffContext, L, V>): Route {
  return routeOf(phases, async (req) => {
    const staff = await staffFromRequest(req);
    if (staff === null) throw fail.unauthenticated();
    return { scope: `tenant:${staff.tenantId}`, run: (base) => phased({ ...base, staff }, phases, staff) };
  });
}

export function reviewRoute<L, V>(phases: Phases<ReviewContext, L, V>): Route {
  return routeOf(phases, async (req) => {
    const token = /^\/api\/review\/([^/]+)/.exec(new URL(req.url ?? "/", "http://x").pathname)?.[1] ?? "";
    const link = await linkFromToken(pathParam(token));
    return {
      scope: `link:${link.linkId}`,
      run: async (base) => {
        const outcome = await phased({ ...base, link }, phases, null);
        await markUnderReview(base.db, link.setId);
        return outcome;
      },
    };
  });
}

interface ReadBody {
  bytes: Buffer;
  tooLarge: boolean;
}

async function readBody(req: IncomingMessage, limit: number): Promise<ReadBody> {
  const declared = Number(req.headers["content-length"] ?? "0");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk instanceof Buffer ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size <= limit) chunks.push(piece);
  }
  return { bytes: Buffer.concat(chunks), tooLarge: size > limit || declared > limit };
}

function parseJson(bytes: Buffer): { json: Record<string, unknown>; malformed: Record<string, string> | null } {
  if (bytes.length === 0) return { json: {}, malformed: null };
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return { json: value as Record<string, unknown>, malformed: null };
    }
  } catch {
    // fall through: reported as a validation failure at step 7
  }
  return { json: {}, malformed: { body: "Send a JSON object." } };
}

function isJsonType(req: IncomingMessage): boolean {
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}

export async function writeReply(res: ServerResponse, reply: Reply): Promise<void> {
  const headers: Record<string, string | string[]> = { "cache-control": "no-store", ...reply.headers };
  if (reply.stream !== undefined) {
    res.writeHead(reply.status, headers);
    await new Promise<void>((resolve, reject) => {
      const stream = Readable.fromWeb(reply.stream as import("node:stream/web").ReadableStream<Uint8Array>);
      stream.on("error", reject);
      res.on("finish", resolve);
      res.on("close", resolve);
      stream.pipe(res);
    });
    return;
  }
  if (reply.json === undefined && reply.text === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const body = reply.text ?? JSON.stringify(reply.json);
  res.writeHead(reply.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    ...headers,
  });
  res.end(body);
}

function replyText(reply: Reply): string {
  return reply.text ?? JSON.stringify(reply.json ?? null);
}

/** Runs the phases (inside one transaction unless the route only reads), then any post-commit work. */
async function execute(route: Route, identity: Identity, base: Omit<BaseContext, "db">): Promise<Reply> {
  const run = (db: Db): Promise<Outcome> => identity.run({ ...base, db });
  const outcome = route.method === "GET" ? await run(pool) : await inTransaction(run);
  return "afterCommit" in outcome ? outcome.afterCommit() : outcome;
}

export function createHandler(routes: Route[], fallback: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      await fallback(req, res);
      return;
    }
    let idempotency: IdempotencyScope | null = null;
    try {
      const method = req.method ?? "GET";
      let matched: { route: Route; params: Record<string, string> } | null = null;
      for (const route of routes) {
        if (route.method !== method) continue;
        const found = route.pattern.exec(url.pathname);
        if (found === null) continue;
        const params: Record<string, string> = {};
        route.names.forEach((name, i) => {
          params[name] = pathParam(found[i + 1] ?? "");
        });
        matched = { route, params };
        break;
      }
      if (matched === null) {
        for await (const chunk of req) void chunk;
        throw fail.notFound();
      }
      const { route, params } = matched;

      const body = await readBody(req, BODY_LIMITS[route.body]);
      if (body.tooLarge) throw fail.payloadTooLarge();
      const parsesJson = route.body === "json" || route.body === "manifest";
      if (parsesJson && body.bytes.length > 0 && !isJsonType(req)) throw fail.unsupportedMediaType();
      const parsed = parsesJson ? parseJson(body.bytes) : { json: {}, malformed: null };

      const identity = await route.identify(req);

      const key = req.headers["idempotency-key"];
      let malformed = parsed.malformed;
      if (route.idempotent && typeof key === "string") {
        if (validKey(key)) {
          idempotency = { scope: identity.scope, route: `${method} ${url.pathname}`, key };
          const claimed = await claim(idempotency, parsed.json);
          if (claimed.kind === "replay") {
            idempotency = null;
            await writeReply(res, { status: claimed.status, text: claimed.body });
            return;
          }
        } else {
          malformed = { ...malformed, "Idempotency-Key": "Use 1 to 128 visible ASCII characters." };
        }
      }

      const reply = await execute(route, identity, {
        req,
        params,
        query: url.searchParams,
        json: parsed.json,
        bytes: body.bytes,
        malformed,
      });
      if (idempotency !== null) await settle(idempotency, reply.status, replyText(reply));
      await writeReply(res, reply);
    } catch (error) {
      const apiError =
        error instanceof ApiError ? error : error instanceof StorageUnreachable ? fail.storageUnavailable() : null;
      if (apiError === null) console.error(error);
      const reply = errorReply(apiError ?? new ApiError(500, "internal_error", "Something went wrong."));
      if (idempotency !== null) await settle(idempotency, reply.status, replyText(reply)).catch(() => undefined);
      if (!res.headersSent) await writeReply(res, reply);
      else res.destroy();
    }
  };
}
