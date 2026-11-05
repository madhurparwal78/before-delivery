import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Role } from '../../shared/types';
import { ApiError, PaymentDeclined, ProviderDown } from './errors';
import * as errors from './errors';
import type { UserRow } from '../repo/users';
import { userForSession } from '../repo/users';
import { claimKey, finishKey, forgetKey, type StoredReply } from './idempotency';

export const SESSION_COOKIE = 'shelfmark_session';
export const JSON_BODY_LIMIT = 65_536;
export const PHOTO_BODY_LIMIT = 8_000_000;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: { bytes: Buffer<ArrayBufferLike>; contentType: string };
}

export interface Ctx {
  req: Request;
  res: Response;
  user: UserRow | null;
  params: Record<string, string>;
  body: Record<string, unknown>;
  rawBody: Buffer<ArrayBufferLike>;
  now: Date;
}

export interface Route {
  method: Method;
  path: string;
  /** Who may call it; `anyone` skips the sign-in check. */
  roles: Role[] | 'anyone' | 'signed-in';
  body?: 'json' | 'multipart';
  idempotent?: boolean;
  handler: (ctx: Ctx) => Promise<Reply>;
}

export function signedInUser(ctx: Ctx): UserRow {
  if (!ctx.user) throw errors.unauthenticated();
  return ctx.user;
}

export function isStaff(user: UserRow): boolean {
  return user.role === 'owner' || user.role === 'tech';
}

interface Match {
  route: Route;
  params: Record<string, string>;
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    const actual = pathParts[index] ?? '';
    if (part.startsWith(':')) {
      if (actual === '') return null;
      params[part.slice(1)] = decodeURIComponent(actual);
    } else if (part !== actual) {
      return null;
    }
  }
  return params;
}

function readBody(req: Request, limit: number): Promise<Buffer<ArrayBufferLike> | 'too_large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let stopped = false;
    req.on('data', (chunk: Buffer) => {
      if (stopped) return;
      size += chunk.byteLength;
      if (size > limit) {
        // Keep draining so the refusal can still be answered on this connection.
        stopped = true;
        chunks.length = 0;
        resolve('too_large');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!stopped) resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (!stopped) reject(error);
    });
  });
}

function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) jar[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return jar;
}

/** Same-origin only: a state-changing call from elsewhere is refused outright. */
function checkOrigin(req: Request): void {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.get('origin');
  if (!origin) return;
  const host = req.get('host');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw errors.crossOrigin();
  }
  if (!host || originHost !== host) throw errors.crossOrigin();
}

function isJsonType(contentType: string | undefined): boolean {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json';
}

export class ApiRouter {
  private readonly routes: Route[];

  constructor(routes: Route[]) {
    this.routes = routes;
  }

  private match(method: string, path: string): Match | 'method_not_allowed' | null {
    let pathExists = false;
    for (const route of this.routes) {
      const params = matchPath(route.path, path);
      if (!params) continue;
      pathExists = true;
      if (route.method === method) return { route, params };
    }
    return pathExists ? 'method_not_allowed' : null;
  }

  async handle(req: Request, res: Response): Promise<void> {
    try {
      const reply = await this.route(req, res);
      this.send(res, reply);
    } catch (error) {
      const api = toApiError(error);
      this.send(res, { status: api.status, body: api.body });
    }
  }

  private send(res: Response, reply: Reply): void {
    for (const [name, value] of Object.entries(reply.headers ?? {})) {
      res.setHeader(name, value);
    }
    if (reply.raw) {
      res.status(reply.status);
      res.setHeader('Content-Type', reply.raw.contentType);
      res.setHeader('Content-Length', String(reply.raw.bytes.byteLength));
      res.end(reply.raw.bytes);
      return;
    }
    if (reply.body === undefined) {
      res.status(reply.status).end();
      return;
    }
    res.status(reply.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(reply.body));
  }

