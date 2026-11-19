// The API request pipeline: the one error shape and the one refusal order for every endpoint.
import type { IncomingMessage, ServerResponse } from "node:http";
import { one, pool } from "../db.js";
import { sessionEnded, tokenHash } from "../domain/session.js";
import { parseMultipart, type Multipart } from "./multipart.js";

export type Role = "coordinator" | "volunteer" | "member";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export type Fields = Record<string, string>;

const SUMMARY = "Check the highlighted fields.";
const JSON_LIMIT = 100_000;
const MULTIPART_LIMIT = 5_100_000;
const PHOTO_TOO_LARGE = "Photo must be 5,000,000 bytes or smaller.";
export const SESSION_COOKIE = "pegworth_session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly fields?: Fields,
  ) {
    super(error);
  }
}

export const notFound = () => new ApiError(404, "Not found.");
export const conflict = (message: string) => new ApiError(409, message);
export const invalid = (fields: Fields, error = SUMMARY) => new ApiError(422, error, fields);

export interface Reply {
  status: number;
  body?: unknown;
  bytes?: { data: Buffer; contentType: string };
  headers?: Record<string, string>;
}

type Access = "anyone" | "signed-in" | "signed-out";
type BodyKind = "none" | "json" | "multipart";

export interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  caller: User | null;
  /** The parsed body when it is within its limit and is a JSON object; otherwise null. */
  json: Record<string, unknown> | null;
  multipart: Multipart | null;
  now: number;
}

interface RouteSpec<F> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  access: Access;
  roles?: readonly Role[];
  body: BodyKind;
  /** Step 3: unknown or unseen ids in the path or the body answer 404. */
  find?: (ctx: Ctx) => Promise<F>;
  /** Step 4, beyond the role: a field this role may not send. */
  forbid?: (ctx: Ctx) => string | null;
  /** Step 7: field problems, listed in the endpoint's field order. */
  validate?: (ctx: Ctx, found: F) => Fields | null | Promise<Fields | null>;
  /** Steps 8 and 9 are thrown from here as `conflict(...)` or a provider-down ApiError. */
  handle: (ctx: Ctx, found: F) => Promise<Reply>;
}

interface Route {
  method: string;
  body: BodyKind;
  pattern: RegExp;
  keys: string[];
  run: (ctx: Ctx, raw: RawBody, sessionState: SessionState) => Promise<Reply>;
}

export function route<F = undefined>(spec: RouteSpec<F>): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" + spec.path.replace(/:([a-z_]+)/g, (_, key: string) => {
      keys.push(key);
      return "([^/]+)";
    }) + "$",
  );
  return { method: spec.method, body: spec.body, pattern, keys, run: (ctx, raw, sessionState) => runRoute(spec, ctx, raw, sessionState) };
}

function roleRefusal(roles: readonly Role[]): string {
  if (roles.length === 1 && roles[0] === "member") return "Only members can do that.";
  if (roles.length === 1 && roles[0] === "coordinator") return "Only the coordinator can do that.";
  return "Only desk staff can do that.";
}

export const STAFF: readonly Role[] = ["coordinator", "volunteer"];
export const COORDINATOR: readonly Role[] = ["coordinator"];
export const MEMBER: readonly Role[] = ["member"];

interface RawBody {
  present: boolean;
  contentType: string;
  contentTypeHeader: string;
  data: Buffer;
  tooLarge: boolean;
}

type SessionState = "none" | "ended" | "active";

async function runRoute<F>(spec: RouteSpec<F>, ctx: Ctx, raw: RawBody, sessionState: SessionState): Promise<Reply> {
  // 2. sign-in
  if (spec.access === "signed-in" && !ctx.caller) {
    throw new ApiError(401, sessionState === "ended" ? "Your session has ended. Sign in again." : "Sign in to continue.");
  }
  // Steps 3 and 4 may look inside a JSON object body within its limit, whatever its content type.
  if (spec.body === "json" && raw.present && !raw.tooLarge) ctx.json = parseObject(raw.data);
  // 3. unknown record
  const found = spec.find ? await spec.find(ctx) : (undefined as F);
  // 4. role
  if (spec.access === "signed-out" && ctx.caller) throw new ApiError(403, "Sign out before joining.");
  if (spec.roles && ctx.caller && !spec.roles.includes(ctx.caller.role)) throw new ApiError(403, roleRefusal(spec.roles));
  const forbidden = spec.forbid?.(ctx);
  if (forbidden) throw new ApiError(403, forbidden);
  // 5. content type
  if (raw.present) {
    const expected = spec.body === "multipart" ? "multipart/form-data" : "application/json";
    if (raw.contentType !== expected) throw new ApiError(415, "Send JSON.");
  }
  // 6. size
  if (raw.tooLarge) throw new ApiError(413, spec.body === "multipart" ? PHOTO_TOO_LARGE : "Request is too large.");
  if (spec.body === "json") ctx.json = raw.present ? parseObject(raw.data) : {};
  if (spec.body === "multipart") {
    ctx.multipart = parseMultipart(raw.data, raw.contentTypeHeader);
    if (ctx.multipart.files.photo && ctx.multipart.files.photo.data.length > 5_000_000) throw new ApiError(413, PHOTO_TOO_LARGE);
  }
  // 7. validation
  const fields = await spec.validate?.(ctx, found);
  if (fields && Object.keys(fields).length > 0) throw invalid(fields);
  // 8 and 9. conflict and provider down come from the handler.
  return spec.handle(ctx, found);
}

