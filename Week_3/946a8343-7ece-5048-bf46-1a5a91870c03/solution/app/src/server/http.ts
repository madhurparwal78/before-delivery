// HTTP server: routing, body limits, JSON errors in the published precedence, sessions, static assets and the page shell.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { config, LIMITS } from "./config.ts";
import type { UserRow } from "./access.ts";
import { sessionToken, userForToken, publicUser } from "./auth.ts";
import { ApiError, badRequest, methodNotAllowed, notFound, tooLarge, unauthenticated, unavailable } from "./errors.ts";
import { hit } from "./ratelimit.ts";
import { withIdempotency } from "./idempotency.ts";
import { storage } from "./s3.ts";
import { postgresReachable, waitForDemo } from "./db.ts";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Ctx {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: Method;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly params: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly text: string;
  readonly user: UserRow;
}

export interface JsonReply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface RawReply {
  readonly status: number;
  readonly raw: Buffer | string;
  readonly contentType: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export const STREAMED = Symbol("streamed");
export type Reply = JsonReply | RawReply | typeof STREAMED;
type Handler = (ctx: Ctx) => Promise<Reply> | Reply;

interface RouteOptions {
  readonly auth?: boolean;
  readonly bodyLimit?: number;
  readonly bodyKind?: "json" | "text";
  readonly tooLarge?: (max: number) => ApiError;
  readonly idempotent?: boolean;
}

interface Route {
  readonly method: Method;
  readonly segments: readonly string[];
  readonly handler: Handler;
  readonly options: RouteOptions;
}

export const json = (status: number, body?: unknown, headers?: Readonly<Record<string, string>>): JsonReply =>
  headers === undefined ? { status, body } : { status, body, headers };
export const noContent = (): JsonReply => ({ status: 204 });

export class Router {
  private readonly routes: Route[] = [];

  add(method: Method, pattern: string, handler: Handler, options: RouteOptions = {}): void {
    this.routes.push({ method, segments: pattern.split("/").slice(1), handler, options });
  }

  get(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add("GET", pattern, handler, options);
  }
  post(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add("POST", pattern, handler, options);
  }
  put(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add("PUT", pattern, handler, options);
  }
  patch(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add("PATCH", pattern, handler, options);
  }
  delete(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add("DELETE", pattern, handler, options);
  }

  resolve(method: string, rawPath: string): { route: Route; params: Record<string, string> } | "method" | undefined {
    const parts = rawPath.split("/").slice(1);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (params === undefined) continue;
      if (route.method === method) return { route, params };
      pathMatched = true;
    }
    return pathMatched ? "method" : undefined;
  }
}

function matchSegments(pattern: readonly string[], parts: readonly string[]): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i] ?? "";
    if (want.startsWith("*")) {
      params[want.slice(1)] = parts.slice(i).map(safeDecode).join("/");
      return parts.length > i ? params : undefined;
    }
    const got = parts[i];
    if (got === undefined) return undefined;
    if (want.startsWith(":")) params[want.slice(1)] = safeDecode(got);
    else if (want !== got) return undefined;
  }
  return parts.length === pattern.length ? params : undefined;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function intParam(ctx: Ctx, name: string): number {
  const value = ctx.params[name] ?? "";
  if (!/^\d{1,9}$/.test(value)) throw notFound();
  return Number(value);
}

async function readBody(req: IncomingMessage, limit: number): Promise<{ buffer: Buffer; over: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req) {
    const piece: Buffer = chunk;
    size += piece.length;
    if (size > limit) {
      over = true;
      chunks.length = 0;
      if (size > limit * 4 + 1_000_000) {
        req.destroy();
        break;
      }
    } else if (!over) {
      chunks.push(piece);
    }
  }
  return { buffer: Buffer.concat(chunks), over };
}

function writeReply(res: ServerResponse, reply: Exclude<Reply, typeof STREAMED>): void {
  const headers: Record<string, string> = { "cache-control": "no-store", ...(reply.headers ?? {}) };
  if ("raw" in reply) {
    headers["content-type"] = reply.contentType;
    res.writeHead(reply.status, headers);
    res.end(reply.raw);
    return;
  }
  if (reply.status === 204 || reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  headers["content-type"] = "application/json; charset=utf-8";
  res.writeHead(reply.status, headers);
  res.end(JSON.stringify(reply.body));
}

function writeError(res: ServerResponse, error: ApiError): void {
  writeReply(res, { status: error.status, body: error.toBody() });
}

const SPA_STATIC = new Map<string, { type: string; data: Buffer }>();

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

export function loadStaticAssets(directory: string): void {
  if (!existsSync(directory)) return;
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else SPA_STATIC.set(`/${prefix}${name}`, { type: CONTENT_TYPES[extname(name)] ?? "application/octet-stream", data: readFileSync(full) });
    }
  };
  walk(directory, "");
}

