// The request pipeline. Every API request passes the brief's precedence order (brief: API,
// Precedence): origin, session, idempotency replay, not found, role, boundary, then the handler's
// validation, state and provider checks. Every error body comes from ApiError.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import type { Role } from "../shared/kitchen";
import { pool, lockKey, one, type Db } from "./db";
import { ApiError, ProviderError, forbidden, notFound, validation } from "./errors";
import { sessionUser, type SessionUser } from "./sessions";

export const JSON_CAP = 65_536;
export const UPLOAD_CAP = 5_100_000;

export interface Reply {
  status: number;
  json?: unknown;
  file?: { body: Buffer; contentType: string; disposition?: string };
  headers?: Record<string, string>;
}

export interface Ctx<L = undefined> {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  nowMs: number;
  user: SessionUser;
  loaded: L;
  body: Buffer;
  contentType: string;
  json: Record<string, unknown>;
}

export interface RouteSpec<L> {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  /** Who may use the route; "public" needs no session. */
  roles: readonly Role[] | "public";
  body?: "json" | "multipart";
  idempotent?: boolean;
  /** Step 4: resolves the IDs in the path, scoped to the caller's tenant, or throws not found. */
  load?: (ctx: Ctx<undefined>) => Promise<L>;
  handle: (ctx: Ctx<L>) => Promise<Reply>;
}

type Handler = (ctx: Ctx<undefined>) => Promise<Reply>;

export interface Route extends Pick<RouteSpec<unknown>, "method" | "roles" | "body" | "idempotent"> {
  pattern: RegExp;
  names: string[];
  /** Runs step 4 and answers with the handler bound to what it loaded. */
  open(ctx: Ctx<undefined>): Promise<Handler>;
}

/** Compiles the path pattern and binds the route's loaded record to its handler. */
export function route<L = undefined>(spec: RouteSpec<L>): Route {
  const names: string[] = [];
  const source = spec.path.replace(/:([a-z_]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return {
    method: spec.method,
    roles: spec.roles,
    body: spec.body,
    idempotent: spec.idempotent,
    pattern: new RegExp(`^${source}$`),
    names,
    async open(ctx) {
      const loaded = spec.load ? await spec.load(ctx) : (undefined as L);
      return (final) => spec.handle({ ...final, loaded });
    },
  };
}

const INSPECT_PATH = /^\/api\/inspect\//;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,100}$/;
const STORED_STATUSES = new Set([200, 201, 409, 410, 422]);

export function apiHandler(routes: Route[]) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL, body: { data: Buffer; tooLarge: boolean }): Promise<void> => {
    let reply: Reply;
    try {
      reply = await run(routes, req, url, body);
    } catch (error) {
      reply = errorReply(error);
    }
    send(res, reply);
  };
}

function errorReply(error: unknown): Reply {
  if (error instanceof ProviderError) error = error.toApiError();
  if (error instanceof ApiError) return { status: error.status, json: error.body(), headers: error.headers };
  console.error(error);
  return { status: 500, json: new ApiError(500, "internal_error", "Something went wrong. Try again in a moment.").body() };
}

async function run(routes: Route[], req: IncomingMessage, url: URL, body: { data: Buffer; tooLarge: boolean }): Promise<Reply> {
  const method = req.method ?? "GET";
  // 1. Same-origin only for state-changing requests.
  const origin = req.headers.origin;
  if (["POST", "PUT", "DELETE"].includes(method) && origin !== undefined && origin !== `http://${req.headers.host}`) {
    throw new ApiError(403, "cross_origin", "Requests from another site are refused.");
  }
  const path = url.pathname;
  const matches = routes
    .map((r) => ({ r, m: r.pattern.exec(path) }))
    .filter((x): x is { r: Route; m: RegExpExecArray } => x.m !== null);
  const ctx: Ctx<undefined> = {
    req,
    params: {},
    query: url.searchParams,
    nowMs: Date.now(),
    user: undefined as unknown as SessionUser,
    loaded: undefined,
    body: body.data,
    contentType: req.headers["content-type"] ?? "",
    json: {},
  };
  // 2. A live session for everything except the public paths, unknown paths included.
  const inspection = INSPECT_PATH.test(path);
  if (!inspection && !matches.some((x) => x.r.roles === "public")) {
    ctx.user = await signedIn(req);
  }
  if (matches.length === 0) throw notFound();
  const match = matches.find((x) => x.r.method === method);
  if (!match) {
    if (inspection) throw new ApiError(405, "read_only", "Inspection links are read-only.", {}, { Allow: "GET" });
    throw new ApiError(405, "method_not_allowed", "That method isn't allowed here.", {}, { Allow: [...new Set(matches.map((x) => x.r.method))].join(", ") });
  }
  const { r: route } = match;
  ctx.params = Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(match.m[i + 1])]));
  // A path shared by a public route (POST /api/session) still needs a session for its other methods.
  if (route.roles !== "public" && !ctx.user) {
    ctx.user = await signedIn(req);
  }
  // 3. A repeated Idempotency-Key gets its stored response; a second one in flight waits for the first.
  const key = req.headers["idempotency-key"];
  if (route.idempotent && typeof key === "string" && IDEMPOTENCY_KEY.test(key)) {
    return withKey(ctx, method, path, key, route, body);
  }
  return proceed(ctx, route, body);
}

