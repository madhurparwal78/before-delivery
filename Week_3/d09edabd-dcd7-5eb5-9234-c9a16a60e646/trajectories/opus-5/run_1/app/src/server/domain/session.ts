import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { Role } from '../../shared/types.js';
import { errors } from '../errors.js';
import type { Ctx } from '../http.js';
import { one } from '../services/db.js';

export const cookieName = 'kb_session';

export interface Member {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  workspaceId: string;
  workspaceName: string;
}

let secret = '';

export function useSecret(value: string): void {
  secret = value;
}

function signature(payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function setSessionCookie(res: ServerResponse, userId: string): void {
  const payload = `${userId}.${Date.now()}`;
  const value = `${payload}.${signature(payload)}`;
  res.setHeader(
    'Set-Cookie',
    `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function userIdFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  // The signing secret lives in Postgres, so without it no cookie can be read.
  if (secret === '') throw errors.databaseUnavailable();
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(signature(payload));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return parts[0];
}

export async function currentMember(ctx: Ctx): Promise<Member | null> {
  const userId = userIdFromCookie(ctx.cookies[cookieName]);
  if (userId === null) return null;
  const row = await one<{
    id: string;
    email: string;
    display_name: string;
    role: Role;
    workspace_id: string;
    workspace_name: string;
  }>(
    `select u.id, u.email, u.display_name, u.role, u.workspace_id, w.name as workspace_name
       from users u join workspaces w on w.id = u.workspace_id where u.id = $1`,
    [userId],
  );
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
  };
}

export async function requireMember(ctx: Ctx): Promise<Member> {
  const member = await currentMember(ctx);
  if (!member) throw errors.unauthenticated();
  return member;
}

export function requireOwner(member: Member): void {
  if (member.role !== 'owner') throw errors.forbidden();
}
