import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, ValidationError } from '../domain/errors.ts';
import type { SignedInUser } from './auth.ts';

export interface Reply {
  status?: number;
  json?: unknown;
  text?: string;
  bytes?: Buffer;
  headers?: Record<string, string>;
}

export interface Ctx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  user: SignedInUser | null;
  cookies: Record<string, string>;
  setCookie: (value: string) => void;
}

export type Handler = (ctx: Ctx) => Promise<Reply>;

const DEFAULT_BODY_LIMIT = 16_384;
const PACK_BODY_LIMIT = 2_000_000;

export function bodyLimitFor(path: string): number {
  return path === '/api/packs' ? PACK_BODY_LIMIT : DEFAULT_BODY_LIMIT;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

/** Reads the body, refusing an oversized or wrongly typed one before anything else. */
export async function readBody(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new ApiError('too_large');

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) throw new ApiError('too_large');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks);
  if (raw.byteLength === 0) return {};

  const contentType = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new ApiError('unsupported_type');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw ValidationError.field('body', 'Send this request as a JSON object.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw ValidationError.field('body', 'Send this request as a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export function sendReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { 'cache-control': 'no-store', ...reply.headers };
  if (reply.bytes !== undefined) {
    headers['content-length'] = String(reply.bytes.byteLength);
    response.writeHead(reply.status ?? 200, headers);
    response.end(reply.bytes);
    return;
  }
  if (reply.text !== undefined) {
    const bytes = Buffer.from(reply.text, 'utf8');
    headers['content-type'] = headers['content-type'] ?? 'text/plain; charset=utf-8';
    headers['content-length'] = String(bytes.byteLength);
    response.writeHead(reply.status ?? 200, headers);
    response.end(bytes);
    return;
  }
  if (reply.json === undefined) {
    response.writeHead(reply.status ?? 204, headers);
    response.end();
    return;
  }
  const bytes = Buffer.from(JSON.stringify(reply.json), 'utf8');
  headers['content-type'] = 'application/json; charset=utf-8';
  headers['content-length'] = String(bytes.byteLength);
  response.writeHead(reply.status ?? 200, headers);
  response.end(bytes);
}

/** Every API error leaves the server through this one shape. */
export function errorReply(cause: unknown): Reply {
  if (cause instanceof ApiError) return { status: cause.status, json: cause.body() };
  if (cause instanceof ValidationError) return { status: 422, json: cause.body() };
  process.stderr.write(`unhandled: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
  return { status: 500, json: { error: 'internal_error', message: 'Something went wrong.' } };
}

export interface Route {
  method: string;
  pattern: RegExp;
  keys: readonly string[];
  handler: Handler;
}

export function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:([a-zA-Z]+)/g, (_match, key: string) => {
      keys.push(key);
      return '([^/]+)';
    })}$`,
  );
  return { method, pattern, keys, handler };
}

export function matchApiRoute(routes: readonly Route[], method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const found = candidate.pattern.exec(path);
    if (found === null) continue;
    const params: Record<string, string> = {};
    candidate.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(found[index + 1] as string);
    });
    return { route: candidate, params };
  }
  return null;
}
