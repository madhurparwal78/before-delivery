// The API pipeline in the published precedence: whole-request boundary rejections (403 cross_origin, 413, 415),
// then 401, then 403 by role; each handler continues with 404, idempotent replay, state conflicts, validation,
// judged conflicts and outages.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Role, User } from "../../shared/api.js";
import { ApiError } from "./errors.js";
import { currentUser } from "./sessions.js";

const JSON_LIMIT = 100_000;
const MULTIPART_LIMIT = 31_000_000;
const PHOTO_MAX_BYTES = 5_000_000;

/** The path and query of a request's target, split without resolving it against any host. */
export interface RequestTarget { pathname: string; searchParams: URLSearchParams }
export interface UploadedFile { name: string; bytes: Buffer; tooLarge: boolean }
export interface Multipart { fields: Record<string, string>; files: UploadedFile[] }

export interface Request<U extends User | null = User> {
  method: string; path: string; query: URLSearchParams; headers: IncomingMessage["headers"];
  body: unknown; multipart: Multipart | null; user: U;
}

export type Reply =
  | { status: number; json: unknown; cookie?: string }
  | { status: number; raw: string }
  | { status: number; bytes: Buffer; type: string; disposition?: string }
  | { status: 204; cookie: string };

type Method = "GET" | "POST" | "DELETE";
type Handler<U extends User | null> = (request: Request<U>, params: string[]) => Promise<Reply>;
interface RouteBase { method: Method; pattern: RegExp; body?: "json" | "multipart" }

export type Route = RouteBase & (
  | { access: "anyone"; handle: Handler<User | null> }
  | { access: "signed-in" | readonly Role[]; handle: Handler<User> });

/** An endpoint open to anyone (health, sign-in, the signing page). */
export function openRoute(method: Method, pattern: RegExp, handle: Handler<User | null>, body?: "json"): Route {
  return { method, pattern, access: "anyone", handle, body };
}

/** An endpoint open only to signed-in users of the listed roles. */
export function route(method: Method, pattern: RegExp, access: "signed-in" | readonly Role[], handle: Handler<User>,
  body?: "json" | "multipart"): Route {
  return { method, pattern, access, handle, body };
}

/** Reads the whole body, refusing once it passes `limit` bytes (the remainder is drained, not kept). */
async function readBody(message: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of message as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  return size > limit ? null : Buffer.concat(chunks);
}

async function drain(message: IncomingMessage): Promise<void> {
  for await (const _ of message as AsyncIterable<Buffer>) { /* discard */ }
}

function payloadTooLarge(): ApiError {
  return new ApiError(413, "payload_too_large", "The request body is too large.");
}

function unsupportedMediaType(): ApiError {
  return new ApiError(415, "unsupported_media_type", "Send this request as application/json.");
}

/** Parses an already size-checked multipart body with Node's built-in Fetch API form-data reader. */
async function parseMultipart(contentType: string, raw: Buffer): Promise<Multipart> {
  const form = await new Response(raw, { headers: { "content-type": contentType } }).formData();
  const result: Multipart = { fields: {}, files: [] };
  for (const [name, value] of form) {
    if (typeof value === "string") result.fields[name] = value;
    else if (name === "photos") {
      const bytes = Buffer.from(await value.arrayBuffer());
      result.files.push({ name: value.name, bytes, tooLarge: bytes.length > PHOTO_MAX_BYTES });
    }
  }
  return result;
}

/** Host and port a request was sent to, from its Host header. */
function sameOrigin(origin: string, host: string | undefined): boolean {
  if (origin === "null" || host === undefined) return false;
  try {
    const from = new URL(origin);
    const to = new URL(`http://${host}`);
    return from.hostname.toLowerCase() === to.hostname.toLowerCase() && from.port === to.port;
  } catch {
    return false;
  }
}

