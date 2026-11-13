// The one request pipeline. Every API route goes through `serveApi`, which applies the brief's
// error precedence once: 413/415, 403 cross_origin, 401, 400, idempotency, 404, 403 role, 422, then
// the route's own 409/503 and success.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Role } from "../shared/api.js";
import { requireFreshConfirmation, sessionCaller, SESSION_COOKIE, type Caller, type TenantCaller } from "./auth.js";
import { SECURITY_HEADERS } from "./headers.js";
import { ApiError, FORBIDDEN, INTERNAL, NOT_FOUND, UNACCEPTED, type FieldErrors } from "./errors.js";
import { beginKey, fingerprint, isIdempotencyKey, releaseKey, storeResponse, type KeyClaim } from "./idempotency.js";
import { db } from "./db.js";
import { boundaryOf, parseMultipart, type Part } from "./multipart.js";

export type Access = "yes" | "own" | "no";
export type RoleTable = Readonly<Record<Role, Access>>;

const JSON_LIMIT = 65_536;
const UPLOAD_LIMIT = 6_000_000;
const DRAIN_LIMIT = 64_000_000;
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MALFORMED_BODY = "The request body could not be read.";

type BodySpec =
  /** `nullIsAbsent` lists optional fields whose null means the same as leaving them out. */
  | { kind: "json"; fields: readonly string[]; nullIsAbsent?: readonly string[] }
  | { kind: "multipart"; fields: (parts: ReadonlyMap<string, Part>) => readonly string[] };

const NO_BODY: BodySpec = { kind: "json", fields: [] };

export interface Context<C extends Caller | null = Caller | null> {
  caller: C;
  /** Every path parameter in the route list is `:id`. */
  params: { readonly id: string };
  query: URLSearchParams;
  json: Readonly<Record<string, unknown>>;
  parts: ReadonlyMap<string, Part>;
  token: string | null;
}

/** The context of a route the role table guards: the caller is signed in. */
export type SignedIn = Context<Caller>;
/** The context of a route only tenants reach, for their own records. */
type TenantContext = Context<TenantCaller>;

interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  headers?: Readonly<Record<string, string>>;
}

/** Writes failing fields into `errors`; the value is used only when no field failed. */
type Validate<T> = (ctx: Context, errors: FieldErrors) => T | Promise<T>;

export const nothing: Validate<undefined> = () => undefined;

/** The record named in the path or query: its owning tenant, null when no such record exists, undefined when none is named. */
type Owner = (ctx: SignedIn) => Promise<string | null | undefined>;

interface Common<T> {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: BodySpec;
  validate: Validate<T>;
  /** A money action: needs a password confirmed within REAUTH_SECONDS (step 9 of the precedence). */
  stepUp?: (ctx: Context) => boolean;
  /** Reads that also refuse a foreign Origin (the door list and the report). */
  refuseForeignOrigin?: boolean;
}

interface OpenDef<T> extends Common<T> {
  access: "open";
  handle: (ctx: Context, input: T) => Promise<Reply>;
}

interface GuardedDef<T> extends Common<T> {
  access: RoleTable;
  owner?: Owner;
  handle: (ctx: SignedIn, input: T) => Promise<Reply>;
}

interface TenantDef<T> extends Common<T> {
  access: "tenant";
  owner?: Owner;
  handle: (ctx: TenantContext, input: T) => Promise<Reply>;
}

/** A tenant route that requires an Idempotency-Key; its handler receives the running key. */
interface KeyedDef<T> extends Common<T> {
  access: "keyed";
  owner?: Owner;
  /** Step 6: counted for a tenant caller after the key lookup; may refuse with 429. */
  admit?: (caller: TenantCaller) => Promise<void>;
  handle: (ctx: TenantContext, input: T, key: KeyClaim, print: string) => Promise<Reply>;
}

interface RouteShape {
  method: string;
  path: string;
  segments: readonly string[];
  body: BodySpec;
  stepUp: ((ctx: Context) => boolean) | null;
  refuseForeignOrigin: boolean;
}

interface OpenRoute extends RouteShape {
  access: "open";
  run: (ctx: Context, errors: FieldErrors) => Promise<Reply>;
}

interface GuardedRoute extends RouteShape {
  access: RoleTable;
  owner: Owner | null;
  run: (ctx: SignedIn, errors: FieldErrors) => Promise<Reply>;
}

interface TenantRoute extends RouteShape {
  access: "tenant";
  owner: Owner | null;
  run: (ctx: TenantContext, errors: FieldErrors) => Promise<Reply>;
}

interface KeyedRoute extends RouteShape {
  access: "keyed";
  owner: Owner | null;
  admit: ((caller: TenantCaller) => Promise<void>) | null;
  run: (ctx: TenantContext, errors: FieldErrors, key: KeyClaim, print: string) => Promise<Reply>;
}

