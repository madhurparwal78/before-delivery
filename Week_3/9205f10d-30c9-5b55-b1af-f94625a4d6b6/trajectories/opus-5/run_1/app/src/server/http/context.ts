import type { IncomingHttpHeaders } from 'node:http';
import type { Organisation, Role } from '../../shared/types.js';
import { ApiError, forbidden } from './errors.js';
import { parseJsonObject, type JsonObject } from './body.js';

export interface Actor {
  id: string;
  role: Role;
  display_name: string;
  full_name: string;
  email: string;
  organisation: Organisation | null;
}

export type RouteResult =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'empty'; status: number }
  | { kind: 'text'; status: number; contentType: string; body: string; headers?: Record<string, string> };

export function json(body: unknown, status = 200): RouteResult {
  return { kind: 'json', status, body };
}

export class RouteContext {
  readonly method: string;
  readonly url: URL;
  readonly params: Record<string, string>;
  readonly headers: IncomingHttpHeaders;
  readonly raw: Buffer;
  readonly actor: Actor | null;
  readonly cookies: string[] = [];

  constructor(init: {
    method: string;
    url: URL;
    params: Record<string, string>;
    headers: IncomingHttpHeaders;
    raw: Buffer;
    actor: Actor | null;
  }) {
    this.method = init.method;
    this.url = init.url;
    this.params = init.params;
    this.headers = init.headers;
    this.raw = init.raw;
    this.actor = init.actor;
  }

  param(name: string): string {
    return this.params[name] ?? '';
  }

  queryParam(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  header(name: string): string | null {
    const value = this.headers[name];
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0] ?? null;
    return null;
  }

  /** The raw header: a multipart boundary is case-sensitive. */
  contentType(): string {
    return this.header('content-type') ?? '';
  }

  mediaType(): string {
    return this.contentType().toLowerCase();
  }

  /** True when a JSON endpoint was called with another content type (precedence step 8). */
  hasWrongContentType(): boolean {
    const type = this.mediaType();
    if (type === '') return this.raw.length > 0;
    return !type.startsWith('application/json');
  }

  /** The parsed JSON body, or an empty object when the body is absent or not JSON. */
  body(): JsonObject {
    if (this.hasWrongContentType()) return {};
    return parseJsonObject(this.raw) ?? {};
  }

  requireActor(): Actor {
    if (this.actor === null) throw new ApiError('unauthenticated');
    return this.actor;
  }

  /** Precedence step 5: cross-origin state changes and roles without a grant. */
  requireSameOrigin(): void {
    if (this.method === 'GET' || this.method === 'HEAD') return;
    const origin = this.header('origin');
    if (origin === null) return;
    const host = this.header('host');
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw forbidden();
    }
    if (host === null || parsed.host !== host) throw forbidden();
  }

  gate(...roles: Role[]): Actor {
    const actor = this.requireActor();
    this.requireSameOrigin();
    if (!roles.includes(actor.role)) throw forbidden();
    return actor;
  }

  setCookie(value: string): void {
    this.cookies.push(value);
  }
}

export function bodyString(body: JsonObject, field: string): string | undefined {
  const value = body[field];
  return typeof value === 'string' ? value : undefined;
}

export function bodyNumber(body: JsonObject, field: string): number | undefined {
  const value = body[field];
  return typeof value === 'number' ? value : undefined;
}

export function bodyHas(body: JsonObject, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field);
}