  private async route(req: Request, res: Response): Promise<Reply> {
    checkOrigin(req);
    const matched = this.match(req.method, req.path);
    if (matched === 'method_not_allowed') throw errors.methodNotAllowed();
    if (matched === null) throw errors.notFound();
    const { route, params } = matched;

    let rawBody: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let body: Record<string, unknown> = {};
    if (route.body === 'multipart') {
      const read = await readBody(req, PHOTO_BODY_LIMIT);
      if (read === 'too_large') throw errors.tooLarge();
      rawBody = read;
    } else {
      const read = await readBody(req, JSON_BODY_LIMIT);
      if (read === 'too_large') throw errors.tooLarge();
      rawBody = read;
      if (rawBody.byteLength > 0) {
        if (!isJsonType(req.get('content-type'))) throw errors.unsupportedType();
        try {
          const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new ApiError(422, 'invalid_body', 'Send a JSON object.');
          }
          body = parsed as Record<string, unknown>;
        } catch (error) {
          if (error instanceof ApiError) throw error;
          throw new ApiError(422, 'invalid_body', 'Send a JSON object.');
        }
      }
    }

    const cookies = parseCookies(req.get('cookie'));
    const sessionId = cookies[SESSION_COOKIE];
    const user = sessionId ? await userForSession(sessionId) : null;
    if (route.roles !== 'anyone' && !user) throw errors.unauthenticated();

    const ctx: Ctx = { req, res, user, params, body, rawBody, now: new Date() };

    const idempotencyKey = route.idempotent && user ? this.keyOf(req) : null;
    if (idempotencyKey && user) {
      const bodyHash = createHash('sha256').update(rawBody).digest('hex');
      const claim = await claimKey(user.id, idempotencyKey, bodyHash);
      if (claim !== 'claimed') return this.replay(claim);
      try {
        const reply = await this.runGuarded(route, ctx);
        if (reply.status < 500) {
          await finishKey(user.id, idempotencyKey, reply.status, reply.body ?? null);
        } else {
          await forgetKey(user.id, idempotencyKey);
        }
        return reply;
      } catch (error) {
        const api = toApiError(error);
        if (api.status < 500) {
          await finishKey(user.id, idempotencyKey, api.status, api.body);
        } else {
          await forgetKey(user.id, idempotencyKey);
        }
        throw api;
      }
    }
    return this.runGuarded(route, ctx);
  }

  private replay(stored: StoredReply | 'conflict' | 'in_progress'): Reply {
    if (stored === 'conflict') {
      throw errors.conflict(
        'idempotency_conflict',
        'That Idempotency-Key was used for a different request.',
      );
    }
    if (stored === 'in_progress') {
      throw errors.conflict('idempotency_in_progress', 'That request is still running.');
    }
    return {
      status: stored.status,
      body: stored.body ?? undefined,
      headers: { 'Idempotent-Replayed': 'true' },
    };
  }

  private keyOf(req: Request): string | null {
    const raw = req.get('idempotency-key');
    if (raw === undefined) return null;
    if (!/^[\x20-\x7e]{1,100}$/.test(raw)) {
      throw errors.unprocessable({ idempotency_key: 'Use 1 to 100 printable characters' });
    }
    return raw;
  }

  private async runGuarded(route: Route, ctx: Ctx): Promise<Reply> {
    if (Array.isArray(route.roles)) {
      const user = signedInUser(ctx);
      if (!route.roles.includes(user.role)) throw errors.forbidden();
    }
    return route.handler(ctx);
  }
}

/** Provider failures become the one error body their dependency owns. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ProviderDown) {
    if (error.provider === 'storage') return errors.storageUnavailable();
    if (error.provider === 'billing') return errors.billingUnavailable();
    return new ApiError(503, 'mail_unavailable', 'Email is unreachable.');
  }
  if (error instanceof PaymentDeclined) return errors.paymentFailed();
  return new ApiError(500, 'server_error', 'Something went wrong.');
}
