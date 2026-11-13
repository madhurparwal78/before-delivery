import type { IncomingMessage, ServerResponse } from 'node:http';
import { serverNow } from '../db/clock';
import { db } from '../db/pool';
import { ApiError } from '../errors';
import type { MultipartBody } from './body';

export type Role = 'member' | 'moderator' | 'employer_admin' | 'recruiter' | 'founder';

export type ReadBody =
  | { kind: 'none' }
  | { kind: 'json'; fields: Record<string, unknown> }
  | { kind: 'multipart'; form: MultipartBody }
  | { kind: 'raw'; bytes: Buffer };

export interface SessionUser {
  id: string;
  display_name: string;
  email: string;
  role: Role;
  company_id: string | null;
  company_slug: string | null;
  unlocked: boolean;
}

export const SESSION_COOKIE = 'cb_session';
export const SESSION_DAYS = 30;

export function readCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export class Context {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly method: string;
  params: Record<string, string> = {};
  user: SessionUser | null = null;
  /** Read before every other check, so an oversized body answers 413 first. */
  body: ReadBody = { kind: 'none' };
  private nowValue: Date | null = null;

  constructor(req: IncomingMessage, res: ServerResponse) {
    this.req = req;
    this.res = res;
    this.method = req.method ?? 'GET';
    this.url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  }

  async now(): Promise<Date> {
    if (!this.nowValue) this.nowValue = await serverNow();
    return this.nowValue;
  }

  param(name: string): string {
    return this.params[name] ?? '';
  }

  json(): Record<string, unknown> {
    return this.body.kind === 'json' ? this.body.fields : {};
  }

  multipart(): MultipartBody {
    return this.body.kind === 'multipart' ? this.body.form : { fields: {}, files: {} };
  }

  raw(): Buffer {
    return this.body.kind === 'raw' ? this.body.bytes : Buffer.alloc(0);
  }

  header(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  /** 401 is the first check in the published precedence order. */
  requireUser(): SessionUser {
    if (!this.user) throw new ApiError('unauthenticated');
    return this.user;
  }

  requireRole(...roles: Role[]): SessionUser {
    const user = this.requireUser();
    if (!roles.includes(user.role)) throw new ApiError('forbidden');
    return user;
  }
}

export async function loadSessionUser(token: string | undefined, now: Date): Promise<SessionUser | null> {
  if (!token) return null;
  return db.one<SessionUser>(
    `SELECT u.id, u.display_name, u.email, u.role, u.company_id, c.slug AS company_slug, u.unlocked
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN companies c ON c.id = u.company_id
      WHERE s.token = $1 AND s.expires_at > $2`,
    [token, now],
  );
}
