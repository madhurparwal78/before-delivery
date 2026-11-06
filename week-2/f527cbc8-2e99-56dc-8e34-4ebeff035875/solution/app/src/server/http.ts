// The server boundary and the router. Every request goes through one pipeline that applies the brief's error
// precedence in order: cross-origin 403, vet read-only 405, vet guess limit then address allowance 429, body 413
// then 415, the sign-in user allowance, 401, 403 by role or token scope, the other user allowances; lookups (404),
// idempotency, 412, 409, 422, 402 and 503 follow inside the handlers (brief: API, Error precedence; Server
// boundary; Deployment, Logs and Request ids).
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AllowanceState,
  guessLimitRetryAfter,
  rateLimitHeaders,
  takeToken,
} from "./allowances.js";
import { type Caller, type Role, caller as findCaller } from "./auth.js";
import { now } from "./clock.js";
import { type Bucket, config } from "./config.js";
import { currentContext, runAfterCommit, runAs, setActor } from "./context.js";
import { ApiError } from "./errors.js";
import { errorText, log, loggedPath } from "./log.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type BodyKind = "json" | "multipart" | "csv" | "octet" | "none";
/** What an API token's scope must cover: any token, billing tokens only, or never (session only). */
type TokenRule = "read_only" | "billing" | "never";

const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 8_500_000;
const IMPORT_LIMIT = 1_000_000;

/** A JSON body that did not parse; handlers answer 422 for it like any other malformed body. */
export const UNPARSABLE = Symbol("unparsable");

export interface Context<C extends Caller | null> {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  caller: C;
  /** Parsed JSON body (JSON routes), or UNPARSABLE. */
  body: unknown;
  /** Raw body (multipart, CSV and octet routes). */
  raw: Buffer;
  /** The instant the request is judged at. */
  now: number;
  /** The connection's peer address; forwarding headers are ignored. */
  address: string;
  /** This site's origin as the caller reached it. */
  origin: string;
  requestId: string;
}

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: { data: Buffer; contentType: string };
  headers?: Record<string, string>;
  /** The handler wrote the response itself (event streams). */
  streamed?: true;
}

interface RouteOptions {
  body?: BodyKind;
  allowance?: Exclude<Bucket, "sign_in" | "vet">;
  token?: TokenRule;
}

interface Route {
  method: Method;
  segments: string[];
  body: BodyKind;
  roles: readonly Role[] | null;
  allowance: Exclude<Bucket, "sign_in" | "vet"> | null;
  token: TokenRule;
  handler: (ctx: Context<Caller | null>) => Promise<Reply>;
}

const routes: Route[] = [];
const defaultBody = (method: Method): BodyKind => (method === "GET" || method === "DELETE" ? "none" : "json");

/** A route for signed-in callers whose role is listed. */
export function route(
  method: Method,
  pattern: string,
  roles: readonly Role[],
  handler: (ctx: Context<Caller>) => Promise<Reply>,
  options: RouteOptions = {},
): void {
  routes.push({
    method,
    segments: pattern.split("/"),
    body: options.body ?? defaultBody(method),
    roles,
    allowance: options.allowance ?? null,
    token: options.token ?? (method === "GET" ? "read_only" : "never"),
    handler: handler as Route["handler"],
  });
}

/** A route that needs no session (sign-in, vet reads, signed paths). */
export function openRoute(method: Method, pattern: string, handler: (ctx: Context<null>) => Promise<Reply>): void {
  routes.push({
    method,
    segments: pattern.split("/"),
    body: defaultBody(method),
    roles: null,
    allowance: null,
    token: "never",
    handler: handler as Route["handler"],
  });
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): Reply => ({
  status,
  json: body,
  ...(headers ? { headers } : {}),
});

const fail = (error: ApiError): Reply => json(error.status, error.body(), error.headers);

