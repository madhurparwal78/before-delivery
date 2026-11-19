import type { IncomingMessage, ServerResponse } from 'node:http';
import { formatDate, formatNumber, type Settings } from '../shared/format.js';
import type { NumberFormat, TimeZone } from '../shared/types.js';
import { ApiError, CROSS_ORIGIN, forbidden, tooLarge, unsupportedMediaType } from './errors.js';
import { config } from './config.js';

export const SESSION_COOKIE = 'celmate_session';
const JSON_LIMIT = 1000000;
const SEED_LIMIT = 20000000;

export interface Person {
  id: number;
  email: string;
  name: string;
  number_format: NumberFormat;
  time_zone: TimeZone;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  raw: Buffer;
  person: Person | null;
  settings: Settings;
  now: Date;
  num(value: number): string;
  date(at: Date | string): string;
  setCookie(value: string): void;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  bytes?: Buffer;
}

export type Handler = (ctx: Ctx) => Promise<Reply | void>;

export interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  raw?: boolean;
}

interface CompiledRoute extends Route {
  segments: string[];
}

export function compileRoutes(routes: Route[]): CompiledRoute[] {
  return routes.map((route) => ({ ...route, segments: route.pattern.split('/') }));
}

export function matchRoute(
  routes: CompiledRoute[],
  method: string,
  path: string,
): { route: CompiledRoute; params: Record<string, string> } | null {
  const parts = path.split('/');
  let pathMatched: CompiledRoute | null = null;
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < parts.length; i += 1) {
      const segment = route.segments[i];
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(parts[i]);
        continue;
      }
      if (segment !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    pathMatched = route;
    if (route.method === method) return { route, params };
  }
  return pathMatched === null ? null : { route: { ...pathMatched, handler: methodNotAllowed }, params: {} };
}

const methodNotAllowed: Handler = async () => ({ status: 405, body: { error: 'not_found' } });

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    out[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return out;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw tooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function checkOrigin(req: IncomingMessage, method: string): void {
  if (!WRITE_METHODS.has(method)) return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = req.headers.host ?? '';
  let allowed = false;
  try {
    const parsed = new URL(origin);
    allowed = parsed.host === host;
    if (!allowed && config.publicUrl !== '') {
      allowed = parsed.host === new URL(config.publicUrl).host;
    }
  } catch {
    allowed = false;
  }
  if (!allowed) throw forbidden(CROSS_ORIGIN);
}

export function bodyLimitFor(path: string): number {
  return path === '/api/grading/seed' ? SEED_LIMIT : JSON_LIMIT;
}

export function parseJsonBody(raw: Buffer, contentType: string, method: string): Record<string, unknown> {
  if (!WRITE_METHODS.has(method) || raw.length === 0) return {};
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw unsupportedMediaType();
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(422, { errors: { body: 'Send a JSON object' } });
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, { errors: { body: 'Send a JSON object' } });
  }
}

export function makeFormatters(settings: Settings): Pick<Ctx, 'num' | 'date'> {
  return {
    num: (value: number) => formatNumber(value, settings.number_format),
    date: (at: Date | string) => formatDate(at, settings),
  };
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(text);
}
