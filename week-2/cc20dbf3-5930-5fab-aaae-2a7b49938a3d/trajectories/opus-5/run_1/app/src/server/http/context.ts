import type { IncomingMessage } from 'node:http';
import type { Role } from '../../shared/api.js';
import type { MultipartFile } from './multipart.js';

export interface Caller {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly email: string;
  readonly sessionId: string;
}

export interface BaseContext {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly now: Date;
}

export interface PublicContext extends BaseContext {
  readonly json: Record<string, unknown>;
}

export interface SessionResolveContext extends BaseContext {
  readonly caller: Caller;
}

export interface SessionContext extends SessionResolveContext {
  readonly json: Record<string, unknown>;
  readonly files: readonly MultipartFile[];
  readonly rawBody: Buffer;
  readonly idempotencyKey: string | null;
}

export type HandlerResult =
  | { readonly kind: 'json'; readonly status: number; readonly value: unknown; readonly cookie?: string }
  | { readonly kind: 'empty'; readonly status: number; readonly cookie?: string }
  | {
      readonly kind: 'bytes';
      readonly status: number;
      readonly bytes: Buffer;
      readonly headers: Readonly<Record<string, string>>;
    };

export function isStateChange(method: string): boolean {
  return method === 'POST' || method === 'DELETE';
}

/** The app's own origin, judged from the request's own Host header. */
export function originMatches(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  const host = request.headers.host ?? '';
  return origin === `http://${host}` || origin === `https://${host}`;
}

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}
