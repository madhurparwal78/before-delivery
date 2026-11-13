import { createHash, randomBytes } from "node:crypto";
import { Readable, pipeline } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { type Viewer, viewerOf } from "./bookings.js";
import { type Db, one, pool, transaction } from "./db.js";
import { ApiError, apiErrors } from "./errors.js";
import { FIELD_MESSAGES } from "./messages.js";

const JSON_LIMIT_BYTES = 65_536;
const UPLOAD_REQUEST_LIMIT_BYTES = 10_100_000;
const SESSION_COOKIE = "relayline_session";
export const SESSION_LIFETIME_HOURS = 12;
const DRAIN_CAP_BYTES = 64 * 1024 * 1024;

export interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer;
  /** A body streamed from storage, `length` bytes long; the stream is cancelled when the client leaves. */
  stream?: ReadableStream<Uint8Array>;
  length?: number;
  headers?: Record<string, string | string[]>;
}

export interface Ctx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: Buffer;
  nowMs: number;
  db: Db;
  token: string | null;
  /** Queues work that must only run once the request's transaction has committed. */
  afterCommit(work: () => void): void;
  /** The JSON request body as an object; anything else is a validation error. */
  json(): Record<string, unknown>;
}

export interface AuthedCtx extends Ctx {
  user: Viewer;
}

export interface PublicCtx extends Ctx {
  user: Viewer | null;
}

interface RouteOptions {
  /** Whether the route needs a signed-in caller. Defaults to true. */
  public?: boolean;
  /** Whether the whole request runs in one transaction. Defaults to true for every method but GET. */
  transactional?: boolean;
  /** Whether the route accepts an Idempotency-Key. Defaults to true for POST. */
  idempotent?: boolean;
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: (ctx: PublicCtx) => Promise<Reply>;
  options: RouteOptions;
}

const routes: Route[] = [];

function register(method: string, path: string, handler: (ctx: PublicCtx) => Promise<Reply>, options: RouteOptions): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:([a-z_]+)/g, (_match, key: string) => {
      keys.push(key);
      return "([^/]+)";
    })}$`,
  );
  routes.push({ method, pattern, keys, handler, options });
}

/** A route for signed-in callers; the pipeline has already refused everyone else. */
export function route(method: string, path: string, handler: (ctx: AuthedCtx) => Promise<Reply>, options: RouteOptions = {}): void {
  register(
    method,
    path,
    (ctx) => {
      if (ctx.user === null) throw apiErrors.unauthenticated();
      return handler({ ...ctx, user: ctx.user });
    },
    options,
  );
}

export function publicRoute(method: string, path: string, handler: (ctx: PublicCtx) => Promise<Reply>, options: RouteOptions = {}): void {
  register(method, path, handler, { ...options, public: true });
}

export const ok = (body: unknown): Reply => ({ status: 200, body });
export const created = (body: unknown): Reply => ({ status: 201, body });

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export const hashToken = (token: string): string => sha256(token);

export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: sha256(token) };
}

export const sessionCookie = (token: string): string =>
  `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_LIFETIME_HOURS * 3600}`;
export const clearedSessionCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

function cookieToken(headers: IncomingHttpHeaders): string | null {
  const header = headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || null;
  }
  return null;
}

async function signedInUser(token: string | null): Promise<Viewer | null> {
  if (token === null) return null;
  const user = await one<{ id: string; name: string; email: string; role: Viewer["role"]; org_id: string | null }>(
    pool,
    `SELECT u.id, u.name, u.email, u.role, u.org_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  return user === null ? null : viewerOf(pool, user);
}

interface BodyRead {
  body: Buffer;
  tooLarge: boolean;
  /** The client closed the connection before the whole body arrived. */
  cutOff: boolean;
}

/** Reads a request body up to `limit` bytes; anything beyond is consumed and thrown away so the reply can still be sent. */
function readBody(request: IncomingMessage, limit: number): Promise<BodyRead> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    request.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received <= limit) chunks.push(chunk);
      else if (received > limit + DRAIN_CAP_BYTES) request.destroy();
    });
    request.on("end", () => resolve({ body: Buffer.concat(chunks), tooLarge: received > limit, cutOff: false }));
    request.on("error", () => resolve({ body: Buffer.alloc(0), tooLarge: false, cutOff: !request.complete }));
    request.on("close", () => resolve({ body: Buffer.alloc(0), tooLarge: received > limit, cutOff: !request.complete }));
  });
}

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { "cache-control": "no-store", "x-content-type-options": "nosniff", ...reply.headers };
  if (reply.stream !== undefined) {
    if (response.destroyed) {
      void reply.stream.cancel();
      return;
    }
    response.writeHead(reply.status, { ...headers, "content-length": String(reply.length) });
    pipeline(Readable.fromWeb(reply.stream as WebReadableStream<Uint8Array>), response, () => undefined);
    return;
  }
  if (reply.raw !== undefined) {
    response.writeHead(reply.status, { ...headers, "content-length": String(reply.raw.length) });
    response.end(reply.raw);
    return;
  }
  if (reply.body === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  const text = JSON.stringify(reply.body);
  response.writeHead(reply.status, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
  });
  response.end(text);
}

const sendError = (response: ServerResponse, error: ApiError): void => send(response, { status: error.statusCode, body: error.body() });

const isWrite = (method: string): boolean => method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";

function bodyLimitFor(method: string, path: string): number {
  if (!isWrite(method)) return 0;
  return /^\/api\/bookings\/[^/]+\/materials$/.test(path) ? UPLOAD_REQUEST_LIMIT_BYTES : JSON_LIMIT_BYTES;
}

