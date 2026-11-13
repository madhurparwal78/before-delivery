// The one request pipeline: every API request is judged here, in the published order.
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, forbidden, malformedJson, methodNotAllowed, notFound, payloadTooLarge, sessionEnded, storageUnavailable, mailUnavailable, unauthenticated, unsupportedMediaType } from "./errors";
import { lockKey, pool, transaction } from "./db";
import type { Role } from "../shared/catalog";
import { MailDown } from "./mail";
import { StorageDown } from "./storage";

export interface SignedIn {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Context {
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  rawBody: Buffer;
  /** The parsed JSON body of a JSON route; an empty record on every other route. */
  body: Record<string, unknown>;
  photoFile: Buffer | null;
  member: SignedIn | null;
  sessionToken: string | null;
  now: Date;
}

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
}

export const reply = (status: number, json: unknown, headers?: Record<string, string>): Reply => ({ status, json, ...(headers ? { headers } : {}) });
export const noContent = (): Reply => ({ status: 204 });
export const file = (bytes: Buffer, contentType: string, headers: Record<string, string> = {}): Reply => ({ status: 200, bytes, headers: { "Content-Type": contentType, ...headers } });

type Access = "public" | "staff" | "desk" | "owner" | "books";

const ALLOWED: Record<Exclude<Access, "public" | "staff">, readonly (Role | undefined)[]> = {
  desk: ["owner", "assistant"],
  owner: ["owner"],
  books: ["owner", "bookkeeper"],
};

interface BodyKind {
  limit: number;
  contentType: string;
}

const JSON_BODY: BodyKind = { limit: 65_536, contentType: "application/json" };
const PHOTO_BODY: BodyKind = { limit: 6_000_000, contentType: "multipart/form-data" };
const SHEET_BODY: BodyKind = { limit: 2_000_000, contentType: "text/csv" };
const PHOTO_FILE_LIMIT = 5_000_000;
const OVER_PHOTO_LIMIT = "This photo is over 5,000,000 bytes.";

export const BODY = { json: JSON_BODY, photo: PHOTO_BODY, sheet: SHEET_BODY };

interface RouteBase {
  method: string;
  path: string;
  body?: BodyKind;
  /** Step 3 for a limit keyed on the request's email, judged as soon as the body is parsed. */
  bodyLimit?: (body: Record<string, unknown>, now: Date) => Promise<void>;
  /** Step 5: the resource named in the path or by a private token. */
  resource?: (context: Context) => Promise<void>;
  /** Sign-in and sign-out stay open to the bookkeeper, whose other writes are refused. */
  bookkeeperMayWrite?: true;
}

interface PublicRoute extends RouteBase {
  access: "public";
  /** A route public only for some resources; for the others it takes the desk role. */
  deskUnless?: (params: Record<string, string>, now: Date) => Promise<boolean>;
  handler: (context: Context) => Promise<Reply>;
}

interface MemberRoute extends RouteBase {
  access: Exclude<Access, "public">;
  /** Step 3 for a limit keyed on the signed-in member, judged as soon as the member is known. */
  memberLimit?: (member: SignedIn, now: Date) => Promise<void>;
  /** Step 9: the route answers a repeated request key from what it stored. */
  requestKey?: true;
  handler: (context: Context, member: SignedIn) => Promise<Reply>;
}

export type Route = PublicRoute | MemberRoute;

type CompiledRoute = Route & { pattern: RegExp };

let compiled: CompiledRoute[] = [];

export function publishRoutes(routes: Route[]): void {
  compiled = routes.map((route) => ({ ...route, pattern: new RegExp(`^${route.path.replace(/\{(\w+)\}/g, "(?<$1>[^/]+)")}$`) }));
}

function matchRoute(method: string, path: string): { route: CompiledRoute; params: Record<string, string> } {
  const onPath = compiled.flatMap((route) => {
    const match = route.pattern.exec(path);
    return match ? [{ route, params: { ...match.groups } }] : [];
  });
  const found = onPath.find(({ route }) => route.method === method);
  if (found) return found;
  if (onPath.length) throw methodNotAllowed(onPath.map(({ route }) => route.method));
  throw notFound();
}

/** Reads the body up to its limit; the rest of an oversized body is read and dropped, so the refusal is always delivered. */
function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    request.on("end", () => resolve(size > limit ? null : Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

/** The bytes of the multipart file part named `photo`, or null when the body has none. */
function photoPart(body: Buffer, contentType: string): Buffer | null {
  const boundary = /boundary="?([^";]+)"?/.exec(contentType)?.[1];
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start >= 0) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    const headerEnd = body.indexOf("\r\n\r\n", start);
    if (next < 0 || headerEnd < 0 || headerEnd > next) return null;
    if (/name="?photo"?/.test(body.subarray(start, headerEnd).toString("latin1"))) return body.subarray(headerEnd + 4, next - 2);
    start = next;
  }
  return null;
}

export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

function sessionCookie(request: IncomingMessage): string | null {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === "ourlet_session" && value) return value;
  }
  return null;
}

async function readSession(token: string | null, now: Date): Promise<SignedIn | ApiError> {
  if (!token) return unauthenticated();
  const { rows } = await pool.query<SignedIn & { ends_at: Date; ended_at: Date | null }>(
    `SELECT m.id, m.name, m.email, m.role, s.ends_at, s.ended_at FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = $1`,
    [tokenHash(token)],
  );
  const session = rows[0];
  if (!session) return unauthenticated();
  if (session.ended_at || now >= session.ends_at) return sessionEnded();
  return { id: session.id, name: session.name, email: session.email, role: session.role };
}

