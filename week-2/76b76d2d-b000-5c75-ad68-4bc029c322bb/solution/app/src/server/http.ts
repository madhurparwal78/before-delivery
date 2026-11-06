import type { IncomingMessage, ServerResponse } from "node:http";
import { isLocale, type Locale, type Role } from "../shared/domain.ts";
import { config } from "./config.ts";
import { ApiError, errorBody } from "./errors.ts";
import { BillingFailure } from "./killbill.ts";
import { LOCALE_COOKIE, resolveSession, type Session } from "./sessions.ts";

const BODY_LIMIT = 16_384;

type Body = Record<string, unknown>;

export type Reply = { status: number; body?: unknown; text?: string; headers?: Record<string, string>; cookies?: string[] };

export type Context = {
  method: string;
  path: string;
  url: URL;
  params: Record<string, string>;
  headers: IncomingMessage["headers"];
  cookies: Record<string, string>;
  body: Body;
  session: Session | null;
  locale: Locale;
};

type Access = "anyone" | "signed-in" | Role;
type Route = { method: string; pattern: RegExp; access: Access; handler: (ctx: Context) => Promise<Reply> };

const routes: Route[] = [];

/** Registers an API route. `:name` segments become `ctx.params.name`. */
export function route(method: string, path: string, access: Access, handler: (ctx: Context) => Promise<Reply>): void {
  const pattern = new RegExp(`^${path.replace(/:([a-z_]+)/g, (_, name: string) => `(?<${name}>[^/]+)`)}$`);
  routes.push({ method, pattern, access, handler });
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}, cookies: string[] = []): Reply {
  return { status, body, headers, cookies };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    try {
      out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      continue;
    }
  }
  return out;
}

export function cookie(name: string, value: string, maxAgeSeconds: number | null = null): string {
  const age = maxAgeSeconds === null ? "" : `; Max-Age=${maxAgeSeconds}`;
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${age}`;
}

/** The locale rule (brief: Business rules). `header` is omitted for page requests. */
export function chooseLocale(header: string | undefined, cookies: Record<string, string>, session: Session | null, acceptLanguage: string | undefined): Locale {
  if (isLocale(header)) return header;
  if (isLocale(cookies[LOCALE_COOKIE])) return cookies[LOCALE_COOKIE];
  if (session) return session.account.locale;
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "fr";
}

async function readBody(req: IncomingMessage): Promise<Buffer | "too-large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  // An oversized body is still read to its end (and discarded): leaving it unread would stall the next request on
  // the same keep-alive connection.
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size <= BODY_LIMIT) chunks.push(buffer);
  }
  return size > BODY_LIMIT ? "too-large" : Buffer.concat(chunks);
}

/** A path parameter, percent-decoded once; a malformed escape or a control character names no record. */
function pathParam(raw: string): string {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    throw new ApiError("not_found");
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new ApiError("not_found");
  return value;
}

function parseBody(raw: Buffer, contentType: string | undefined): Body {
  if (raw.length === 0) return {};
  const media = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  if (media !== "application/json") throw new ApiError("unsupported_media_type");
  try {
    const value: unknown = JSON.parse(raw.toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Body) : {};
  } catch {
    throw new ApiError("invalid_json");
  }
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  return origin === new URL(config.publicUrl).origin || origin === `http://${req.headers.host ?? ""}`;
}

function allowed(access: Access, session: Session | null): void {
  if (access === "anyone") return;
  if (!session) throw new ApiError("unauthenticated");
  if (access !== "signed-in" && session.account.role !== access) throw new ApiError("forbidden");
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.cookies?.length) headers["Set-Cookie"] = reply.cookies;
  if (reply.text !== undefined) {
    res.writeHead(reply.status, headers).end(reply.text);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers).end();
    return;
  }
  headers["Content-Type"] = "application/json; charset=utf-8";
  res.writeHead(reply.status, headers).end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
}

function errorReply(error: ApiError, locale: Locale): Reply {
  const { status, body, headers } = errorBody(error, locale);
  return { status, body, headers };
}

/** Handles one `/api/…` request through the published error precedence. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const session = await resolveSession(cookies);
  const header = req.headers["x-halide-locale"];
  const locale = chooseLocale(typeof header === "string" ? header : undefined, cookies, session, req.headers["accept-language"]);
  try {
    const method = req.method ?? "GET";
    const raw = await readBody(req);
    if (raw === "too-large") throw new ApiError("body_too_large");
    const body = parseBody(raw, req.headers["content-type"]);
    if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) throw new ApiError("cross_origin");
    const candidates = routes.filter((r) => r.pattern.test(url.pathname));
    const match = candidates.find((r) => r.method === method);
    const chosen = match ?? candidates[0];
    if (!chosen) throw new ApiError("not_found");
    allowed(chosen.access, session);
    if (!match) throw new ApiError("method_not_allowed", {}, { allow: [...new Set(candidates.map((r) => r.method))].join(", ") });
    const params = Object.fromEntries(
      Object.entries(chosen.pattern.exec(url.pathname)?.groups ?? {}).map(([key, value]) => [key, pathParam(value)]),
    );
    const reply = await chosen.handler({ method, path: url.pathname, url, params, headers: req.headers, cookies, body, session, locale });
    send(res, reply);
  } catch (caught) {
    const error = caught instanceof BillingFailure ? new ApiError("billing_unavailable") : caught;
    if (error instanceof ApiError) {
      req.resume();
      send(res, errorReply(error, locale));
      return;
    }
    throw error;
  }
}
