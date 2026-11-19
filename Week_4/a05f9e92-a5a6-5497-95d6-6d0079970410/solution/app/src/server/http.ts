import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeScreen } from "../shared/screens.js";
import { sessionFor, type Session } from "./auth.js";
import { realTime } from "./clock.js";
import { settings } from "./config.js";
import { transaction } from "./db.js";
import { Env, type Principal } from "./env.js";
import { ApiError, errorBody, fail, forbidden, operatorOnly, unauthenticated, validation } from "./errors.js";
import { homeScreen, type Role } from "../shared/types.js";
import { findRecord } from "./records.js";
import { parseMultipart, type Multipart } from "./multipart.js";

const COOKIE = "switchyard_session";
const JSON_LIMIT = 1_000_000;
const MULTIPART_EXTRA = 65_536;

interface Reply {
  status: number;
  body?: unknown;
  raw?: Buffer;
  type?: string;
  headers?: Record<string, string>;
}

export interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  raw: Buffer;
  session: Session | null;
  cookieToken: string | null;
  /** Parsed JSON body; refuses with 422 when the text is not JSON. */
  json<T = Record<string, unknown>>(): T;
  multipart(): Multipart;
}

type Handler = (ctx: Ctx) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  needsSession: boolean;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, options: { public?: boolean } = {}): void {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/:([a-z_]+)/g, (_m, key: string) => (keys.push(key), "([^/]+)")) + "$");
  routes.push({ method, pattern, keys, handler, needsSession: !options.public });
}

export function reply(status: number, body?: unknown, headers?: Record<string, string>): Reply {
  return { status, body, headers };
}

const lengthText = (n: number): string => n.toLocaleString("en-US");

function tooLarge(limit: number): ApiError {
  return new ApiError(413, "too_large", `Request bodies can be at most ${lengthText(limit)} bytes.`);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  const chunks: Buffer[] = [];
  let size = 0;
  let over = declared > limit;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) over = true;
    if (!over) chunks.push(chunk as Buffer);
    if (size > limit * 4) break;
  }
  if (over) throw tooLarge(limit);
  return Buffer.concat(chunks);
}