function match(segments: string[], path: string[]): Record<string, string> | null {
  if (segments.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (const [index, segment] of segments.entries()) {
    const actual = path[index] ?? "";
    if (segment.startsWith(":")) {
      if (!actual) return null;
      try {
        params[segment.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (segment !== actual) return null;
  }
  return params;
}

/** Reads the body, keeping at most limit + 1 bytes; the rest is drained so the client still reads the answer. */
function readBody(req: IncomingMessage, limit: number): Promise<{ data: Buffer; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit + 1) chunks.push(chunk);
    });
    req.on("end", () => resolve({ data: Buffer.concat(chunks), tooLarge: size > limit }));
    req.on("error", reject);
  });
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const peerAddress = (req: IncomingMessage): string => (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");

const mediaType = (req: IncomingMessage): string => (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

function bodyLimit(kind: BodyKind): number {
  if (kind === "multipart") return MULTIPART_LIMIT;
  if (kind === "csv") return IMPORT_LIMIT;
  if (kind === "octet") return config.uploadChunkBytes;
  return JSON_LIMIT;
}

const EXPECTED_TYPE: Record<Exclude<BodyKind, "none" | "json">, string> = {
  multipart: "multipart/form-data",
  csv: "text/csv",
  octet: "application/octet-stream",
};

const rateLimited = (state: AllowanceState): ApiError =>
  new ApiError(429, "rate_limited", { bucket: state.bucket, scope: state.scope });

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, method: string, requestId: string): Promise<Reply> {
  const path = url.pathname.split("/");
  const vetPath = url.pathname.startsWith("/api/vet/");
  if (method !== "GET" && !sameOrigin(req)) return fail(new ApiError(403, "cross_origin"));
  if (vetPath && method !== "GET") return fail(new ApiError(405, "read_only"));
  const at = now();
  const address = peerAddress(req);
  const reached: AllowanceState[] = [];
  const withLimits = (reply: Reply): Reply =>
    reached.length ? { ...reply, headers: { ...rateLimitHeaders(reached), ...reply.headers } } : reply;
  const refuse = (state: AllowanceState): Reply => withLimits(fail(rateLimited(state)));

  if (vetPath) {
    const retryAfter = await guessLimitRetryAfter(address, at);
    if (retryAfter !== null) return fail(new ApiError(429, "rate_limited", {}, { "retry-after": String(retryAfter) }));
  }
  let found: { route: Route; params: Record<string, string> } | null = null;
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const params = match(candidate.segments, path);
    if (params) {
      found = { route: candidate, params };
      break;
    }
  }
  const signInRoute = method === "POST" && url.pathname === "/api/session";
  const addressBucket: Bucket | null = vetPath ? "vet" : signInRoute ? "sign_in" : (found?.route.allowance ?? null);
  if (addressBucket) {
    const state = await takeToken(addressBucket, "address", address, at);
    if (state) {
      reached.push(state);
      if (!state.allowed) return refuse(state);
    }
  }
  if (!found) {
    await readBody(req, 0);
    return withLimits(fail(new ApiError(404, "not_found")));
  }
  const { route: target, params } = found;
  let body: unknown = {};
  let raw: Buffer = Buffer.alloc(0);
  if (target.body !== "none") {
    const read = await readBody(req, bodyLimit(target.body));
    if (read.tooLarge) return withLimits(fail(new ApiError(413, "payload_too_large")));
    const type = mediaType(req);
    if (target.body === "json") {
      // A JSON route takes a JSON body, or no body with no declared type (the day transitions, for example).
      const declared = req.headers["content-type"] !== undefined;
      if ((read.data.length > 0 || declared) && type !== "application/json") {
        return withLimits(fail(new ApiError(415, "unsupported_media_type")));
      }
      if (read.data.length > 0) {
        try {
          body = JSON.parse(read.data.toString("utf8"));
        } catch {
          body = UNPARSABLE;
        }
      }
    } else {
      if (type !== EXPECTED_TYPE[target.body]) return withLimits(fail(new ApiError(415, "unsupported_media_type")));
      raw = read.data;
    }
  } else if (method !== "GET") {
    await readBody(req, 0);
  }
  if (signInRoute) {
    const email = body !== null && typeof body === "object" && "email" in body ? (body as { email: unknown }).email : null;
    const state = await takeToken("sign_in", "user", typeof email === "string" ? email.trim().toLowerCase() : "", at);
    if (state) {
      reached.push(state);
      if (!state.allowed) return refuse(state);
    }
  }
  let who: Caller | null = null;
  if (target.roles) {
    who = await findCaller(req);
    if (!who) return withLimits(fail(new ApiError(401, "unauthenticated")));
    setActor(who.token ? { type: "token", id: who.token.id } : { type: "user", id: who.id });
    if (!target.roles.includes(who.role)) return withLimits(fail(new ApiError(403, "forbidden")));
    if (who.token) {
      const covered = target.token === "read_only" || (target.token === "billing" && who.token.scope === "billing");
      if (!covered) return withLimits(fail(new ApiError(403, "insufficient_scope")));
    }
    if (target.allowance) {
      const state = await takeToken(target.allowance, "user", who.id, at);
      if (state) {
        reached.push(state);
        if (!state.allowed) return refuse(state);
      }
    }
  }
  const ctx: Context<Caller | null> = {
    req,
    res,
    params,
    query: url.searchParams,
    caller: who,
    body,
    raw,
    now: at,
    address,
    origin: `http://${req.headers.host ?? ""}`,
    requestId,
  };
  try {
    return withLimits(await target.handler(ctx));
  } catch (error) {
    if (error instanceof ApiError) return withLimits(fail(error));
    throw error;
  }
}

// ---- Built browser assets and the app's page at each app URL ----

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** Only files the build wrote are ever served, keyed by their URL path. */
const assets = new Map<string, { data: Buffer; type: string; immutable: boolean }>(
  listFiles(PUBLIC_DIR).map((file) => {
    const urlPath = `/${relative(PUBLIC_DIR, file).split("\\").join("/")}`;
    return [
      urlPath,
      {
        data: readFileSync(file),
        type: CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
        immutable: urlPath.startsWith("/assets/"),
      },
    ];
  }),
);
const APP_PAGES = [
  /^\/$/,
  /^\/sign-in$/,
  /^\/horses$/,
  /^\/invoices$/,
  /^\/prices$/,
  /^\/dashboard$/,
  /^\/days\/[^/]+$/,
  /^\/horses\/[^/]+$/,
  /^\/vet\/[^/]+$/,
];
const PAGE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "content-security-policy":
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
};