function pageShell(user: UserRow | undefined, storageUp: boolean): string {
  const pageConfig = JSON.stringify({
    toastMs: config.toastMs,
    user: user === undefined ? null : publicUser(user),
    storage: storageUp ? "up" : "down",
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spurline</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="app"></div>
<script type="application/json" id="spur-config">${pageConfig}</script>
<script type="module" src="/app.js"></script>
</body>
</html>`;
}

let storageProbe = { at: 0, up: true };

async function storageIsUp(): Promise<boolean> {
  if (storage.isForcedDown) return false;
  const at = Date.now();
  if (at - storageProbe.at > 1000) {
    storageProbe = { at, up: await storage.reachable() };
  }
  return storageProbe.up;
}

export function forgetStorageProbe(): void {
  storageProbe = { at: 0, up: true };
}

async function handlePage(req: IncomingMessage, res: ServerResponse, path: string, search: string): Promise<void> {
  const asset = SPA_STATIC.get(path);
  if (asset !== undefined) {
    res.writeHead(200, { "content-type": asset.type, "cache-control": "no-cache" });
    res.end(asset.data);
    return;
  }
  if (extname(path) !== "" || (req.method !== "GET" && req.method !== "HEAD")) {
    writeReply(res, { status: 404, body: notFound().toBody() });
    return;
  }
  const open = path === "/sign-in" || path === "/sign-up";
  let user: UserRow | undefined;
  try {
    user = await userForToken(sessionToken(req));
  } catch {
    user = undefined;
  }
  if (user === undefined && !open) {
    res.writeHead(302, { location: `/sign-in?next=${encodeURIComponent(path + search)}`, "cache-control": "no-store" });
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(pageShell(user, await storageIsUp()));
}

async function authenticate(req: IncomingMessage): Promise<UserRow> {
  const user = await userForToken(sessionToken(req));
  if (user === undefined) throw unauthenticated();
  return user;
}

function parseJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest();
  }
}

async function dispatch(router: Router, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const resolved = router.resolve(req.method ?? "GET", url.pathname);
  if (resolved === undefined) throw notFound();
  if (resolved === "method") {
    await authenticate(req);
    throw methodNotAllowed();
  }
  const { route, params } = resolved;
  const options = route.options;
  const method = route.method;
  let text = "";
  let body: unknown;
  if (method !== "GET") {
    const limit = options.bodyLimit ?? LIMITS.jsonBodyBytes;
    const { buffer, over } = await readBody(req, limit);
    if (over) throw (options.tooLarge ?? tooLarge)(limit);
    text = buffer.toString("utf8");
    if ((options.bodyKind ?? "json") === "json") body = parseJson(text);
  }
  const needsAuth = options.auth !== false;
  const user = needsAuth ? await authenticate(req) : undefined;
  const limitWrites = async (): Promise<void> => {
    if (user !== undefined && method !== "GET") await hit(`write:${user.id}`, config.writeRate);
  };
  const ctx: Ctx = {
    req, res, method, path: url.pathname, query: url.searchParams, params, body, text,
    user: user ?? ({ id: 0, username: "", time_zone: "UTC" } satisfies UserRow),
  };
  const key = req.headers["idempotency-key"];
  if (options.idempotent === true && user !== undefined && typeof key === "string" && key !== "") {
    const outcome = await withIdempotency(user.id, key, { method, path: url.pathname, body }, async () => {
      await limitWrites();
      const reply = await route.handler(ctx);
      if (reply === STREAMED || "raw" in reply) throw new Error("Idempotent routes reply with JSON");
      return { status: reply.status, body: reply.body };
    });
    writeReply(res, { status: outcome.status, body: outcome.body, headers: outcome.replay ? { "idempotent-replay": "true" } : {} });
    return;
  }
  await limitWrites();
  const reply = await route.handler(ctx);
  if (reply !== STREAMED) writeReply(res, reply);
}

export function startServer(router: Router): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const run = async (): Promise<void> => {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) await dispatch(router, req, res, url);
      else await handlePage(req, res, url.pathname, url.search);
    };
    run().catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof ApiError) {
        writeError(res, error);
        return;
      }
      console.error(error);
      writeReply(res, { status: 503, body: unavailable().toBody() });
    });
  });
  server.keepAliveTimeout = 65000;
  server.listen(config.port, "0.0.0.0");
  return server;
}

// An empty database seeds its demo instance right after the schema; "ok" holds back until that is done (or this long).
const DEMO_WAIT_MS = 60_000;

export async function healthStatus(): Promise<"ok" | "unavailable" | "starting"> {
  if (!(await postgresReachable())) return "starting";
  if (!(await storageIsUp())) return "unavailable";
  await waitForDemo(DEMO_WAIT_MS);
  return "ok";
}
