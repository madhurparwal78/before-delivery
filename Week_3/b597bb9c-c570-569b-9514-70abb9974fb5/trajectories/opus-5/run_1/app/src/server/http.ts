/**
 * The server boundary: routing, body limits, the one error shape and its precedence.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from '../domain/api-error.js';
import { config, JSON_BODY_LIMIT, SRT_BODY_LIMIT, UPLOAD_CHUNK_BYTES } from './config.js';
import type { Person, Role } from '../shared/types.js';

export type BodyKind = 'none' | 'json' | 'octet' | 'srt';

export interface Signed {
  person: Person;
  is_owner: boolean;
  session_id: string;
}

export interface ReadTokenHolder {
  id: string;
  name: string;
}

export interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  body: Buffer;
  signed: Signed | null;
  readToken: ReadTokenHolder | null;
}

export interface Route {
  method: string;
  path: string;
  body?: BodyKind;
  /** session, read token, review token in the path, or none */
  auth: 'session' | 'owner' | 'token' | 'public';
  handle: (context: RequestContext) => Promise<void>;
}

export const BODY_LIMITS: Record<BodyKind, number> = {
  none: JSON_BODY_LIMIT,
  json: JSON_BODY_LIMIT,
  srt: SRT_BODY_LIMIT,
  octet: UPLOAD_CHUNK_BYTES,
};

export const BODY_TYPES: Record<BodyKind, string> = {
  none: 'application/json; charset=utf-8',
  json: 'application/json; charset=utf-8',
  srt: 'application/x-subrip',
  octet: 'application/octet-stream',
};

export function matchPath(template: string, path: string): Record<string, string> | null {
  const templateParts = template.split('/');
  const pathParts = path.split('/');
  if (templateParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < templateParts.length; index += 1) {
    const part = templateParts[index];
    if (part.startsWith('{') && part.endsWith('}')) {
      const value = decodeURIComponent(pathParts[index]);
      if (value === '') return null;
      params[part.slice(1, -1)] = value;
    } else if (part !== pathParts[index]) {
      return null;
    }
  }
  return params;
}

export function sendJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(body);
}

export function sendEmpty(response: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'cache-control': 'no-store', ...headers });
  response.end();
}

export function sendError(response: ServerResponse, error: ApiError, headers: Record<string, string> = {}): void {
  sendJson(response, error.status, error.body(), headers);
}

export function readCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (header === undefined) return {};
  const jar: Record<string, string> = {};
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    jar[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return jar;
}

export const SESSION_COOKIE = 'gatecut_session';

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function ownOrigin(request: IncomingMessage): string[] {
  const host = request.headers.host ?? '';
  return [config.publicUrl, `http://${host}`, `https://${host}`];
}

export function originIsOwn(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  return ownOrigin(request).includes(origin);
}

export function jsonBody(context: RequestContext): Record<string, unknown> {
  if (context.body.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(context.body.toString('utf8'));
  } catch {
    throw ApiError.validation({ body: 'That value is not allowed here.' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw ApiError.validation({ body: 'That value is not allowed here.' });
  }
  return parsed as Record<string, unknown>;
}

export function requireSigned(context: RequestContext): Signed {
  if (context.signed === null) throw ApiError.of('unauthenticated', undefined);
  return context.signed;
}

export function requireOwner(context: RequestContext): Signed {
  const signed = requireSigned(context);
  if (!signed.is_owner) throw ApiError.of('forbidden', undefined);
  return signed;
}

export function requireRole(role: Role, allowed: readonly Role[]): void {
  if (!allowed.includes(role)) throw ApiError.of('forbidden', undefined);
}

export function notFound(): ApiError {
  return ApiError.of('not_found', undefined);
}

