import { pool, query } from '../db.js';
import { errors } from './errors.js';
import type { Ctx, SessionInfo, PartnerKeyInfo } from './http.js';
import { businessDateInZone } from '../domain/time.js';

export const SESSION_COOKIE = 'lanternline_session';

export async function loadSession(ctx: Ctx): Promise<void> {
  const token = ctx.cookies[SESSION_COOKIE];
  if (token === undefined || token === '') return;
  const row = await query<{ id: string; member_id: string; workspace_slug: string; role: string; name: string; email: string; expires_at: Date; ended: boolean; end_reason: string | null }>(
    `SELECT s.id, s.member_id, s.workspace_slug, m.role, m.name, m.email, s.expires_at, s.ended, s.end_reason
     FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.id = $1`,
    [token],
  );
  if (row.rows.length === 0) return;
  const s = row.rows[0];
  if (s.ended) {
    throw s.end_reason === 'access_removed' ? errors.accessRemoved() : errors.sessionEnded();
  }
  if (s.expires_at.getTime() <= Date.now()) {
    await query('UPDATE sessions SET ended = true, end_reason = $2 WHERE id = $1 AND ended = false', [token, 'session_ended']);
    throw errors.sessionEnded();
  }
  ctx.session = { memberId: s.member_id, workspaceSlug: s.workspace_slug, role: s.role, name: s.name, email: s.email };
}

export async function loadPartnerKey(ctx: Ctx): Promise<void> {
  const auth = ctx.req.headers.get('authorization') ?? '';
  const match = auth.match(/^Bearer (lnlk_[0-9a-f]{32})$/);
  if (match === null) throw errors.badPartnerKey();
  const { hashPartnerKey } = await import('../domain/crypto.js');
  const hash = hashPartnerKey(match[1]);
  const row = await query<{ id: string; workspace_slug: string; revoked_at: Date | null }>(
    'SELECT id, workspace_slug, revoked_at FROM partner_keys WHERE key_hash = $1',
    [hash],
  );
  if (row.rows.length === 0) throw errors.badPartnerKey();
  const key = row.rows[0];
  if (key.revoked_at !== null) throw errors.badPartnerKey();
  ctx.partnerKey = { id: key.id, workspaceSlug: key.workspace_slug };
  await query('UPDATE partner_keys SET last_used_at = now() WHERE id = $1', [key.id]);
}

export interface Workspace { slug: string; name: string; legal_name: string; lei: string; jurisdiction_code: string; time_zone: string; city: string; currency: string; confirmation_limit_cents: string; case_prefix: string; sending_address: string; case_sequence: string }

export async function getWorkspace(slug: string): Promise<Workspace | null> {
  const r = await query<Workspace>('SELECT * FROM workspaces WHERE slug = $1', [slug]);
  return r.rows[0] ?? null;
}

/** Resolves the workspace from the path slug; another workspace's slug in the
 * path answers 404, and requires the session to belong to that workspace. */
export async function resolveWorkspace(ctx: Ctx): Promise<Workspace> {
  const slug = ctx.params.slug;
  const ws = await getWorkspace(slug);
  if (ws === null) throw errors.notFound();
  if (ctx.session === null) throw errors.unauthenticated();
  if (ctx.session.workspaceSlug !== slug) throw errors.notFound();
  return ws;
}

export function requireRoles(ctx: Ctx, roles: readonly string[]): void {
  if (ctx.session === null) throw errors.unauthenticated();
  if (!roles.includes(ctx.session.role)) throw errors.forbidden();
}

export function businessDate(ws: Workspace): string {
  return businessDateInZone(new Date(), ws.time_zone);
}

export async function countRows(sql: string, params: unknown[]): Promise<number> {
  const r = await query<{ n: string }>(sql, params);
  return r.rows.length > 0 ? Number(r.rows[0].n) : 0;
}

export async function dbReady(): Promise<boolean> {
  try {
    await pool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export function sessionInfo(ctx: Ctx): SessionInfo {
  if (ctx.session === null) throw errors.unauthenticated();
  return ctx.session;
}

export function partnerInfo(ctx: Ctx): PartnerKeyInfo {
  if (ctx.partnerKey === null) throw errors.badPartnerKey();
  return ctx.partnerKey;
}
