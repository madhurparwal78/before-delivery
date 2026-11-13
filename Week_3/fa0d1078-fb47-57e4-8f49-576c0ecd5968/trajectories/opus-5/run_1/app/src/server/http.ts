import type { IncomingMessage, ServerResponse } from 'node:http';
import { BODY_LIMIT_BYTES } from './config';
import { ApiError } from './errors';

export const SESSION_COOKIE = 'seam_session';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  query: URLSearchParams;
  params: Record<string, string>;
  origin: string;
  cookies: Record<string, string>;
  body: unknown;
}

export type Handler = (context: RequestContext) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter(Boolean), handler });
  }

  get(pattern: string, handler: Handler): void {
    this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): void {
    this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: Handler): void {
    this.add('PUT', pattern, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index] as string;
        const part = parts[index] as string;
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(part);
        else if (segment !== part) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }
}

export function appOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? 'localhost';
  const forwarded = req.headers['x-forwarded-proto'];
  const scheme = typeof forwarded === 'string' && forwarded.length > 0 ? forwarded.split(',')[0] : 'http';
  return `${scheme}://${host}`;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    cookies[name] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return cookies;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** A state-changing request from another origin is refused. */
export function assertSameOrigin(req: IncomingMessage, origin: string): void {
  if (!STATE_CHANGING.has(req.method ?? 'GET')) return;
  const sent = req.headers.origin;
  if (sent === undefined) return;
  if (sent !== origin) throw new ApiError('CROSS_ORIGIN');
}

export function assertSocketOrigin(req: IncomingMessage, origin: string): void {
  const sent = req.headers.origin;
  if (sent === undefined) return;
  if (sent !== origin) throw new ApiError('CROSS_ORIGIN');
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > BODY_LIMIT_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > BODY_LIMIT_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE');
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  const type = req.headers['content-type'] ?? '';
  if (!type.toLowerCase().includes('application/json')) {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE');
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export function sendEmpty(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end();
}

export function sendApiError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body, error.headers ?? {});
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 365}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
