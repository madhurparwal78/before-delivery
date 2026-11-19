import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db';
import type { Viewer } from './user-projection';
import { ApiError } from './errors';
import type { Role } from '../shared/terms';

export const SESSION_COOKIE = 'rimewire_session';

export interface CookieOptions {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    cookies: Record<string, string>;
  }
}

export async function viewerFromRequest(db: Db, request: FastifyRequest): Promise<Viewer | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const res = await db.pool.query(
    `SELECT u.id, u.workspace_id, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1`,
    [token],
  );
  if (res.rowCount === 0 || res.rows[0].status !== 'active') return null;
  const row = res.rows[0];
  return { id: row.id, workspaceId: row.workspace_id, role: row.role as Role };
}

export async function requireViewer(db: Db, request: FastifyRequest): Promise<Viewer> {
  const viewer = await viewerFromRequest(db, request);
  if (!viewer) throw new ApiError('unauthenticated');
  return viewer;
}

export function canPin(role: Role): boolean {
  return role === 'ops_manager' || role === 'dispatcher' || role === 'crew_lead';
}

export function canSchedule(role: Role): boolean {
  return role === 'ops_manager' || role === 'dispatcher';
}

export function canEditAnyone(role: Role): boolean {
  return role === 'ops_manager' || role === 'dispatcher' || role === 'crew_lead';
}

export function canTopLevelPost(role: Role): boolean {
  return role === 'ops_manager' || role === 'dispatcher' || role === 'crew_lead';
}

export function canSeeReceipts(role: Role): boolean {
  return role === 'ops_manager' || role === 'dispatcher' || role === 'crew_lead';
}