function cookieOf(req: IncomingMessage): string | null {
  const header = req.headers.cookie ?? "";
  const match = header.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : null;
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedCookie(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

const windows = new Map<string, number[]>();

/** Counts a request in a 60 second window of real time and refuses it when the limit is already reached. */
export function rateCheck(bucket: string, limit: number): void {
  const at = realTime();
  const recent = (windows.get(bucket) ?? []).filter((t) => at - t < 60_000);
  const over = recent.length >= limit;
  recent.push(at);
  windows.set(bucket, recent);
  if (over) {
    const wait = Math.max(1, Math.ceil((recent[0]! + 60_000 - at) / 1000));
    throw new ApiError(429, "rate_limited", `Too many requests. Try again in ${wait} seconds.`, undefined, undefined, { "Retry-After": String(wait) });
  }
}

export function forgetRateLimits(): void {
  windows.clear();
}

function sendReply(res: ServerResponse, out: Reply): void {
  const headers: Record<string, string | number> = { ...out.headers };
  let payload: Buffer | string = "";
  if (out.raw) {
    headers["content-type"] = out.type ?? "application/octet-stream";
    payload = out.raw;
  } else if (out.body !== undefined) {
    headers["content-type"] = "application/json; charset=utf-8";
    payload = JSON.stringify(out.body);
  }
  headers["content-length"] = Buffer.byteLength(payload);
  headers["cache-control"] ??= "no-store";
  res.writeHead(out.status, headers);
  res.end(payload);
}

function isStateChanging(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function principalOf(session: Session): Principal {
  return { user: session.user, actor: session.actor.username, actingFor: session.impersonating ? session.user.username : null };
}

/** Runs a handler body inside one transaction with the viewer's environment. */
export async function withEnv<T>(ctx: Ctx, work: (env: Env) => Promise<T>): Promise<T> {
  const session = ctx.session ?? unauthenticated();
  return transaction(async (tx) => work(await Env.create(tx, principalOf(session))));
}

export function requireSession(ctx: Ctx): Session {
  return ctx.session ?? unauthenticated();
}

export function requireOperator(env: Env): void {
  if (!env.user.roles.includes("operator")) operatorOnly();
}

export function requireRole(env: Env, roles: Role[]): void {
  if (!roles.some((r) => env.user.roles.includes(r))) forbidden();
}

export function numberParam(ctx: Ctx, key: string): number {
  const value = Number(ctx.params[key]);
  if (!Number.isInteger(value)) fail(404, "not_found", "No such record.");
  return value;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return fail(404, "not_found", "No such record.");
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "client");

const TYPES: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

function shell(): Buffer {
  return readFileSync(join(clientRoot, "index.html"));
}

function serveAsset(res: ServerResponse, path: string): boolean {
  const clean = normalize(path).replace(/^([/\\])+/, "");
  const allowed = clean.startsWith(`assets${sep}`) || clean.startsWith(`fonts${sep}`);
  const file = join(clientRoot, clean);
  if (!allowed || !file.startsWith(clientRoot + sep) || !existsSync(file) || !statSync(file).isFile()) return false;
  const extension = file.slice(file.lastIndexOf("."));
  res.writeHead(200, { "content-type": TYPES[extension] ?? "application/octet-stream", "content-length": statSync(file).size, "cache-control": "public, max-age=31536000, immutable" });
  createReadStream(file).pipe(res);
  return true;
}

async function pageReply(req: IncomingMessage, res: ServerResponse, path: string, session: Session | null): Promise<void> {
  const verdict = judgeScreen(path, session ? session.user.roles : null);
  const html = shell();
  if (verdict === "login") {
    res.writeHead(302, { location: "/login" });
    res.end();
    return;
  }
  if (verdict === "public" && session && path.replace(/\/+$/, "") === "/login") {
    res.writeHead(302, { location: homeScreen(session.user.roles) });
    res.end();
    return;
  }
  let status = verdict === "missing" ? 404 : 200;
  const record = /^\/(?:desk\/(?:records|major)|portal\/incidents)\/([^/]+)$/.exec(path.replace(/\/+$/, ""));
  if (status === 200 && record && session) {
    const visible = await transaction(async (tx) => {
      const env = await Env.create(tx, principalOf(session));
      const rec = await findRecord(tx, decodeURIComponent(record[1]!));
      return !!rec && (await env.access()).canRead(rec);
    });
    if (!visible) status = 404;
  }
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-length": html.length, "cache-control": "no-store" });
  res.end(req.method === "HEAD" ? undefined : html);
}

/** The single request entry: transport checks, authentication, the rate check, then the route. */
export async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const [path = "/", search = ""] = (req.url ?? "/").split("?");
  const method = req.method ?? "GET";
  try {
    if (!path.startsWith("/api/")) {
      if (method !== "GET" && method !== "HEAD") fail(404, "not_found", "No such page.");
      if (serveAsset(res, path)) return;
      await pageReply(req, res, path, await sessionFor(cookieOf(req)));
      return;
    }
    if (isStateChanging(method) && req.headers.origin !== undefined) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(req.headers.origin).host === req.headers.host;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) fail(403, "cross_origin", "Requests must come from Switchyard itself.");
    }
    if (path.startsWith("/api/grading/") && req.headers["x-grading-key"] !== settings.GRADING_KEY) fail(404, "not_found", "No such record.");
    const multipart = (req.headers["content-type"] ?? "").startsWith("multipart/form-data");
    const raw = isStateChanging(method) ? await readBody(req, multipart ? settings.ATTACHMENT_MAX_BYTES + MULTIPART_EXTRA : JSON_LIMIT) : Buffer.alloc(0);
    const match = routes.filter((r) => r.method === method).map((r) => ({ r, m: r.pattern.exec(path) })).find((x) => x.m);
    const cookieToken = cookieOf(req);
    const session = await sessionFor(cookieToken);
    const ctx: Ctx = {
      req,
      params: match ? Object.fromEntries(match.r.keys.map((k, i) => [k, decodeSegment(match.m![i + 1]!)])) : {},
      query: new URLSearchParams(search),
      raw,
      session,
      cookieToken,
      json<T>() {
        if (raw.length === 0) return {} as T;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString("utf8"));
        } catch {
          return validation("The request body is not valid JSON.");
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return validation("The request body must be a JSON object.");
        return parsed as T;
      },
      multipart() {
        const parsed = parseMultipart(String(req.headers["content-type"] ?? ""), raw);
        return parsed ?? validation("The request body is not valid multipart form data.");
      },
    };
    if (!match) {
      if (!session && path !== "/api/health") unauthenticated();
      fail(404, "not_found", "No such record.");
    }
    if (match.r.needsSession && !session) unauthenticated();
    if (session && isStateChanging(method) && !path.startsWith("/api/grading/")) rateCheck(`write:${session.actor.username}`, settings.WRITE_RATE_LIMIT_PER_MINUTE);
    sendReply(res, await match.r.handler(ctx));
  } catch (error) {
    if (error instanceof ApiError) sendReply(res, { status: error.status, body: errorBody(error), headers: error.headers });
    else {
      process.stderr.write(`${method} ${path} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      sendReply(res, { status: 500, body: errorBody(new ApiError(500, "internal", "Something went wrong on the server.")) });
    }
  }
}
