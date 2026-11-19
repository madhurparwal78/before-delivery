import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_BODY_LIMIT_BYTES, MAX_NAME_CHARS, SESSION_COOKIE, config } from './config';
import { one } from './db';
import { ApiError, badRequest, messages, notFound } from './errors';
import { isObject, tooDeep, visibleLength } from './util';
import type { JsonObject, JsonValue, Role } from '../shared/types';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  confirmed: boolean;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  clock_offset_seconds: string;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: JsonObject;
  raw: Buffer;
  user: UserRow;
  workspace: WorkspaceRow;
  role: Role;
  setCookie: (value: string | null) => void;
}

export interface Reply {
  status?: number;
  json?: unknown;
  body?: string | Buffer;
  contentType?: string;
  headers?: Record<string, string>;
  handled?: boolean;
}

export interface Route {
  method: string;
  path: string;
  auth?: 'session' | 'grading';
  workspace?: string;
  minimumRole?: 'owner' | 'editor';
  body?: 'json' | 'raw';
  bodyLimit?: number;
  skipOriginCheck?: boolean;
  handler: (ctx: Ctx) => Promise<Reply>;
}

interface Compiled extends Route {
  pattern: RegExp;
  keys: string[];
}

export function compile(routes: Route[]): Compiled[] {
  return routes.map((route) => {
    const keys: string[] = [];
    const pattern = route.path
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        if (segment === '*') {
          keys.push('rest');
          return '(.*)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    return { ...route, keys, pattern: new RegExp(`^${pattern}$`) };
  });
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? '';
  const jar: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export async function sessionUser(req: IncomingMessage): Promise<UserRow | null> {
  const sessionId = cookies(req)[SESSION_COOKIE];
  if (sessionId === undefined || sessionId === '') return null;
  return one<UserRow>(
    'select u.* from sessions s join users u on u.id = s.user_id where s.id = $1',
    [sessionId],
  );
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > limit) {
        refused = true;
        req.pause();
        reject(new ApiError(413, limit === JSON_BODY_LIMIT_BYTES ? messages.bodyTooLarge : messages.importTooLarge));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (error) => reject(error));
  });
}

export function isJsonContentType(req: IncomingMessage): boolean {
  const header = (req.headers['content-type'] ?? '').toLowerCase();
  return header.split(';')[0].trim() === 'application/json';
}

export function parseJsonBody(raw: Buffer): JsonObject {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw badRequest(messages.badJson);
  }
  if (!isObject(parsed)) throw badRequest(messages.notAnObject);
  if (tooDeep(parsed)) throw badRequest(messages.tooDeep);
  return parsed;
}

export function checkName(value: JsonValue | undefined): void {
  if (typeof value === 'string' && visibleLength(value) > MAX_NAME_CHARS) throw badRequest(messages.nameTooLong);
}

export function checkRole(role: Role, minimum: 'owner' | 'editor'): void {
  if (role === 'viewer') throw new ApiError(403, messages.viewerRefused);
  if (minimum === 'owner' && role !== 'owner') throw new ApiError(403, messages.ownerOnly);
}

export function checkOrigin(req: IncomingMessage): void {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === '') return;
  const host = req.headers.host ?? '';
  if (origin !== `http://${host}` && origin !== `https://${host}`) {
    throw new ApiError(403, messages.crossOrigin);
  }
}

export function checkGradingKey(req: IncomingMessage): void {
  if (req.headers['x-grading-key'] !== config.gradingKey) throw notFound();
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = Buffer.from(`${JSON.stringify(body)}`, 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    ...headers,
  });
  res.end(payload);
}

export function matchRoute(
  routes: Compiled[],
  method: string,
  pathname: string,
): { route: Compiled; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method && route.method !== '*') continue;
    const match = route.pattern.exec(pathname);
    if (match === null) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    return { route, params };
  }
  return null;
}
