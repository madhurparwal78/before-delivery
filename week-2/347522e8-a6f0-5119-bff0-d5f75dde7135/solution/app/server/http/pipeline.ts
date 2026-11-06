// Every API request passes through this one pipeline, in the brief's error-precedence order:
// 413 body limit → 403 cross origin → 405 read-only share → 415 media type → 401 session →
// 404 path identifiers → 403 role → (handlers: replay, 409 state, 422, file checks, 409 content, provider).

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Role } from "../../shared/api.js";
import { pool } from "../db.js";
import { JSON_LIMIT, MULTIPART_LIMIT, type JsonObject, parseJsonObject, readBody } from "./body.js";
import { ApiError, fail, invalid, notFound } from "./errors.js";
import { type MultipartForm, boundaryOf, parseMultipart } from "./multipart.js";
import { type Caller, callerFromRequest, isStaff } from "./session.js";

export interface Reply {
  status: number;
  body?: unknown;
  /** A stored response body, written byte for byte (idempotent replays). */
  raw?: string;
  headers?: Record<string, string>;
}

interface Context {
  req: IncomingMessage;
  query: URLSearchParams;
  /** A path identifier named in the route's pattern. */
  param: (name: string) => string;
  body: JsonObject;
  form: MultipartForm | null;
}

interface SignedInContext extends Context {
  caller: Caller;
}

type Method = "GET" | "POST" | "DELETE";
type BodyKind = "json" | "multipart";

interface RouteBase {
  method: Method;
  pattern: RegExp;
  names: string[];
  body: BodyKind;
}

interface PublicRoute extends RouteBase {
  signedIn: false;
  handle: (ctx: Context & { caller: Caller | null }) => Promise<Reply>;
}

interface SignedInRoute extends RouteBase {
  signedIn: true;
  roles: readonly Role[];
  handle: (ctx: SignedInContext) => Promise<Reply>;
}

type Route = PublicRoute | SignedInRoute;

const routes: Route[] = [];

function compile(path: string): { pattern: RegExp; names: string[] } {
  const names: string[] = [];
  const source = path.replace(/:([a-z_]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${source}$`), names };
}

export function publicRoute(method: Method, path: string, handle: PublicRoute["handle"], body: BodyKind = "json"): void {
  routes.push({ method, ...compile(path), body, signedIn: false, handle });
}

export function signedInRoute(
  method: Method,
  path: string,
  roles: readonly Role[],
  handle: SignedInRoute["handle"],
  body: BodyKind = "json",
): void {
  routes.push({ method, ...compile(path), body, signedIn: true, roles, handle });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owner-scoped tables: a renter sees only their own rows, staff see all. */
const OWNED: Record<string, string> = {
  renter_id: "SELECT id AS owner FROM renters WHERE id = $1",
  booking_id: "SELECT renter_id AS owner FROM bookings WHERE id = $1",
  document_id: "SELECT renter_id AS owner FROM documents WHERE id = $1",
  statement_id: "SELECT renter_id AS owner FROM statements WHERE id = $1",
};

/** Shared kitchen records: only existence matters. */
const SHARED: Record<string, string> = {
  station_id: "SELECT 1 FROM stations WHERE id = $1",
  block_id: "SELECT 1 FROM maintenance_blocks WHERE id = $1",
  link_id: "SELECT 1 FROM compliance_links WHERE id = $1",
};

function decodeParam(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

async function identifiersVisible(params: Record<string, string>, caller: Caller): Promise<boolean> {
  for (const [name, value] of Object.entries(params)) {
    const owned = OWNED[name];
    if (owned) {
      if (!UUID.test(value)) return false;
      const row = (await pool.query<{ owner: string }>(owned, [value])).rows[0];
      if (!row || (!isStaff(caller) && row.owner !== caller.renterId)) return false;
      continue;
    }
    const shared = SHARED[name];
    if (shared) {
      if (name !== "station_id" && !UUID.test(value)) return false;
      if (!(await pool.query(shared, [value])).rowCount) return false;
    }
  }
  return true;
}

function isWrite(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
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

function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.raw !== undefined || reply.body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
  res.writeHead(reply.status, headers);
  res.end(reply.raw ?? (reply.body === undefined ? undefined : JSON.stringify(reply.body)));
}

function errorReply(error: ApiError): Reply {
  return { status: error.status, body: error.body };
}

async function answer(req: IncomingMessage): Promise<Reply> {
  const [pathname = "/", search = ""] = (req.url ?? "/").split("?", 2);
  const url = { pathname, searchParams: new URLSearchParams(search) };
  const method = req.method ?? "GET";
  const contentType = req.headers["content-type"] ?? "";
  const multipart = /^multipart\/form-data/i.test(contentType);
  const raw = await readBody(req, multipart ? MULTIPART_LIMIT : JSON_LIMIT);

  if (raw.tooLarge) throw fail(413, "payload_too_large");
  if (isWrite(method) && crossOrigin(req)) throw fail(403, "cross_origin");
  if (url.pathname.startsWith("/api/share/") && method !== "GET") throw fail(405, "read_only");

  let matched: { route: Route; params: Record<string, string> } | null = null;
  for (const route of routes) {
    const found = route.method === method ? route.pattern.exec(url.pathname) : null;
    if (!found) continue;
    const params: Record<string, string> = {};
    for (const [index, name] of route.names.entries()) {
      const value = decodeParam(found[index + 1] ?? "");
      // An identifier that does not decode, or carries a control character, names nothing.
      if (value === null || /[\u0000-\u001f]/.test(value)) throw notFound();
      params[name] = value;
    }
    matched = { route, params };
    break;
  }
  if (!matched) throw notFound();
  const { route, params } = matched;

  let body: JsonObject | null = {};
  let form: MultipartForm | null = null;
  if (route.body === "multipart") {
    const boundary = multipart ? boundaryOf(contentType) : null;
    if (!boundary) throw fail(415, "unsupported_media_type");
    form = parseMultipart(raw.bytes, boundary) ?? { fields: {}, files: {} };
  } else if (raw.bytes.length || contentType) {
    if (!/^application\/json\s*(;|$)/i.test(contentType)) throw fail(415, "unsupported_media_type");
    body = parseJsonObject(raw.bytes);
  }

  const caller = await callerFromRequest(pool, req);
  const param = (name: string): string => {
    const value = params[name];
    if (value === undefined) throw new Error(`route ${url.pathname} has no :${name}`);
    return value;
  };
  const base = { req, query: url.searchParams, param, body: body ?? {}, form };
  if (!route.signedIn) return route.handle({ ...base, caller });
  if (!caller) throw fail(401, "unauthenticated");
  if (!(await identifiersVisible(params, caller))) throw notFound();
  if (!route.roles.includes(caller.role)) throw fail(403, "forbidden");
  if (body === null) throw invalid({ body: "Send a JSON object." });
  return route.handle({ ...base, caller });
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let reply: Reply;
  try {
    reply = await answer(req);
  } catch (error) {
    if (error instanceof ApiError) reply = errorReply(error);
    else {
      console.error(`${req.method} ${req.url} failed:`, error);
      reply = { status: 500, body: { error: "internal" } };
    }
  }
  send(res, reply);
}