function checkRole(route: Route, access: Access, member: SignedIn | null, method: string): void {
  if (member?.role === "bookkeeper" && method !== "GET" && !route.bookkeeperMayWrite) throw forbidden();
  if (access !== "public" && access !== "staff" && !ALLOWED[access].includes(member?.role)) throw forbidden();
}

function parseJson(raw: Buffer): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw malformedJson();
  }
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KEY_LIFETIME_MS = 24 * 3_600_000;

/** Step 9: runs the route once per request key, inside one transaction, and answers repeats from what was stored. */
async function withRequestKey(context: Context, member: SignedIn, handler: MemberRoute["handler"]): Promise<Reply> {
  const key = context.headers["request-key"];
  if (typeof key !== "string" || key.length < 1 || key.length > 100) return handler(context, member);
  const bodyHash = createHash("sha256").update(JSON.stringify(context.body)).digest("hex");
  return transaction(async (db) => {
    await lockKey(db, `${member.id}:${key}`);
    const { rows } = await db.query<{ body_hash: string; status: number; response: string; created_at: Date }>(
      "SELECT body_hash, status, response, created_at FROM request_keys WHERE member_id = $1 AND key = $2",
      [member.id, key],
    );
    const seen = rows[0];
    if (seen && context.now.getTime() - seen.created_at.getTime() < KEY_LIFETIME_MS) {
      if (seen.body_hash !== bodyHash) throw new ApiError(409, "request_key_reused", "This request key was already used for a different request.");
      return { status: seen.status, bytes: Buffer.from(seen.response), headers: { "Content-Type": "application/json" } };
    }
    const answer = await handler(context, member).catch((error: unknown) => {
      if (error instanceof ApiError && error.status < 500) return reply(error.status, error.body());
      throw error;
    });
    await db.query(
      `INSERT INTO request_keys (member_id, key, body_hash, status, response, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (member_id, key) DO UPDATE SET body_hash = $3, status = $4, response = $5, created_at = $6`,
      [member.id, key, bodyHash, answer.status, JSON.stringify(answer.json), context.now],
    );
    return { status: answer.status, bytes: Buffer.from(JSON.stringify(answer.json)), headers: { "Content-Type": "application/json" } };
  });
}

async function judge(request: IncomingMessage, url: URL): Promise<Reply> {
  const now = new Date();
  const method = request.method ?? "GET";
  // 1. Unknown route or wrong method.
  const { route, params } = matchRoute(method, url.pathname);
  // 2. A body over its size limit, before parsing or authentication.
  const kind = route.body ?? JSON_BODY;
  const rawBody = await readBody(request, kind.limit);
  if (!rawBody) throw payloadTooLarge();
  const contentType = request.headers["content-type"] ?? "";
  const photoFile = route.body === PHOTO_BODY && contentType.startsWith(PHOTO_BODY.contentType) ? photoPart(rawBody, contentType) : null;
  if (photoFile && photoFile.length > PHOTO_FILE_LIMIT) throw payloadTooLarge(OVER_PHOTO_LIMIT);
  // 4. Authentication, with the limit keyed on the member judged as soon as the member is known (3).
  const sessionToken = sessionCookie(request);
  const session = await readSession(sessionToken, now);
  const member = session instanceof ApiError ? null : session;
  let access: Access = route.access;
  let dispatch: (context: Context) => Promise<Reply>;
  if (route.access === "public") {
    if (route.deskUnless && !(await route.deskUnless(params, now))) access = "desk";
    if (access !== "public" && session instanceof ApiError) throw session;
    dispatch = route.handler;
  } else {
    if (session instanceof ApiError) throw session;
    if (route.memberLimit) await route.memberLimit(session, now);
    dispatch = (context) => (route.requestKey ? withRequestKey(context, session, route.handler) : route.handler(context, session));
  }
  const context: Context = { params, query: url.searchParams, headers: request.headers, rawBody, body: {}, photoFile, member, sessionToken, now };
  // 5. The resource named in the path or by a private token.
  await route.resource?.(context);
  // 6. Role.
  checkRole(route, access, member, method);
  if (route.body) {
    // 7. Content type.
    if (!contentType.toLowerCase().startsWith(route.body.contentType)) throw unsupportedMediaType();
    // 8. Malformed JSON, with the limit keyed on the body's email judged as soon as it is read (3).
    if (route.body === JSON_BODY) context.body = parseJson(rawBody);
    await route.bodyLimit?.(context.body, now);
  }
  // 9. A repeated request key; steps 10 to 12 and the outage refusals belong to the handler, in that order.
  return dispatch(context);
}

function send(response: ServerResponse, answer: Reply): void {
  const bytes = answer.json === undefined ? answer.bytes : Buffer.from(JSON.stringify(answer.json));
  response.writeHead(answer.status, {
    ...(answer.json === undefined ? {} : { "Content-Type": "application/json" }),
    ...answer.headers,
    ...(bytes ? { "Content-Length": String(bytes.length) } : {}),
  });
  response.end(bytes);
}

const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;
  if (error instanceof StorageDown) return storageUnavailable("Storage can't be reached right now. Try again in a moment.");
  if (error instanceof MailDown) return mailUnavailable("Mail can't be sent right now. Try again in a moment.");
  console.error(error);
  return new ApiError(500, "internal_error", "Something went wrong on our side. Try again in a moment.");
};

export async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  try {
    send(response, await judge(request, url));
  } catch (error) {
    const refusal = toApiError(error);
    send(response, reply(refusal.status, refusal.body(), refusal.headers));
  }
}
