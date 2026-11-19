import type { IncomingMessage } from 'node:http';
import type { Role, User } from '../../shared/types';
import { env } from '../env';
import { pool } from '../repo/db';
import { readSession, type SessionRecord } from '../repo/users';
import * as fail from './errors';
import { parseMultipart, type MultipartBody } from './multipart';

export const JSON_BODY_LIMIT = 100_000;
export const MULTIPART_BODY_LIMIT = 5_100_000;
export const SESSION_COOKIE = 'pegworth_session';

export type BodyKind = 'json' | 'multipart';

export interface CookieChange {
  readonly name: string;
  readonly value: string;
  readonly maxAge: number;
}

export type Reply =
  | { kind: 'json'; status: number; body: unknown; cookie?: CookieChange }
  | { kind: 'empty'; status: number; cookie?: CookieChange }
  | { kind: 'bytes'; status: number; body: Buffer; headers: Record<string, string> };

export function jsonReply(status: number, body: unknown, cookie?: CookieChange): Reply {
  return cookie ? { kind: 'json', status, body, cookie } : { kind: 'json', status, body };
}

export class RequestContext {
  private parsedJson: Record<string, unknown> | null | undefined;

  constructor(
    readonly method: string,
    readonly path: string,
    readonly query: URLSearchParams,
    readonly params: Readonly<Record<string, string>>,
    readonly rawBody: Buffer,
    readonly oversize: boolean,
    readonly contentType: string,
    readonly hasBody: boolean,
    readonly session: SessionRecord | null,
    readonly now: Date,
  ) {}

  get user(): User | null {
    return this.session && !this.session.ended ? this.session.user : null;
  }

  get role(): Role | null {
    return this.user?.role ?? null;
  }

  requireUser(): User {
    const user = this.user;
    if (!user) throw this.session?.ended ? fail.sessionEnded() : fail.signInRequired();
    return user;
  }

  /**
   * The body read as a JSON object for the unknown-record and role steps, which
   * look inside it whatever its content type, and only when it is within size.
   */
  peekJson(): Record<string, unknown> | null {
    if (this.parsedJson === undefined) {
      this.parsedJson = null;
      if (!this.oversize && this.rawBody.length > 0) {
        try {
          const value: unknown = JSON.parse(this.rawBody.toString('utf8'));
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            this.parsedJson = value as Record<string, unknown>;
          }
        } catch {
          this.parsedJson = null;
        }
      }
    }
    return this.parsedJson;
  }

  /** A whole-number id named in the body, for the 404 step. */
  peekId(field: string): number | null {
    const value = this.peekJson()?.[field];
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
  }

  json(): Record<string, unknown> {
    const parsed = this.peekJson();
    if (parsed === null) throw fail.invalid({ body: 'Send a JSON object.' });
    return parsed;
  }

  jsonValue(): unknown {
    if (this.rawBody.length === 0) return undefined;
    try {
      return JSON.parse(this.rawBody.toString('utf8')) as unknown;
    } catch {
      throw fail.invalid({ body: 'Send a JSON object.' });
    }
  }

  multipart(): MultipartBody {
    const parsed = parseMultipart(this.rawBody, this.contentType);
    if (!parsed) throw fail.invalid({ photo: 'Send the photo as multipart form data.' });
    return parsed;
  }

  pathId(name: string): number {
    const raw = this.params[name] ?? '';
    if (!/^\d+$/.test(raw)) throw fail.notFound();
    return Number(raw);
  }
}

export interface Route<Resolved = undefined> {
  readonly method: string;
  readonly pattern: string;
  readonly body: BodyKind;
  readonly auth: 'anyone' | 'signed-in';
  /** Step 3: unknown records, from the path and from the body. */
  readonly resolve?: (ctx: RequestContext) => Promise<Resolved>;
  /** Step 4: the caller's role, and fields their role may not send. */
  readonly role?: (ctx: RequestContext, resolved: Resolved) => void;
  /** Steps 7 to 9, plus the success answer. */
  readonly run: (ctx: RequestContext, resolved: Resolved) => Promise<Reply>;
}

interface CompiledRoute {
  readonly method: string;
  readonly segments: readonly string[];
  readonly route: Route<unknown>;
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add<Resolved>(route: Route<Resolved>): void {
    this.routes.push({
      method: route.method,
      segments: route.pattern.split('/').filter((segment) => segment.length > 0),
      route: route as Route<unknown>,
    });
  }

  match(
    method: string,
    path: string,
  ): { route: Route<unknown>; params: Record<string, string> } | null {
    const parts = path.split('/').filter((segment) => segment.length > 0);
    for (const candidate of this.routes) {
      if (candidate.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < candidate.segments.length; index += 1) {
        const segment = candidate.segments[index] as string;
        const value = parts[index] as string;
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched && candidate.method === method) return { route: candidate.route, params };
    }
    return null;
  }
}

function ownOrigin(request: IncomingMessage): string {
  const host = request.headers.host ?? '';
  const encrypted = 'encrypted' in request.socket && request.socket.encrypted === true;
  return `${encrypted ? 'https' : 'http'}://${host}`;
}

export function isCrossSiteWrite(request: IncomingMessage): boolean {
  const method = (request.method ?? 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return false;
  return origin !== ownOrigin(request);
}

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return null;
}

export async function resolveSession(request: IncomingMessage, now: Date): Promise<SessionRecord | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return readSession(pool, token, now, env.sessionIdleSeconds);
}

/**
 * Keeps nothing past the limit, so the size step can refuse the request, but
 * still drains the body so the refusal reaches the client.
 */
export function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<{ body: Buffer; oversize: boolean }> {
  const drainLimit = limit + 8_000_000;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let oversize = false;
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      resolve({ body: Buffer.concat(chunks), oversize });
    };
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        oversize = true;
        if (total > drainLimit) {
          settle();
          request.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', settle);
    request.on('aborted', settle);
    request.on('error', (error) => (settled ? undefined : reject(error)));
  });
}

function checkContentType(ctx: RequestContext, kind: BodyKind): void {
  if (!ctx.hasBody) return;
  const base = ctx.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (kind === 'multipart' && base !== 'multipart/form-data') throw fail.sendJson();
  if (kind === 'json' && base !== 'application/json') throw fail.sendJson();
}

const PHOTO_BYTE_LIMIT = 5_000_000;

function checkSize(ctx: RequestContext, kind: BodyKind): void {
  if (ctx.oversize) {
    throw kind === 'multipart' ? fail.photoTooLarge() : fail.requestTooLarge();
  }
  if (kind !== 'multipart' || !ctx.hasBody) return;
  const form = parseMultipart(ctx.rawBody, ctx.contentType);
  for (const file of form?.files.values() ?? []) {
    if (file.data.length > PHOTO_BYTE_LIMIT) throw fail.photoTooLarge();
  }
}

/** The one published refusal order, applied to every endpoint. */
export async function runRoute(route: Route<unknown>, ctx: RequestContext): Promise<Reply> {
  if (route.auth === 'signed-in') ctx.requireUser();
  const resolved = route.resolve ? await route.resolve(ctx) : undefined;
  if (route.role) route.role(ctx, resolved);
  checkContentType(ctx, route.body);
  checkSize(ctx, route.body);
  return route.run(ctx, resolved);
}


