import type { NextFunction, Request, Response } from 'express';
import { ApiError, forbidden, unauthenticated } from './errors';
import { now } from './clock';
import { pool } from './db';
import { randomToken } from './ids';
import type { Role, User } from '../shared/types';

export const JSON_BODY_LIMIT = 100000;
export const MULTIPART_BODY_LIMIT = 31000000;
export const SESSION_COOKIE = 'bellroll_session';

export interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  data: Buffer;
}

export interface RequestContext {
  req: Request;
  res: Response;
  user: User | null;
  body: unknown;
  parts: MultipartPart[];
}

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
    parsedBody?: unknown;
    multipart?: MultipartPart[];
    bellrollUser?: User | null;
  }
}

function readBody(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError(413, 'payload_too_large', 'That request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new ApiError(400, 'bad_request', 'The request could not be read.')));
  });
}

export function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    if (body.subarray(start, start + 2).toString('latin1') === '--') break;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n', 'latin1'), start);
    if (headerEnd === -1) break;
    const headerText = body.subarray(start, headerEnd).toString('utf8');
    const next = body.indexOf(delimiter, headerEnd);
    const dataEnd = next === -1 ? body.length : next - 2;
    const data = body.subarray(headerEnd + 4, dataEnd);
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1] ?? '';
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    const contentType = /content-type:\s*([^\r\n;]*)/i.exec(headerText)?.[1]?.trim() ?? null;
    parts.push({ name, filename, contentType, data: Buffer.from(data) });
    index = next;
  }
  return parts;
}

/** Whole-request boundary rejections, which answer before anything else. */
export async function boundary(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const origin = req.headers.origin;
    if (stateChanging && origin !== undefined) {
      const host = req.headers.host ?? '';
      let originHost: string | null = null;
      try {
        originHost = origin === 'null' ? null : new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost === null || originHost !== host) {
        throw new ApiError(403, 'cross_origin', 'Cross-origin requests are not accepted.');
      }
    }
    const contentType = (req.headers['content-type'] ?? '').toString();
    const multipart = contentType.startsWith('multipart/form-data');
    if (stateChanging) {
      const limit = multipart ? MULTIPART_BODY_LIMIT : JSON_BODY_LIMIT;
      const declared = Number(req.headers['content-length'] ?? '0');
      if (Number.isFinite(declared) && declared > limit) {
        throw new ApiError(413, 'payload_too_large', 'That request body is too large.');
      }
      const raw = await readBody(req, limit);
      req.rawBody = raw;
      if (multipart) {
        const boundaryValue = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
        if (boundaryValue === undefined) {
          throw new ApiError(415, 'unsupported_media_type', 'Send this request as multipart/form-data.');
        }
        req.multipart = parseMultipart(raw, boundaryValue);
        req.parsedBody = {};
      } else {
        if (raw.length > 0 && !contentType.startsWith('application/json')) {
          throw new ApiError(415, 'unsupported_media_type', 'Send this request as JSON.');
        }
        if (raw.length === 0) {
          req.parsedBody = {};
        } else {
          try {
            req.parsedBody = JSON.parse(raw.toString('utf8'));
          } catch {
            throw new ApiError(400, 'bad_request', 'That request body is not valid JSON.');
          }
        }
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

function cookiesOf(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (header === undefined) return {};
  const entries: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    entries[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return entries;
}

export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = cookiesOf(req)[SESSION_COOKIE];
  if (token === undefined) {
    req.bellrollUser = null;
    next();
    return;
  }
  try {
    const { rows } = await pool.query<User>(
      `select u.id, u.name, u.email, u.role, u.family_id, u.school_id
         from sessions s join users u on u.id = s.user_id where s.token = $1`,
      [token],
    );
    req.bellrollUser = rows[0] ?? null;
    next();
  } catch (error) {
    next(error);
  }
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  await pool.query('insert into sessions (token, user_id, created_at) values ($1,$2,$3)', [token, userId, now()]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await pool.query('delete from sessions where token = $1', [token]);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function sessionTokenOf(req: Request): string | undefined {
  return cookiesOf(req)[SESSION_COOKIE];
}

export type Access = 'anyone' | 'signed-in' | Role[];

export interface Handled {
  status?: number;
  body?: unknown;
}

type RouteHandler = (ctx: RequestContext) => Promise<Handled | void>;

/** Applies the published precedence: boundary first, then 401, then 403, then the handler's own checks. */
export function route(access: Access, handler: RouteHandler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.bellrollUser ?? null;
      if (access !== 'anyone') {
        if (user === null) throw unauthenticated();
        if (access !== 'signed-in' && !access.includes(user.role)) throw forbidden();
      }
      const outcome = await handler({
        req,
        res,
        user,
        body: req.parsedBody ?? {},
        parts: req.multipart ?? [],
      });
      if (res.headersSent) return;
      if (outcome === undefined) {
        res.status(204).end();
        return;
      }
      res.status(outcome.status ?? 200);
      if (outcome.body === undefined) {
        res.end();
        return;
      }
      res.type('application/json; charset=utf-8').send(JSON.stringify(outcome.body));
    } catch (error) {
      next(error);
    }
  };
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (error instanceof ApiError) {
    res.status(error.status).type('application/json; charset=utf-8').send(JSON.stringify(error.body()));
    return;
  }
  process.stderr.write(`unhandled error: ${String(error)}\n`);
  res
    .status(500)
    .type('application/json; charset=utf-8')
    .send(JSON.stringify({ error: { code: 'internal_error', message: 'Something went wrong on the server.' } }));
}

export function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}
