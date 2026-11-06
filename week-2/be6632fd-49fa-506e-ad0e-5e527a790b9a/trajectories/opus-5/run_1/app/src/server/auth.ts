import { config } from './config.ts';
import { query, queryOne, type Transaction } from './db/pool.ts';
import { forbidden, notFound, unauthenticated } from './http/errors.ts';
import type { Role } from '../domain/screens.ts';
import type { Ctx } from './http/context.ts';
import { newId, newToken, sha256Hex } from './services/crypto.ts';

export { isRole, ROLE_HOME, ROLE_LABELS, ROLES, type Role } from '../domain/screens.ts';

export const SESSION_COOKIE = 'hourline_session';

export interface Session {
  memberId: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  email: string;
  role: Role;
  stockistId: string | null;
  createdAtMs: number;
}

interface SessionRow {
  member_id: string;
  workspace_id: string;
  workspace_name: string;
  name: string;
  email: string;
  role: Role;
  stockist_id: string | null;
  expires_at_ms: number;
  removed_at_ms: number | null;
  created_at_ms: number;
}

export type SessionOutcome =
  | { kind: 'none' }
  | { kind: 'ended' }
  | { kind: 'removed' }
  | { kind: 'ok'; session: Session };

export async function readSession(ctx: Ctx): Promise<SessionOutcome> {
  const token = ctx.cookie(SESSION_COOKIE);
  if (token === null || token === '') return { kind: 'none' };
  const row = await queryOne<SessionRow>(
    `select s.member_id, s.expires_at_ms, s.created_at_ms,
            m.workspace_id, m.name, m.email, m.role, m.stockist_id, m.removed_at_ms,
            w.name as workspace_name
       from sessions s
       join members m on m.id = s.member_id
       join workspaces w on w.id = m.workspace_id
      where s.token_hash = $1`,
    [sha256Hex(token)],
  );
  if (row === null) return { kind: 'none' };
  if (row.removed_at_ms !== null) return { kind: 'removed' };
  if (ctx.nowMs >= Number(row.expires_at_ms)) return { kind: 'ended' };
  return {
    kind: 'ok',
    session: {
      memberId: row.member_id,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      name: row.name,
      email: row.email,
      role: row.role,
      stockistId: row.stockist_id,
      createdAtMs: Number(row.created_at_ms),
    },
  };
}

/** Step 4 of the error ladder: no session, an ended session or a removed member. */
export async function requireSession(ctx: Ctx): Promise<Session> {
  const outcome = await readSession(ctx);
  if (outcome.kind === 'ok') return outcome.session;
  if (outcome.kind === 'ended') throw unauthenticated('session_ended');
  if (outcome.kind === 'removed') throw unauthenticated('access_removed');
  throw unauthenticated('unauthenticated');
}

/** Step 6 of the error ladder: a role that may not act. */
export function requireRole(session: Session, ...roles: readonly Role[]): void {
  if (!roles.includes(session.role)) throw forbidden();
}

/** A stockist buyer can see no other member, so another member's id is simply absent. */
export function requireVisibleMember(session: Session, memberId: string): void {
  if (session.role === 'stockist_buyer' && memberId !== session.memberId) throw notFound();
}

export async function createSession(
  tx: Transaction,
  memberId: string,
  nowMs: number,
): Promise<string> {
  const token = newToken();
  await tx.query(
    `insert into sessions (id, token_hash, member_id, created_at_ms, expires_at_ms)
     values ($1, $2, $3, $4, $5)`,
    [newId(), sha256Hex(token), memberId, nowMs, nowMs + config.ttl.sessionSeconds * 1000],
  );
  return token;
}

export async function endSession(token: string): Promise<void> {
  await query('delete from sessions where token_hash = $1', [sha256Hex(token)]);
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.ttl.sessionSeconds}`;
}

export function clearedCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