function validIdempotencyKey(header: string | string[] | undefined): string | null | undefined {
  if (header === undefined) return undefined;
  const key = Array.isArray(header) ? (header[0] ?? "") : header;
  return /^[\x21-\x7e]{1,100}$/.test(key) ? key : null;
}

function parseJsonObject(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw apiErrors.validation({});
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw apiErrors.validation({});
  return parsed as Record<string, unknown>;
}

/** A claim whose request never finished (the process died) is abandoned after this long. */
const CLAIM_ABANDONED_SECONDS = 120;

/**
 * Claims an idempotency key for one request. Returns the stored reply when the key already finished with the same
 * request, and null when this request now holds the key and must run. A key still held by a running request answers
 * `idempotency_in_progress` whatever its path or body.
 */
async function claimKey(user: Viewer, key: string, fingerprint: string): Promise<Reply | null> {
  await pool.query(
    `DELETE FROM idempotency_keys
      WHERE user_id = $1 AND key = $2
        AND (created_at < now() - interval '24 hours' OR (status IS NULL AND created_at < now() - make_interval(secs => $3)))`,
    [user.id, key, CLAIM_ABANDONED_SECONDS],
  );
  const claimed = await one<{ key: string }>(
    pool,
    "INSERT INTO idempotency_keys (user_id, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key",
    [user.id, key, fingerprint],
  );
  if (claimed !== null) return null;
  const stored = await one<{ status: number | null; body: string | null; fingerprint: string }>(
    pool,
    "SELECT status, body, fingerprint FROM idempotency_keys WHERE user_id = $1 AND key = $2",
    [user.id, key],
  );
  if (stored === null) return claimKey(user, key, fingerprint);
  if (stored.status === null || stored.body === null) throw apiErrors.idempotencyInProgress();
  if (stored.fingerprint !== fingerprint) throw apiErrors.idempotencyKeyReused();
  return { status: stored.status, body: JSON.parse(stored.body) as unknown };
}

/** Stores the finished reply under the key; a 503 or an unexpected failure stores nothing so the key can be retried. */
async function settleKey(user: Viewer, key: string, reply: Reply | null): Promise<void> {
  if (reply === null || reply.status === 503) {
    await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2", [user.id, key]);
    return;
  }
  await pool.query("UPDATE idempotency_keys SET status = $3, body = $4 WHERE user_id = $1 AND key = $2", [user.id, key, reply.status, JSON.stringify(reply.body ?? null)]);
}

async function dispatch(request: IncomingMessage, url: URL, body: Buffer): Promise<Reply> {
  const method = request.method ?? "GET";
  const matched = routes.flatMap((candidate) => {
    const match = candidate.method === method ? candidate.pattern.exec(url.pathname) : null;
    return match ? [{ candidate, match }] : [];
  })[0];
  if (matched === undefined) throw apiErrors.notFound();
  const { candidate, match } = matched;
  const params: Record<string, string> = {};
  candidate.keys.forEach((name, index) => {
    params[name] = decodeURIComponent(match[index + 1] ?? "");
  });
  const token = cookieToken(request.headers);
  const user = await signedInUser(token);
  if (user === null && candidate.options.public !== true) throw apiErrors.unauthenticated();

  const idempotent = candidate.options.idempotent ?? (method === "POST" && candidate.options.public !== true);
  let key: string | null = null;
  if (idempotent) {
    const checked = validIdempotencyKey(request.headers["idempotency-key"]);
    if (checked === null) throw apiErrors.validation({ idempotency_key: FIELD_MESSAGES.idempotency_key });
    key = checked ?? null;
  }

  const hooks: (() => void)[] = [];
  const build = (db: Db): PublicCtx => ({
    method,
    path: url.pathname,
    params,
    query: url.searchParams,
    headers: request.headers,
    body,
    nowMs: Date.now(),
    db,
    token,
    user,
    afterCommit: (work) => void hooks.push(work),
    json: () => parseJsonObject(body),
  });
  const { handler } = candidate;
  const transactional = candidate.options.transactional ?? method !== "GET";

  const execute = async (): Promise<Reply> => {
    if (!transactional) return handler(build(pool));
    const reply = await transaction((client) => handler(build(client)));
    for (const work of hooks) work();
    return reply;
  };
  if (key === null || user === null) return execute();

  const fingerprint = sha256(`${method}\n${url.pathname}\n${body.toString("latin1")}`);
  const replay = await claimKey(user, key, fingerprint);
  if (replay !== null) return replay;
  let reply: Reply;
  try {
    reply = await execute();
  } catch (error) {
    await settleKey(user, key, error instanceof ApiError ? { status: error.statusCode, body: error.body() } : null);
    throw error;
  }
  // A reply that could not be stored leaves the claim to the abandoned-claim sweep: the effect has committed, so the key must not be freed.
  await settleKey(user, key, reply);
  return reply;
}

export async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://relayline.invalid");
  try {
    const origin = request.headers.origin;
    if (isWrite(method) && origin !== undefined) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === request.headers.host;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) {
        request.resume();
        throw apiErrors.crossOrigin();
      }
    }
    const limit = bodyLimitFor(method, url.pathname);
    const { body, tooLarge, cutOff } = await readBody(request, limit);
    if (cutOff) return;
    if (tooLarge) throw apiErrors.payloadTooLarge();
    send(response, await dispatch(request, url, body));
  } catch (error) {
    if (error instanceof ApiError) sendError(response, error);
    else {
      console.error(error);
      sendError(response, apiErrors.internal());
    }
  }
}