export type Route = OpenRoute | GuardedRoute | TenantRoute | KeyedRoute;

async function validated<T>(validate: Validate<T>, ctx: Context, errors: FieldErrors): Promise<T> {
  const input = await validate(ctx, errors);
  if (Object.keys(errors).length > 0) throw new ApiError(422, "validation_failed", "Some fields need attention.", errors);
  return input;
}

export function route<T>(def: OpenDef<T> | GuardedDef<T> | TenantDef<T> | KeyedDef<T>): Route {
  const shape = {
    method: def.method, path: def.path, segments: def.path.split("/").filter(Boolean), body: def.body ?? NO_BODY,
    stepUp: def.stepUp ?? null, refuseForeignOrigin: def.refuseForeignOrigin ?? false,
  };
  if (def.access === "open") {
    return { ...shape, access: "open", run: async (ctx, errors) => def.handle(ctx, await validated(def.validate, ctx, errors)) };
  }
  if (def.access === "keyed") {
    return { ...shape, access: "keyed", owner: def.owner ?? null, admit: def.admit ?? null, run: async (ctx, errors, key, print) => def.handle(ctx, await validated(def.validate, ctx, errors), key, print) };
  }
  if (def.access === "tenant") {
    return { ...shape, access: "tenant", owner: def.owner ?? null, run: async (ctx, errors) => def.handle(ctx, await validated(def.validate, ctx, errors)) };
  }
  return { ...shape, access: def.access, owner: def.owner ?? null, run: async (ctx, errors) => def.handle(ctx, await validated(def.validate, ctx, errors)) };
}

