// The HTTP layer: routing, body limits, content types and JSON responses.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { apiError, type HttpError, type Json } from './errors.ts';
import type { Session } from './sessions.ts';

export const JSON_LIMIT = 1_000_000;
export const UPLOAD_REQUEST_LIMIT = 10_100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  params: Record<string, string>;
  clientAddress: string;
  rawBody: Buffer;
  body: unknown;
  raw: IncomingMessage;
  res: ServerResponse;
  /** The device session, set for every route behind the session cookie. */
  session: Session;
}

export interface Reply {
  status: number;
  body?: Json;
  headers?: Record<string, string>;
  /** Pre-serialised JSON, sent byte for byte (idempotent replays). */
  rawJson?: string;
  bytes?: Buffer;
}

export type BodyKind = 'json' | 'multipart' | 'none';

export function header(req: { headers: IncomingMessage['headers'] }, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function mediaType(req: IncomingMessage): string {
  return (header(req, 'content-type') ?? '').split(';')[0].trim().toLowerCase();
}

/** Reads the request body, refusing 413 past `limit` bytes (exactly `limit` is allowed). */
export async function readBody(raw: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(header(raw, 'content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    raw.resume();
    throw apiError(413, 'too_large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of raw as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      raw.resume();
      throw apiError(413, 'too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** 413 then 415 for the route's body kind; JSON is parsed (an unparsable body answers 422). */
export async function acceptBody(raw: IncomingMessage, kind: BodyKind): Promise<{ rawBody: Buffer; body: unknown }> {
  const limit = kind === 'multipart' ? UPLOAD_REQUEST_LIMIT : JSON_LIMIT;
  const rawBody = await readBody(raw, limit);
  const type = mediaType(raw);
  if (kind === 'multipart') {
    if (type !== 'multipart/form-data') throw apiError(415, 'unsupported_media_type');
    return { rawBody, body: null };
  }
  const hasBody = rawBody.length > 0 || type !== '';
  if (!hasBody) return { rawBody, body: kind === 'json' ? undefined : null };
  if (type !== 'application/json') throw apiError(415, 'unsupported_media_type');
  if (rawBody.length === 0) return { rawBody, body: undefined };
  try {
    return { rawBody, body: JSON.parse(rawBody.toString('utf8')) as unknown };
  } catch {
    // An unparsable body carries no fields, so each route's field rules report it as 422.
    return { rawBody, body: null };
  }
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...reply.headers };
  let payload: Buffer | string | undefined;
  if (reply.bytes) payload = reply.bytes;
  else if (reply.rawJson !== undefined) payload = reply.rawJson;
  else if (reply.body !== undefined) payload = JSON.stringify(reply.body);
  if (payload !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (payload !== undefined) headers['Content-Length'] = String(Buffer.byteLength(payload));
  res.writeHead(reply.status, headers);
  res.end(payload);
}

export function errorReply(error: HttpError): Reply {
  return { status: error.status, body: error.body, headers: error.headers };
}

type Handler = (req: Request) => Promise<Reply>;
export interface RouteOptions {
  /** Open without the session cookie (health, sign-in). */
  open?: boolean;
  /** Takes an optional Idempotency-Key with replay. */
  idempotent?: boolean;
}

export interface Route extends RouteOptions {
  method: string;
  pattern: RegExp;
  keys: string[];
  body: BodyKind;
  handler: Handler;
}

/** `/api/objects/:id` -> a matcher; every `:param` must be a UUID, other values do not match. */
export function route(method: string, path: string, body: BodyKind, handler: Handler, options: RouteOptions = {}): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:(\w+)/g, (_, key: string) => {
      keys.push(key);
      return '([^/]+)';
    }) + '$',
  );
  return { method, pattern, keys, body, handler, ...options };
}

export interface Match {
  route: Route;
  params: Record<string, string>;
  /** A path parameter that is not a UUID names no resource. */
  unknownResource: boolean;
}

export function match(routes: Route[], method: string, path: string): Match | 'method' | null {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.pattern.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])));
    return { route: r, params, unknownResource: Object.values(params).some((v) => !isUuid(v)) };
  }
  return pathMatched ? 'method' : null;
}

export const ok = (body: Json, status = 200): Reply => ({ status, body });
export const noContent = (): Reply => ({ status: 204 });

/** Reads a JSON object body; anything else is treated as an empty object so field rules report it. */
export function objectBody(req: Request): Record<string, unknown> {
  const b = req.body;
  return b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}
