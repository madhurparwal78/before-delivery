import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_SIZE_LIMIT_BYTES, config } from './config.js';
import { db, type Db } from './db.js';
import { ApiError, forbidden, notFound, tooLarge, unauthorized } from './errors.js';
import { getRepo, getUserById, isOrgOwner, roleFor, ROLE_RANK, type RepoRow, type Role, type UserRow } from '../domain/model.js';

export const SESSION_COOKIE = 'ridgestack_session';

export interface TokenCaller {
  kind: 'token';
  repoId: number;
  access: 'read' | 'write';
  name: string;
}

export interface UserCaller {
  kind: 'user';
  user: UserRow;
}

export type Caller = TokenCaller | UserCaller | null;

export interface Ctx {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  method: string;
  segments: string[];
  caller: Caller;
  rawBody: Buffer | null;
  parsedBody: Record<string, unknown> | null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(24).toString('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    chunks.push(buffer);
    if (total > limit + 1) break;
  }
  return Buffer.concat(chunks);
}

export async function resolveCaller(request: IncomingMessage): Promise<{ caller: Caller; badToken: boolean }> {
  const authorization = request.headers.authorization;
  if (authorization && authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    const rows = await db.query<{ repo_id: string; access: 'read' | 'write'; name: string }>(
      'SELECT repo_id, access, name FROM rs_tokens WHERE token_hash = $1',
      [hashToken(token)],
    );
    if (rows.length === 0) return { caller: null, badToken: true };
    return {
      caller: { kind: 'token', repoId: Number(rows[0].repo_id), access: rows[0].access, name: rows[0].name },
      badToken: false,
    };
  }
  const cookies = parseCookies(request.headers.cookie);
  const session = cookies[SESSION_COOKIE];
  if (!session) return { caller: null, badToken: false };
  const rows = await db.query<{ user_id: string }>('SELECT user_id FROM rs_sessions WHERE token = $1', [session]);
  if (rows.length === 0) return { caller: null, badToken: false };
  const user = await getUserById(db, Number(rows[0].user_id));
  if (!user) return { caller: null, badToken: false };
  return { caller: { kind: 'user', user }, badToken: false };
}

export function requireUser(ctx: Ctx): UserRow {
  if (!ctx.caller || ctx.caller.kind !== 'user') throw unauthorized();
  return ctx.caller.user;
}

export function callerUser(ctx: Ctx): UserRow | null {
  return ctx.caller && ctx.caller.kind === 'user' ? ctx.caller.user : null;
}

export type Need = 'read' | 'write' | 'maintainer' | 'owner';

export interface RepoAccess {
  repo: RepoRow;
  role: Role | null;
  user: UserRow | null;
  token: TokenCaller | null;
}

/** The one place that turns a caller into repository access, with the published error order. */
export async function repoAccess(
  tx: Db,
  ctx: Ctx,
  org: string,
  name: string,
  need: Need,
  options: { tokensAllowed?: boolean } = {},
): Promise<RepoAccess> {
  const tokensAllowed = options.tokensAllowed === true;
  if (!ctx.caller) throw unauthorized();
  if (ctx.caller.kind === 'token' && !tokensAllowed) throw unauthorized();

  const repo = await getRepo(tx, org, name);
  if (!repo) throw notFound();

  if (ctx.caller.kind === 'token') {
    const token = ctx.caller;
    if (token.repoId !== repo.id) throw notFound();
    if (need !== 'read' && token.access !== 'write') throw forbidden('You need write access to do that');
    if (need === 'maintainer' || need === 'owner') throw forbidden('Only maintainers and owners can do that');
    return { repo, role: token.access === 'write' ? 'writer' : 'reader', user: null, token };
  }

  const user = ctx.caller.user;
  const role = await roleFor(tx, repo, user.id);
  if (role === null) throw notFound();
  if (need === 'write' && ROLE_RANK[role] < ROLE_RANK.writer) throw forbidden('You need write access to do that');
  if ((need === 'maintainer' || need === 'owner') && ROLE_RANK[role] < ROLE_RANK.maintainer) {
    throw forbidden('Only maintainers and owners can do that');
  }
  if (need === 'owner' && role !== 'owner') throw forbidden('Only owners can grant owner');
  return { repo, role, user, token: null };
}

export async function requireOrgOwner(tx: Db, ctx: Ctx, orgSlug: string): Promise<UserRow> {
  const user = requireUser(ctx);
  const rows = await tx.query('SELECT 1 FROM rs_orgs WHERE slug = $1', [orgSlug]);
  if (rows.length === 0) throw notFound();
  if (!(await isOrgOwner(tx, orgSlug, user.id))) throw forbidden('Only organisation owners can do that');
  return user;
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

export function sendText(response: ServerResponse, status: number, body: Buffer | string, contentType: string): void {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

export function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(response, error.status, error.body);
    return;
  }
  console.error('[api]', error);
  sendJson(response, 500, { error: 'Server error' });
}

export function parseJsonBody(raw: Buffer, limit: number): Record<string, unknown> {
  if (raw.length > limit) throw tooLarge(limit);
  if (raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(422, { errors: { body: 'Body must be JSON' } });
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, { errors: { body: 'Body must be JSON' } });
  }
}

export function jsonLimitFor(pathname: string): number {
  return pathname.endsWith('/push') || pathname.endsWith('/checks') ? config.pushSizeLimitBytes : JSON_SIZE_LIMIT_BYTES;
}

export function setSessionCookie(response: ServerResponse, token: string): void {
  response.setHeader('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

export function clearSessionCookie(response: ServerResponse): void {
  response.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
