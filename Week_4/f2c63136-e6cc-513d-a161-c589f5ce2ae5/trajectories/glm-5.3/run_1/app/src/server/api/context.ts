import type pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Clock } from '../clock.js';
import type { Database } from '../db.js';
import type { Storage } from '../storage.js';
import type { Mailer } from '../mail.js';
import type { LiveHub } from '../live.js';
import type { Role } from '../store/changes.js';
import { roleFor } from '../store/changes.js';
import { getRepoByPath, type RepoRow, type Tx } from '../store/revisions.js';

export interface SessionUser { id: number; username: string; name: string; email: string }

export interface TokenInfo { repo_id: number; access: 'read' | 'write'; name: string }

export interface AuthContext {
  user: SessionUser | null;
  token: TokenInfo | null;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`api-${status}`);
    this.status = status;
    this.body = body;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(24).toString('hex');
}

/** The one published error shape. */
export const Errors = {
  unauthenticated: () => new ApiError(401, { error: 'Authentication required' }),
  notFound: () => new ApiError(404, { error: 'Not found' }),
  forbidden: (message: string) => new ApiError(403, { error: message }),
  tooLarge: (limit: number) => new ApiError(413, { error: `Request body exceeds ${limit} bytes` }),
  conflict: (message: string) => new ApiError(409, { error: message }),
  staleHead: (currentHead: string) => new ApiError(409, { error: 'Stale head', current_head: currentHead }),
  invalid: (fields: Record<string, string>) => new ApiError(422, { errors: fields }),
  outage: (message: string) => new ApiError(503, { error: message }),
  bodyMustBeJson: () => new ApiError(422, { errors: { body: 'Body must be JSON' } }),
} as const;

/** Reads and parses a JSON body with the published size and shape errors. */
export function readJsonBody(raw: Buffer, limit: number): unknown {
  if (raw.length > limit) throw Errors.tooLarge(limit);
  if (raw.length === 0) throw Errors.bodyMustBeJson();
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Errors.bodyMustBeJson();
  }
}

/** The per-route body limit, applied wherever a JSON body is parsed. */
export function parseBodyWithLimit(ctx: { cfg: { pushSizeLimitBytes: number }; req: { body: Buffer; url: URL } }): unknown {
  const segs = ctx.req.url.pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  const isPushOrChecks = (last === 'push' || last === 'checks') && segs.includes('repos');
  return readJsonBody(ctx.req.body, isPushOrChecks ? ctx.cfg.pushSizeLimitBytes : 262144);
}

export function expectObject(v: unknown): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw Errors.bodyMustBeJson();
  return v as Record<string, unknown>;
}

export function requireField(body: Record<string, unknown>, field: string, type: 'string' | 'number' | 'boolean' | 'array'): unknown {
  const v = body[field];
  if (type === 'string' && typeof v === 'string') return v;
  if (type === 'number' && typeof v === 'number' && Number.isInteger(v)) return v;
  if (type === 'boolean' && typeof v === 'boolean') return v;
  if (type === 'array' && Array.isArray(v)) return v;
  throw Errors.invalid({ [field]: `${field} is required` });
}

export function optionalField(body: Record<string, unknown>, field: string, type: 'string' | 'number' | 'boolean' | 'array'): unknown {
  if (!(field in body) || body[field] === undefined) return undefined;
  return requireField(body, field, type);
}

export interface RequestContext {
  cfg: AppConfig;
  db: Database;
  clock: Clock;
  storage: Storage;
  mailer: Mailer;
  live: LiveHub;
  req: {
    method: string;
    url: URL;
    headers: Record<string, string | undefined>;
    cookies: Record<string, string>;
    body: Buffer;
  };
  auth: AuthContext;
  tx: Tx;
}

/** Resolves the caller: session cookie first, then repository token. */
export async function resolveAuth(tx: Tx, headers: Record<string, string | undefined>, cookies: Record<string, string>): Promise<AuthContext> {
  const session = cookies['ridgestack_session'];
  if (session) {
    const r = await tx.query(
      'SELECT u.id, u.username, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1',
      [session],
    );
    if (r.rows.length > 0) return { user: r.rows[0], token: null };
  }
  const authz = headers['authorization'];
  if (authz?.startsWith('Bearer ')) {
    const token = authz.slice('Bearer '.length);
    const r = await tx.query(
      'SELECT t.repo_id, t.access, t.name FROM tokens t WHERE t.token_hash = $1',
      [hashToken(token)],
    );
    if (r.rows.length > 0) return { user: null, token: r.rows[0] };
  }
  return { user: null, token: null };
}

/**
 * Repository resolution with the published rule: a repository the caller
 * cannot see is not found, never forbidden.
 */
export async function visibleRepo(
  ctx: RequestContext, org: string, name: string, need: 'read' | 'write' | 'maintainer' | 'owner' | 'session-only',
): Promise<RepoRow> {
  const repo = await getRepoByPath(ctx.tx, org, name);
  if (!repo) throw Errors.notFound();
  const { auth } = ctx;
  if (auth.token) {
    if (auth.token.repo_id !== repo.id) throw Errors.notFound();
    if (need === 'read') return repo;
    if (need === 'write') {
      if (auth.token.access !== 'write') throw Errors.forbidden('You need write access to do that');
      return repo;
    }
    // maintainer/owner need a session; a valid token answers the step-1 401.
    throw Errors.unauthenticated();
  }
  if (!auth.user) throw Errors.notFound();
  const role = await roleFor(ctx.tx, repo, auth.user);
  if (role === 'none') throw Errors.notFound();
  if (need === 'read') return repo;
  if (need === 'write') {
    if (role === 'writer' || role === 'maintainer' || role === 'owner') return repo;
    throw Errors.forbidden('You need write access to do that');
  }
  if (need === 'maintainer') {
    if (role === 'maintainer' || role === 'owner') return repo;
    throw Errors.forbidden('Only maintainers and owners can do that');
  }
  return repo;
}
