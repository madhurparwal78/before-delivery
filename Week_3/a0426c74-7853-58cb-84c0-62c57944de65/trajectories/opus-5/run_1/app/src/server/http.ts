import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, MESSAGES } from '../shared/errors.js';
import { JSON_BODY_LIMIT } from './config.js';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  username: string | null;
}

export type Handler = (context: RequestContext) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path
      .split('/')
      .map((part) => {
        if (part.startsWith(':')) {
          keys.push(part.slice(1));
          return '([^/]+)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/')}$`,
  );
  routes.push({ method, pattern, keys, handler });
}

export function matchRoute(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const found = candidate.pattern.exec(pathname);
    if (!found) continue;
    const params: Record<string, string> = {};
    candidate.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(found[index + 1]);
    });
    return { handler: candidate.handler, params };
  }
  return null;
}

export function hasPath(pathname: string): boolean {
  return routes.some((candidate) => candidate.pattern.test(pathname));
}

export function requestOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? '';
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  return `${proto}://${host}`;
}

/** A write or live-channel upgrade from another origin is refused. */
export function isCrossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return false;
  const host = req.headers.host ?? '';
  try {
    const sent = new URL(origin);
    const sentHost = sent.host;
    if (sentHost === host) return false;
    return true;
  } catch {
    return true;
  }
}

export const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  let over = false;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    total += piece.length;
    if (total > limit) {
      over = true;
      continue;
    }
    chunks.push(piece);
  }
  if (over) throw new ApiError('too_large', MESSAGES.bodyTooLarge);
  return Buffer.concat(chunks);
}

export async function readJson(context: RequestContext): Promise<Record<string, unknown>> {
  const raw = await readRawBody(context.req, JSON_BODY_LIMIT);
  if (raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError('invalid', MESSAGES.invalid);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('invalid', MESSAGES.invalid);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export function sendEmpty(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, headers);
  res.end();
}

export function sendBytes(res: ServerResponse, status: number, body: Buffer, contentType: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': body.length,
    ...headers,
  });
  res.end(body);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body());
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string): string {
  return `plot_session=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedSessionCookie(): string {
  return 'plot_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

export function stringField(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' ? value : null;
}

export function numberField(body: Record<string, unknown>, field: string): number | null {
  const value = body[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function booleanField(body: Record<string, unknown>, field: string): boolean | null {
  const value = body[field];
  return typeof value === 'boolean' ? value : null;
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = stringField(body, field);
  if (value === null) {
    throw new ApiError('invalid', MESSAGES.invalid, { fields: { [field]: 'This field is required.' } });
  }
  return value;
}

export function requireNumber(body: Record<string, unknown>, field: string): number {
  const value = numberField(body, field);
  if (value === null) {
    throw new ApiError('invalid', MESSAGES.invalid, { fields: { [field]: 'This field must be a number.' } });
  }
  return value;
}

export function objectField(body: Record<string, unknown>, field: string): Record<string, unknown> | null {
  const value = body[field];
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function arrayField(body: Record<string, unknown>, field: string): unknown[] | null {
  const value = body[field];
  return Array.isArray(value) ? value : null;
}