function parseObject(data: Buffer): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(data.toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  for (const piece of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = piece.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

interface Session {
  hash: string;
  user: User;
  state: SessionState;
}

/** Looks up the cookie's session; an ended session counts as signed out everywhere. */
export async function sessionOf(req: IncomingMessage, now: number): Promise<Session | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const hash = tokenHash(token);
  const row = await one<User & { last_activity_at: Date }>(
    pool,
    `SELECT u.id, u.name, u.email, u.role, s.last_activity_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [hash],
  );
  if (!row) return null;
  const { last_activity_at, ...user } = row;
  return { hash, user, state: sessionEnded(last_activity_at.getTime(), now) ? "ended" : "active" };
}

export async function recordActivity(hash: string): Promise<void> {
  await pool.query(`UPDATE sessions SET last_activity_at = now() WHERE token_hash = $1`, [hash]);
}

function ownOrigin(req: IncomingMessage): string[] {
  const host = req.headers.host ?? "";
  return [`http://${host}`, `https://${host}`];
}

function isWrite(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

async function readBody(req: IncomingMessage, limit: number): Promise<{ data: Buffer; tooLarge: boolean }> {
  const declared = Number(req.headers["content-length"] ?? "0");
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = declared > limit;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) tooLarge = true;
    if (!tooLarge) chunks.push(chunk);
  }
  return { data: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks), tooLarge };
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(text);
}

/** Runs one API request through the published refusal order and writes the one error shape. */
export async function dispatch(routes: readonly Route[], req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const now = Date.now();
  const method = req.method ?? "GET";
  const matched = routes
    .filter((r) => r.method === method)
    .map((r) => ({ r, m: r.pattern.exec(url.pathname) }))
    .find((x) => x.m !== null);
  const routeKind: BodyKind = matched ? matched.r.body : "json";
  const present = Number(req.headers["content-length"] ?? "0") > 0 || req.headers["transfer-encoding"] !== undefined;
  const body = await readBody(req, routeKind === "multipart" ? MULTIPART_LIMIT : JSON_LIMIT);
  const contentTypeHeader = String(req.headers["content-type"] ?? "");
  const raw = {
    present: present && (body.data.length > 0 || body.tooLarge),
    contentType: contentTypeHeader.split(";")[0]!.trim().toLowerCase(),
    contentTypeHeader,
    data: body.data,
    tooLarge: body.tooLarge,
  };
  let session: Session | null = null;
  let status = 500;
  try {
    // 1. cross-site
    const origin = req.headers.origin;
    if (isWrite(method) && origin !== undefined && !ownOrigin(req).includes(origin)) {
      throw new ApiError(403, "Cross-site request refused.");
    }
    session = await sessionOf(req, now);
    if (!matched) throw notFound();
    const params: Record<string, string> = {};
    matched.r.keys.forEach((key, i) => (params[key] = decodeURIComponent(matched.m![i + 1]!)));
    const ctx: Ctx = {
      req,
      params,
      query: url.searchParams,
      caller: session?.state === "active" ? session.user : null,
      json: null,
      multipart: null,
      now,
    };
    const reply = await matched.r.run(ctx, raw, session?.state ?? "none");
    status = reply.status;
    if (reply.bytes) {
      res.writeHead(reply.status, { "Content-Type": reply.bytes.contentType, ...reply.headers });
      res.end(reply.bytes.data);
    } else {
      sendJson(res, reply.status, reply.body, reply.headers);
    }
  } catch (error) {
    if (error instanceof ApiError) {
      status = error.status;
      sendJson(res, error.status, error.fields ? { error: error.error, fields: error.fields } : { error: error.error });
    } else {
      console.error(error);
      sendJson(res, 500, { error: "Something went wrong." });
    }
  }
  if (session?.state === "active" && isWrite(method) && status !== 401) await recordActivity(session.hash).catch(() => undefined);
}
