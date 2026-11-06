// The API boundary: route matching, the published error precedence, body limits, sessions and JSON replies.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { pool } from "./db.ts";
import { ApiError } from "./errors.ts";

const BODY_LIMIT = 65_536;
const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHOD_ORDER)[number];

export type Role = "customer" | "admin" | "dealer" | "support";
type StaffRole = Exclude<Role, "customer">;
export type Who = "anyone" | "signed_in" | "customer" | readonly StaffRole[];

export interface User {
  id: number;
  email: string;
  role: Role;
}

export interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  headers: IncomingMessage["headers"];
  user: User | null;
  sessionHash: string | null;
  cookies: Record<string, string>;
  setCookie(cookie: string): void;
}

/** A context whose route requires a signed-in user. */
export type AuthedCtx = Ctx & { user: User; sessionHash: string };

export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

type Handler = (ctx: Ctx) => Promise<Reply>;
export interface Endpoint {
  who: Who;
  handler: Handler;
}
export type RouteTable = Record<string, Partial<Record<Method, Endpoint>>>;

export const SESSION_COOKIE = "tf_session";
export const CART_COOKIE = "tf_cart";
const COOKIE_AGE = 34_560_000;

export function cookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_AGE}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function ok(body: unknown, status = 200): Reply {
  return { status, body };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

interface Match {
  methods: Partial<Record<Method, Endpoint>>;
  params: Record<string, string>;
}

function match(routes: RouteTable, path: string): Match | null {
  const parts = path.split("/").slice(1);
  let best: { match: Match; literal: number } | null = null;
  for (const [pattern, methods] of Object.entries(routes)) {
    const want = pattern.split("/").slice(1);
    if (want.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let literal = 0;
    let fits = true;
    for (const [i, segment] of want.entries()) {
      const actual = parts[i] ?? "";
      if (segment.startsWith(":")) {
        if (actual === "") fits = false;
        else {
          try {
            params[segment.slice(1)] = decodeURIComponent(actual);
          } catch {
            fits = false;
          }
        }
      } else if (segment === actual) literal += 1;
      else fits = false;
      if (!fits) break;
    }
    if (fits && (!best || literal > best.literal)) best = { match: { methods, params }, literal };
  }
  return best?.match ?? null;
}

/** Every JSON reply of the server, API errors and the start-up 503 included, is written here. */
export function send(res: ServerResponse, reply: Reply, head = false): void {
  const payload = JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
    ...reply.headers,
  });
  res.end(head ? undefined : payload);
}

export function errorReply(error: ApiError): Reply {
  return { status: error.status, body: error.body(), headers: error.headers };
}

const DRAIN_LIMIT = 1_048_576;

/** Reads the body; an oversized one is drained (up to a bound) so the 413 reply reaches the client. */
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size <= BODY_LIMIT) chunks.push(buffer);
    if (size > DRAIN_LIMIT) break;
  }
  if (size > BODY_LIMIT) throw new ApiError("payload_too_large", { headers: { Connection: "close" } });
  return Buffer.concat(chunks);
}

function parseBody(raw: Buffer, contentType: string | undefined): Record<string, unknown> {
  if (raw.length === 0) return {};
  if (!/^application\/json\s*(;|$)/i.test(contentType ?? "")) throw new ApiError("unsupported_media_type");
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError("bad_request");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApiError("bad_request");
  return value as Record<string, unknown>;
}

export async function sessionUser(hash: string): Promise<User | null> {
  const { rows } = await pool.query<User>(
    "SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [hash],
  );
  return rows[0] ?? null;
}

function authorize(who: Who, user: User | null): void {
  if (who === "anyone") return;
  if (!user) throw new ApiError("unauthorized");
  if (who === "signed_in") return;
  if (who === "customer") {
    if (user.role !== "customer") throw new ApiError("forbidden");
    return;
  }
  if (user.role === "customer" || !who.includes(user.role)) throw new ApiError("forbidden");
}

export async function handleApi(routes: RouteTable, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const head = req.method === "HEAD";
  const method = (head ? "GET" : (req.method ?? "GET")) as Method;
  try {
    const found = match(routes, url.pathname);
    if (!found) throw new ApiError("not_found");
    const endpoint = found.methods[method];
    if (!endpoint) {
      const allow = METHOD_ORDER.filter((m) => found.methods[m]).join(", ");
      throw new ApiError("method_not_allowed", { headers: { Allow: allow } });
    }
    const body = parseBody(await readBody(req), req.headers["content-type"]);
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    const sessionHash = token ? tokenHash(token) : null;
    const user = sessionHash ? await sessionUser(sessionHash) : null;
    authorize(endpoint.who, user);
    const setCookies: string[] = [];
    const reply = await endpoint.handler({
      params: found.params,
      query: url.searchParams,
      body,
      headers: req.headers,
      user,
      sessionHash: user ? sessionHash : null,
      cookies,
      setCookie: (c) => setCookies.push(c),
    });
    if (setCookies.length) res.setHeader("Set-Cookie", setCookies);
    send(res, reply, head);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("unexpected API fault:", error);
    if (!req.complete) req.resume();
    send(res, errorReply(error instanceof ApiError ? error : new ApiError("internal_error")), head);
  }
}
