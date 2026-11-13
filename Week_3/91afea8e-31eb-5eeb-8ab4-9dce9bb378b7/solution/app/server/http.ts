import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Hono } from "hono";
import { ApiError, errorBody, FIELD, notFound, validationFailed } from "./errors.js";
import { checkRate } from "./ratelimit.js";
import { COOKIE, parseCookies, resolveActor, type Actor, type Role } from "./session.js";
import { isRecord } from "./validate.js";

const JSON_LIMIT_BYTES = 65_536;
const MULTIPART_LIMIT_BYTES = 5_300_000;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const STATE_CHANGING: readonly string[] = ["POST", "PUT", "PATCH", "DELETE"];

interface RouteSpec {
  /** `public` needs no session; otherwise the roles allowed on the route. */
  access: "public" | readonly Role[];
  rate?: { bucket: string; limit: number };
}

export interface Reply {
  status: number;
  json?: Record<string, unknown>;
  file?: { data: Uint8Array; contentType: string };
  cookies?: string[];
  headers?: Record<string, string>;
  /** Leave `server_time` out: the body carries exactly its published keys. */
  exact?: boolean;
}

export function ok(json: Record<string, unknown>, status = 200): Reply {
  return { status, json };
}

export function noContent(): Reply {
  return { status: 204 };
}

export interface Request {
  actor: Actor | null;
  params: Record<string, string>;
  query: URLSearchParams;
  header(name: string): string | undefined;
  cookies: Record<string, string>;
  ip: string;
  nowMs: number;
  /** The JSON body as an object; an empty body is `{}`. */
  json(): Record<string, unknown>;
  /** The single multipart field named `file`. */
  file(): { name: string; data: Uint8Array } | null;
  readonly method: string;
}

type Handler = (req: Request) => Promise<Reply>;

async function readLimited(c: Context, limit: number): Promise<Uint8Array> {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > limit) throw new ApiError(413, "too_large");
  const stream = c.req.raw.body;
  if (!stream) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > limit) throw new ApiError(413, "too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function checkOrigin(c: Context): void {
  const origin = c.req.header("origin");
  if (origin === undefined) return;
  const host = c.req.header("host") ?? "";
  if (origin !== `http://${host}` && origin !== `https://${host}`) throw new ApiError(403, "cross_site_request");
}

async function parseMultipart(c: Context, raw: Uint8Array): Promise<{ name: string; data: Uint8Array } | null> {
  const form = await new Response(new Blob([raw as BlobPart]), { headers: { "content-type": c.req.header("content-type") ?? "" } }).formData();
  const entry = form.get("file");
  if (!(entry instanceof File)) return null;
  return { name: entry.name, data: new Uint8Array(await entry.arrayBuffer()) };
}

function parseJson(raw: Uint8Array): Record<string, unknown> {
  if (raw.byteLength === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    throw validationFailed({ body: FIELD.badJson });
  }
  if (!isRecord(parsed)) throw validationFailed({ body: FIELD.badJson });
  return parsed;
}

async function run(c: Context, spec: RouteSpec, handler: Handler): Promise<Response> {
  const nowMs = Date.now();
  try {
    const method = c.req.method;
    const multipart = (c.req.header("content-type") ?? "").startsWith("multipart/form-data");
    const raw = STATE_CHANGING.includes(method) ? await readLimited(c, multipart ? MULTIPART_LIMIT_BYTES : JSON_LIMIT_BYTES) : new Uint8Array();
    if (STATE_CHANGING.includes(method)) checkOrigin(c);
    const cookies = parseCookies(c.req.header("cookie"));
    const actor = await resolveActor(cookies[COOKIE.access], nowMs);
    const ip = getConnInfo(c).remote.address ?? "unknown";
    if (spec.rate) await checkRate(`${spec.rate.bucket}:${actor ? `account:${actor.accountId}` : `ip:${ip}`}`, spec.rate.limit, nowMs);
    if (spec.access !== "public") {
      if (!actor) throw new ApiError(401, "signed_out");
      if (!spec.access.includes(actor.role)) throw new ApiError(403, "forbidden");
    }
    const params = c.req.param() as Record<string, string>;
    // Postgres cannot store a NUL byte in text: an id carrying one names nothing.
    if (Object.values(params).some((value) => value.includes("\0"))) throw notFound();
    const request: Request = {
      actor,
      params,
      query: new URL(c.req.url).searchParams,
      header: (name) => c.req.header(name),
      cookies,
      ip,
      nowMs,
      method,
      json: () => parseJson(raw),
      file: () => null,
    };
    if (multipart) {
      const file = await parseMultipart(c, raw);
      request.file = () => file;
    }
    const reply = await handler(request);
    return toResponse(reply, actor, nowMs);
  } catch (error) {
    if (error instanceof ApiError) {
      const response = c.json(errorBody(error), error.status as 400);
      if (error.status === 429) response.headers.set("Retry-After", String(error.extra.retry_after));
      return response;
    }
    console.error(error instanceof Error ? error.stack : error);
    return c.json(errorBody(new ApiError(500, "internal_error")), 500);
  }
}

function toResponse(reply: Reply, actor: Actor | null, nowMs: number): Response {
  const headers = new Headers(reply.headers);
  for (const cookie of reply.cookies ?? []) headers.append("Set-Cookie", cookie);
  if (reply.file) {
    headers.set("Content-Type", reply.file.contentType);
    return new Response(Buffer.from(reply.file.data), { status: reply.status, headers });
  }
  if (reply.json === undefined) return new Response(null, { status: reply.status, headers });
  const body = actor && !reply.exact ? { ...reply.json, server_time: new Date(nowMs).toISOString() } : reply.json;
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: reply.status, headers });
}

export function route(app: Hono, methods: readonly Method[], path: string, spec: RouteSpec, handler: Handler): void {
  app.on([...methods], path, (c) => run(c, spec, handler));
}

export function unknownApiRoute(c: Context): Response {
  return c.json(errorBody(notFound()), 404);
}
