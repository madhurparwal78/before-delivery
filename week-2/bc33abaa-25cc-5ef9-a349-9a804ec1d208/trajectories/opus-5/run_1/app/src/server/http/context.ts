import { Request, Response } from 'express';
import { Author, Role } from '../../shared/api';
import { query } from '../db/pool';
import { Caller, Permission, authorOf, can } from '../domain/permissions';
import {
  SubscriptionRow,
  WorkspaceRow,
  getSubscription,
  getWorkspace,
  isReadOnly,
} from '../domain/workspace';
import { sha256Hex } from '../util/crypto';
import { fail } from './errors';

export const SESSION_COOKIE = 'orrery_session';

declare module 'express-serve-static-core' {
  interface Request {
    rawBody: Buffer;
  }
}

export function body(req: Request): Record<string, unknown> {
  const parsed = req.body as unknown;
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) throw fail.notFound();
  return value;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function resolveCaller(req: Request): Promise<Caller | null> {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')) {
    const secret = authorization.slice(7).trim();
    const rows = await query<{
      id: string;
      workspace_id: string;
      name: string;
      scope: 'read' | 'edit';
    }>(
      `SELECT id, workspace_id, name, scope FROM agent_tokens
       WHERE secret_sha256 = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [sha256Hex(secret)],
    );
    const token = rows[0];
    if (!token) return null;
    return {
      kind: 'agent',
      workspaceId: token.workspace_id,
      tokenId: token.id,
      name: token.name,
      scope: token.scope,
    };
  }
  const session = readCookie(req, SESSION_COOKIE);
  if (!session) return null;
  const rows = await query<{
    member_id: string;
    workspace_id: string;
    name: string;
    role: Role;
  }>(
    `SELECT s.member_id, s.workspace_id, m.name, m.role
     FROM sessions s
     JOIN members m ON m.id = s.member_id
     WHERE s.token_sha256 = $1 AND s.revoked_at IS NULL AND m.removed_at IS NULL`,
    [sha256Hex(session)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    kind: 'member',
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    name: row.name,
    role: row.role,
  };
}

export interface CallerContext {
  caller: Caller;
  workspace: WorkspaceRow;
  subscription: SubscriptionRow;
  author: Author;
}

export async function requireCaller(req: Request): Promise<CallerContext> {
  const caller = await resolveCaller(req);
  if (!caller) throw fail.unauthenticated();
  const workspace = await getWorkspace(caller.workspaceId);
  if (!workspace) throw fail.unauthenticated();
  const subscription = await getSubscription(caller.workspaceId);
  return { caller, workspace, subscription, author: authorOf(caller) };
}

export function requirePermission(context: CallerContext, permission: Permission): void {
  if (!can(context.caller, permission)) throw fail.forbidden();
}

/** Scene work, versions, uploads and billing-free writes stop while read-only. */
export function requireWritableWorkspace(context: CallerContext): void {
  if (isReadOnly(context.subscription)) throw fail.workspaceReadOnly();
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  options: { min: number; max: number; message?: string },
): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length < options.min || value.length > options.max) {
    throw fail.validation({
      [field]: options.message ?? `Must be ${options.min} to ${options.max} characters`,
    });
  }
  return value;
}

export function requireInteger(
  body: Record<string, unknown>,
  field: string,
  options: { min: number; max: number },
): number {
  const value = body[field];
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < options.min ||
    value > options.max
  ) {
    throw fail.validation({ [field]: `Must be a whole number between ${options.min} and ${options.max}` });
  }
  return value;
}

export function parseIsoTime(value: unknown, field: string): Date {
  if (typeof value !== 'string') throw fail.validation({ [field]: 'Must be an ISO 8601 time' });
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw fail.validation({ [field]: 'Must be an ISO 8601 time' });
  }
  return parsed;
}

export function queryInteger(
  req: Request,
  name: string,
  options: { min: number; max: number; fallback: number },
): number {
  const raw = req.query[name];
  if (raw === undefined) return options.fallback;
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(value) || value < options.min || value > options.max) {
    throw fail.validation({ [name]: `Must be a whole number between ${options.min} and ${options.max}` });
  }
  return value;
}