const notFoundPage = (): Reply => ({ status: 404, bytes: { data: Buffer.from("Not found"), contentType: "text/plain; charset=utf-8" } });

function staticReply(pathname: string): Reply {
  const page = APP_PAGES.some((pattern) => pattern.test(pathname)) ? assets.get("/index.html") : undefined;
  const file = page ?? (pathname === "/index.html" ? undefined : assets.get(pathname));
  if (!file) return notFoundPage();
  return {
    status: 200,
    bytes: { data: file.data, contentType: file.type },
    headers: { ...PAGE_HEADERS, "cache-control": file.immutable ? "public, max-age=31536000, immutable" : "no-cache" },
  };
}

/** Raw request paths that try to climb out of the served tree never reach a handler. */
const TRAVERSAL = /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i;
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

// ---- Health, readiness and draining ----

type Probe = () => Promise<boolean>;
let readinessProbes: Record<string, Probe> = {};
let draining = false;
let inFlight = 0;
const drainWaiters: Array<() => void> = [];

export function setReadinessProbes(probes: Record<string, Probe>): void {
  readinessProbes = probes;
}

/** Stops accepting work: /readyz answers 503 draining and every other new request 503 shutting_down. */
export function startDraining(): void {
  draining = true;
}

/** Resolves once no ordinary request is in flight (event streams are ended separately). */
export function inFlightSettled(): Promise<void> {
  return inFlight === 0 ? Promise.resolve() : new Promise((resolve) => drainWaiters.push(resolve));
}

function bounded(probe: Probe): Promise<boolean> {
  return Promise.race([
    probe().catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), config.readyCheckTimeoutMs)),
  ]);
}

async function readiness(): Promise<Reply> {
  const names = Object.keys(readinessProbes);
  const results = await Promise.all(names.map((name) => bounded(readinessProbes[name] ?? (async () => false))));
  const dependencies = Object.fromEntries(names.map((name, index) => [name, results[index] ? "up" : "down"]));
  const down = names.filter((_, index) => !results[index]);
  if (draining) return json(503, { status: "not_ready", dependencies, down, draining: true });
  if (down.length) return json(503, { status: "not_ready", dependencies, down });
  return json(200, { status: "ready", dependencies });
}

function send(res: ServerResponse, reply: Reply, requestId: string): void {
  if (reply.streamed) return;
  const headers: Record<string, string> = { "cache-control": "no-store", "x-request-id": requestId, ...reply.headers };
  if (reply.bytes) {
    res.writeHead(reply.status, { ...headers, "content-type": reply.bytes.contentType });
    res.end(reply.bytes.data);
    return;
  }
  if (reply.json === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  res.writeHead(reply.status, { ...headers, "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(reply.json));
}

async function dispatch(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<Reply> {
  const rawPath = (req.url ?? "/").split("?")[0] ?? "/";
  const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
  if (TRAVERSAL.test(rawPath)) return notFoundPage();
  const url = new URL(req.url ?? "/", "http://app.invalid");
  if (url.pathname === "/readyz" && method === "GET") return readiness();
  if (draining) return fail(new ApiError(503, "shutting_down"));
  if ((url.pathname === "/healthz" || url.pathname === "/api/health") && method === "GET") return json(200, { status: "ok" });
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) return handleApi(req, res, url, method, requestId);
  return method === "GET" ? staticReply(url.pathname) : fail(new ApiError(404, "not_found"));
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = performance.now();
  const incoming = req.headers["x-request-id"];
  const requestId = typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  const path = loggedPath((req.url ?? "/").split("?")[0] ?? "/");
  inFlight += 1;
  let status = 500;
  await runAs({ requestId, actor: { type: "system", id: null }, origin: "request", after: [] }, async () => {
    try {
      const reply = await dispatch(req, res, requestId);
      status = reply.streamed ? 200 : reply.status;
      // First send attempts and Kill Bill legs run once the request's transactions have committed, before it answers.
      await runAfterCommit(currentContext()).catch((error: unknown) =>
        log("error", "after-commit work failed", { error: errorText(error) }),
      );
      send(res, reply, requestId);
    } catch (error) {
      log("error", "request failed", { method: req.method, path, error: errorText(error) });
      if (!res.headersSent) send(res, fail(new ApiError(500, "internal")), requestId);
      else res.destroy();
    } finally {
      inFlight -= 1;
      if (inFlight === 0) drainWaiters.splice(0).forEach((resolve) => resolve());
    }
    const finish = (): void =>
      log(status >= 500 ? "error" : "info", "request", {
        request_id: requestId,
        method: req.method,
        path,
        status,
        duration_ms: Math.round(performance.now() - started),
      });
    if (res.writableFinished) finish();
    else res.once("close", finish);
  });
}