function match(routes: readonly Route[], method: string, pathname: string): { route: Route; id: string } | null {
  const segments = pathname.split("/").filter(Boolean);
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.segments.length !== segments.length) continue;
    const fits = candidate.segments.every((segment, i) => segment === ":id" || segment === segments[i]);
    if (fits) return { route: candidate, id: segments[candidate.segments.indexOf(":id")] ?? "" };
  }
  return null;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else if (size > DRAIN_LIMIT) req.destroy();
    });
    req.on("end", () => resolve(size > limit ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function cookie(req: IncomingMessage, name: string): string | null {
  for (const pair of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unaccepted(body: BodySpec, json: Readonly<Record<string, unknown>>, parts: ReadonlyMap<string, Part>): FieldErrors {
  const allowed = body.kind === "json" ? body.fields : body.fields(parts);
  const sent = body.kind === "json" ? Object.keys(json) : [...parts.keys()];
  return Object.fromEntries(sent.filter((name) => !allowed.includes(name)).map((name) => [name, UNACCEPTED]));
}

function write(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, "Cache-Control": "no-store", ...reply.headers };
  const body = reply.bytes ?? (reply.json === undefined ? null : Buffer.from(JSON.stringify(reply.json)));
  if (body === null) {
    res.writeHead(reply.status, headers).end();
    return;
  }
  const typed = reply.bytes ? headers : { "Content-Type": "application/json; charset=utf-8", ...headers };
  res.writeHead(reply.status, { ...typed, "Content-Length": String(body.length) }).end(body);
}

/** 404 for an unknown record or another tenant's, then 403 for a role the route is closed to. */
async function ownerCheck(owner: Owner | null, ctx: SignedIn): Promise<void> {
  if (!owner) return;
  const named = await owner(ctx);
  if (named === null || (named !== undefined && ctx.caller.role === "tenant" && named !== ctx.caller.tenantId)) throw NOT_FOUND();
}

function asTenant(ctx: SignedIn): TenantContext {
  const { caller } = ctx;
  if (caller.role !== "tenant") throw FORBIDDEN();
  return { ...ctx, caller };
}

/** Step 9: the money actions need a fresh password confirmation, judged once the route is open to the caller. */
async function stepUp(r: RouteShape, ctx: SignedIn): Promise<void> {
  if (r.stepUp?.(ctx) && ctx.token) await requireFreshConfirmation(ctx.token);
}

async function runGuarded(r: GuardedRoute | TenantRoute, ctx: SignedIn, errors: FieldErrors): Promise<Reply> {
  await ownerCheck(r.owner, ctx);
  if (r.access === "tenant") {
    const tenant = asTenant(ctx);
    await stepUp(r, ctx);
    return r.run(tenant, errors);
  }
  if (r.access[ctx.caller.role] === "no") throw FORBIDDEN();
  await stepUp(r, ctx);
  return r.run(ctx, errors);
}

async function runKeyed(r: KeyedRoute, ctx: SignedIn, errors: FieldErrors, key: string, print: string): Promise<Reply> {
  const begun = await beginKey(ctx.caller.userId, `${r.method} ${r.path}`, key, print);
  if (begun.kind === "replay") {
    return { status: begun.status, bytes: Buffer.from(begun.body), headers: { "Content-Type": "application/json; charset=utf-8", "Idempotent-Replay": "true" } };
  }
  const { claim } = begun;
  try {
    if (ctx.caller.role === "tenant" && r.admit) await r.admit(ctx.caller);
    await ownerCheck(r.owner, ctx);
    const tenant = asTenant(ctx);
    await stepUp(r, ctx);
    const reply = await r.run(tenant, errors, claim, print);
    const text = JSON.stringify(reply.json);
    await storeResponse(db, claim, print, reply.status, text);
    return { ...reply, json: undefined, bytes: Buffer.from(text), headers: { ...reply.headers, "Content-Type": "application/json; charset=utf-8" } };
  } catch (error) {
    await releaseKey(claim).catch(() => undefined);
    throw error;
  }
}

/** The cross-site rule: a foreign or null Origin, or no Origin with a Sec-Fetch-Site other than same-origin. */
function crossSite(req: IncomingMessage, route: RouteShape): boolean {
  const changes = STATE_CHANGING.has(req.method ?? "GET");
  if (!changes && !route.refuseForeignOrigin) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) return origin !== `http://${req.headers.host ?? ""}`;
  const site = req.headers["sec-fetch-site"];
  return changes && site !== undefined && site !== "same-origin";
}

async function process(req: IncomingMessage, url: URL, found: { route: Route; id: string }): Promise<Reply> {
  const { route: r, id } = found;
  const method = req.method ?? "GET";
  const raw = await readBody(req, r.body.kind === "multipart" ? UPLOAD_LIMIT : JSON_LIMIT);
  if (raw === null) throw new ApiError(413, "payload_too_large", "The request body is too large.");
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  if (method !== "GET") {
    const wrongType = r.body.kind === "multipart"
      ? !contentType.startsWith("multipart/form-data")
      : raw.length > 0 && !/^application\/json\s*(;|$)/.test(contentType);
    if (wrongType) throw new ApiError(415, "unsupported_media_type", "This endpoint does not accept that content type.");
  }
  if (crossSite(req, r)) throw new ApiError(403, "cross_origin", "This request came from another site.");
  const token = cookie(req, SESSION_COOKIE);
  const caller = token ? await sessionCaller(token) : null;
  if (r.access !== "open" && !caller) throw new ApiError(401, "unauthenticated", "Sign in to continue.");

  let json: Record<string, unknown> = {};
  let parts: ReadonlyMap<string, Part> = new Map();
  if (r.body.kind === "multipart") {
    const boundary = boundaryOf(req.headers["content-type"] ?? "");
    const parsed = boundary ? parseMultipart(raw, boundary) : null;
    if (!parsed) throw new ApiError(400, "malformed_body", MALFORMED_BODY);
    parts = parsed;
  } else if (method !== "GET" && raw.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      throw new ApiError(400, "malformed_body", MALFORMED_BODY);
    }
    if (!isPlainObject(parsed)) throw new ApiError(400, "malformed_body", MALFORMED_BODY);
    json = parsed;
  }
  const ctx: Context = { caller, params: { id }, query: url.searchParams, json, parts, token };
  const errors = unaccepted(r.body, json, parts);
  if (r.access === "open") return r.run(ctx, errors);
  if (!caller) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  const signed: SignedIn = { ...ctx, caller };
  if (r.access !== "keyed") return runGuarded(r, signed, errors);

  const keyHeader = req.headers["idempotency-key"];
  const key = typeof keyHeader === "string" ? keyHeader : undefined;
  if (!isIdempotencyKey(key)) {
    throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header of 1 to 100 visible characters.");
  }
  const nullIsAbsent = r.body.kind === "json" ? r.body.nullIsAbsent ?? [] : [];
  const body = Object.fromEntries(Object.entries(json).filter(([name, value]) => !(value === null && nullIsAbsent.includes(name))));
  const print = fingerprint({ body, id });
  return runKeyed(r, signed, errors, key, print);
}

export async function serveApi(routes: readonly Route[], req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const found = match(routes, req.method ?? "GET", url.pathname);
  try {
    if (!found) {
      await readBody(req, 0);
      throw NOT_FOUND();
    }
    write(res, await process(req, url, found));
  } catch (error) {
    if (error instanceof ApiError) {
      write(res, { status: error.status, json: error.body(), headers: error.headers });
    } else {
      console.error(`${req.method} ${url.pathname} failed:`, error);
      const internal = INTERNAL();
      write(res, { status: internal.status, json: internal.body() });
    }
  }
}