async function signedIn(req: IncomingMessage): Promise<SessionUser> {
  const user = await sessionUser(req);
  if (!user) throw new ApiError(401, "unauthenticated", "Your session ended. Sign in again.");
  return user;
}

async function proceed(ctx: Ctx<undefined>, route: Route, body: { data: Buffer; tooLarge: boolean }): Promise<Reply> {
  // 4. Unknown IDs and other tenants' IDs answer the same not found.
  const handle = await route.open(ctx);
  // 5. The caller's role.
  if (route.roles !== "public" && !route.roles.includes(ctx.user.role)) throw forbidden();
  // 6. Boundary: idempotency key, size and body type.
  if (route.idempotent && !IDEMPOTENCY_KEY.test(String(ctx.req.headers["idempotency-key"] ?? ""))) {
    throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header of 1 to 100 visible characters.");
  }
  if (route.body === "multipart") {
    if (!/^multipart\/form-data\b/i.test(ctx.contentType)) throw unsupportedMedia();
    if (body.tooLarge) throw new ApiError(413, "file_too_large", "That file is larger than the upload limit.");
  }
  if (route.body === "json") {
    if (body.tooLarge) throw new ApiError(413, "body_too_large", "That request is too large.");
    if (!/^application\/json\b/i.test(ctx.contentType)) throw unsupportedMedia();
    ctx.json = parseJsonObject(body.data);
  }
  return handle(ctx);
}

function unsupportedMedia(): ApiError {
  return new ApiError(415, "unsupported_media_type", "That kind of content isn't accepted.");
}

function parseJsonObject(data: Buffer): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(data.toString("utf8") || "{}");
  } catch {
    throw validation({ body: "Send a JSON object." });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw validation({ body: "Send a JSON object." });
  return value as Record<string, unknown>;
}

/** Canonical JSON (keys sorted at every depth) so key order never makes two bodies differ. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function fingerprint(data: Buffer): string {
  let canonical: string;
  try {
    canonical = canonicalJson(JSON.parse(data.toString("utf8") || "{}"));
  } catch {
    canonical = data.toString("utf8");
  }
  return createHash("sha256").update(canonical).digest("hex");
}

async function withKey(ctx: Ctx<undefined>, method: string, path: string, key: string, route: Route, body: { data: Buffer; tooLarge: boolean }): Promise<Reply> {
  const lock = await pool.connect();
  const lockId = lockKey("idempotency", ctx.user.id, method, path, key);
  try {
    await lock.query("SELECT pg_advisory_lock($1::bigint)", [lockId]);
    const print = fingerprint(body.data);
    const stored = await one<{ request_fingerprint: string; status: number; body: unknown }>(
      lock,
      "SELECT request_fingerprint, status, body FROM stored_responses WHERE user_id = $1 AND method = $2 AND path = $3 AND idempotency_key = $4",
      [ctx.user.id, method, path, key],
    );
    if (stored) {
      if (stored.request_fingerprint !== print) {
        throw new ApiError(409, "idempotency_conflict", "This request was already sent with different details.");
      }
      return { status: stored.status, json: stored.body };
    }
    let reply: Reply;
    try {
      reply = await proceed(ctx, route, body);
    } catch (error) {
      reply = errorReply(error);
    }
    if (STORED_STATUSES.has(reply.status)) {
      await storeResponse(lock, ctx.user.id, method, path, key, print, reply);
    }
    return reply;
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1::bigint)", [lockId]).catch(() => undefined);
    lock.release();
  }
}

async function storeResponse(db: Db, userId: string, method: string, path: string, key: string, print: string, reply: Reply): Promise<void> {
  await db.query(
    "INSERT INTO stored_responses (user_id, method, path, idempotency_key, request_fingerprint, status, body) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [userId, method, path, key, print, reply.status, JSON.stringify(reply.json ?? null)],
  );
}

export function send(res: ServerResponse, reply: Reply): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
  if (reply.file) {
    res.setHeader("Content-Type", reply.file.contentType);
    if (reply.file.disposition) res.setHeader("Content-Disposition", reply.file.disposition);
    res.writeHead(reply.status).end(reply.file.body);
    return;
  }
  if (reply.json === undefined) {
    res.writeHead(reply.status).end();
    return;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(reply.status).end(JSON.stringify(reply.json));
}

/** Content-Disposition with a header-safe quoted name, plus the UTF-8 form when the name needs it. */
export function disposition(kind: "attachment" | "inline", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const header = `${kind}; filename="${ascii}"`;
  return ascii === fileName ? header : `${header}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
