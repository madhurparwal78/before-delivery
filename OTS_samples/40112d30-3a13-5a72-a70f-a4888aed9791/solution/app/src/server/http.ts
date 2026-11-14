import type { IncomingMessage, ServerResponse } from 'node:http';
import { Failure, bodyTooLarge, internalError, notFound, validationFailed } from './errors.ts';
import { M68 } from '../shared/messages.ts';

// Request pipeline of the one error precedence (brief: API): 413, 401, 404, 429, 409, 422, 503.
// The pipeline owns 413 and the foreign-origin 404; the handlers own the rest, in that order.

export const JSON_LIMIT = 1_000_000;
const DRAIN_FACTOR = 4;
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  ip: string;
  json: unknown;
  raw: Buffer;
  /** Set when the body is not JSON the app can store; the handler raises it at its validation step (after 401, 404, 429, 409). */
  bodyFailure: Failure | null;
  cookies: Record<string, string>;
  setCookies: string[];
}

type Handler = (ctx: Ctx) => Promise<void>;
interface Route { method: string; pattern: RegExp; names: string[]; body: 'json' | 'raw' | 'none'; limit: number; truncate: boolean; handler: Handler }

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, options: { body?: 'json' | 'raw' | 'none'; limit?: number; truncate?: boolean } = {}): void {
  const names: string[] = [];
  const source = path.replace(/:([a-z]+)/g, (_all, name: string) => { names.push(name); return '([^/]+)'; });
  routes.push({ method, pattern: new RegExp(`^${source}$`), names, body: options.body ?? (method === 'GET' || method === 'DELETE' ? 'none' : 'json'), limit: options.limit ?? JSON_LIMIT, truncate: options.truncate ?? false, handler });
}

/** A path segment as text; malformed escapes name nothing. */
export function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const found: Record<string, string> = {};
  for (const pair of (header ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) found[pair.slice(0, at).trim()] = decodeURIComponent(pair.slice(at + 1).trim());
  }
  return found;
}

const clientIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? 'unknown';

export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Reads the body; past the limit it refuses with 413, or with `truncate` keeps the first `limit` bytes and drains the rest. */
function readBody(req: IncomingMessage, limit: number, truncate = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else if (size > limit * DRAIN_FACTOR) {
        req.pause();
        if (truncate) resolve(Buffer.concat(chunks));
        else reject(bodyTooLarge());
      }
    });
    req.on('end', () => (size > limit && !truncate ? reject(bodyTooLarge()) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export function sendJson(ctx: Ctx, status: number, data: unknown): void {
  send(ctx, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(data));
}

export function send(ctx: Ctx, status: number, headers: Record<string, string>, body: string | Buffer = ''): void {
  const all: Record<string, string | string[]> = { ...headers, 'Cache-Control': headers['Cache-Control'] ?? 'no-store' };
  if (ctx.setCookies.length) all['Set-Cookie'] = ctx.setCookies;
  ctx.res.writeHead(status, all);
  ctx.res.end(body);
}

function fail(ctx: Ctx, failure: Failure): void {
  const closing: Record<string, string> = failure.code === 'BODY_TOO_LARGE' ? { Connection: 'close' } : {};
  send(ctx, failure.status, { 'Content-Type': 'application/json; charset=utf-8', ...closing }, JSON.stringify(failure.toBody()));
}

/** Postgres cannot store NUL characters or unpaired surrogates in text or jsonb, so such input is refused up front. */
export function storable(value: unknown): boolean {
  if (typeof value === 'string') return value.isWellFormed() && !value.includes('\u0000');
  if (Array.isArray(value)) return value.every(storable);
  if (value !== null && typeof value === 'object') return Object.entries(value).every(([key, inner]) => storable(key) && storable(inner));
  return true;
}

export function bodyObject(ctx: Ctx): Record<string, unknown> {
  if (ctx.bodyFailure) throw ctx.bodyFailure;
  const value = ctx.json;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw validationFailed([{ key: 'body', message: M68 }]);
  return value as Record<string, unknown>;
}

/** Dispatch an /api request; unknown API paths answer the not-found shape. */
export async function dispatchApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const ctx: Ctx = { req, res, url, params: {}, ip: clientIp(req), json: {}, raw: Buffer.alloc(0), bodyFailure: null, cookies: parseCookies(req.headers.cookie), setCookies: [] };
  try {
    const method = req.method ?? 'GET';
    const match = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
    if (STATE_CHANGING.has(method) && !sameOrigin(req.headers.origin, req.headers.host)) throw notFound();
    if (!match) {
      if (STATE_CHANGING.has(method)) await readBody(req, JSON_LIMIT);
      throw notFound();
    }
    const groups = match.pattern.exec(url.pathname) ?? [];
    for (const [index, name] of match.names.entries()) {
      const value = decodeSegment(groups[index + 1] ?? '');
      if (value === null || !storable(value)) throw notFound();
      ctx.params[name] = value;
    }
    if (match.body !== 'none') {
      ctx.raw = await readBody(req, match.limit, match.truncate);
      if (match.body === 'json') {
        try {
          ctx.json = ctx.raw.length ? JSON.parse(ctx.raw.toString('utf8')) : {};
        } catch {
          ctx.bodyFailure = validationFailed([{ key: 'body', message: M68 }]);
        }
        if (!ctx.bodyFailure && !storable(ctx.json)) ctx.bodyFailure = validationFailed([{ key: 'body', message: M68 }]);
      }
    }
    await match.handler(ctx);
  } catch (error) {
    if (error instanceof Failure) return fail(ctx, error);
    console.error(error);
    fail(ctx, internalError());
  }
}