/** Step 1: whole-request boundary rejections, then the body itself. */
async function boundary(message: IncomingMessage, route: Route | undefined): Promise<Pick<Request, "body" | "multipart">> {
  const method = message.method ?? "GET";
  const origin = message.headers.origin;
  if (!["GET", "HEAD"].includes(method) && origin !== undefined && !sameOrigin(origin, message.headers.host)) {
    await drain(message);
    throw new ApiError(403, "cross_origin", "Cross-origin requests are not accepted.");
  }
  const declared = Number(message.headers["content-length"] ?? "0");
  const hasBody = declared > 0 || message.headers["transfer-encoding"] !== undefined;
  const type = (message.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (route?.body === "multipart") {
    if (type !== "multipart/form-data") {
      await drain(message);
      throw new ApiError(415, "unsupported_media_type", "Send condition photos as multipart/form-data.");
    }
    if (declared > MULTIPART_LIMIT) {
      await drain(message);
      throw payloadTooLarge();
    }
    const raw = await readBody(message, MULTIPART_LIMIT);
    if (raw === null) throw payloadTooLarge();
    return { body: null, multipart: await parseMultipart(message.headers["content-type"] ?? "", raw).catch(() => ({ fields: {}, files: [] })) };
  }
  if (!hasBody) return { body: {}, multipart: null };
  if (type !== "application/json") {
    await drain(message);
    throw unsupportedMediaType();
  }
  if (declared > JSON_LIMIT) {
    await drain(message);
    throw payloadTooLarge();
  }
  const raw = await readBody(message, JSON_LIMIT);
  if (raw === null) throw payloadTooLarge();
  try {
    return { body: raw.length === 0 ? {} : JSON.parse(raw.toString("utf8")), multipart: null };
  } catch {
    return { body: null, multipart: null };
  }
}

function send(response: ServerResponse, reply: Reply): void {
  if ("json" in reply || "raw" in reply) {
    const text = "raw" in reply ? reply.raw : JSON.stringify(reply.json);
    response.writeHead(reply.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
      ...("cookie" in reply && reply.cookie ? { "set-cookie": reply.cookie } : {}) });
    response.end(text);
  } else if ("bytes" in reply) {
    response.writeHead(reply.status, { "content-type": reply.type, "cache-control": "private, no-store",
      ...(reply.disposition ? { "content-disposition": reply.disposition } : {}) });
    response.end(reply.bytes);
  } else {
    response.writeHead(204, { "cache-control": "no-store", "set-cookie": reply.cookie });
    response.end();
  }
}

export function sendError(response: ServerResponse, error: ApiError): void {
  send(response, { status: error.status, json: error.body() });
}

export function createApi(routes: readonly Route[], beforeEach: () => Promise<void>) {
  return async (message: IncomingMessage, response: ServerResponse, url: RequestTarget): Promise<void> => {
    let matched: { route: Route; params: string[] } | undefined;
    for (const route of routes) {
      const found = route.method === message.method ? route.pattern.exec(url.pathname) : null;
      if (found) {
        try {
          matched = { route, params: found.slice(1).map((part) => decodeURIComponent(part)) };
        } catch {
          matched = undefined;
        }
        break;
      }
    }
    try {
      const { body, multipart } = await boundary(message, matched?.route);
      if (!matched) throw new ApiError(404, "not_found", "No such endpoint.");
      await beforeEach();
      const user = await currentUser(message.headers.cookie);
      const { route, params } = matched;
      const base = { method: message.method ?? "GET", path: url.pathname, query: url.searchParams,
        headers: message.headers, body, multipart };
      if (route.access === "anyone") {
        send(response, await route.handle({ ...base, user }, params));
        return;
      }
      if (user === null) throw new ApiError(401, "unauthenticated", "Sign in first.");
      if (route.access !== "signed-in" && !route.access.includes(user.role)) {
        throw new ApiError(403, "forbidden", "Your role can't use this.");
      }
      send(response, await route.handle({ ...base, user }, params));
    } catch (error) {
      if (error instanceof ApiError) {
        sendError(response, error);
        return;
      }
      console.error(`${message.method} ${url.pathname} failed`, error);
      sendError(response, new ApiError(500, "internal_error", "Something went wrong. Nothing was changed."));
    }
  };
}
