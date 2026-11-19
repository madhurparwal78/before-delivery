// Contexts: the request scope and auth model.

import type { Db } from './db.js';
import { one } from './db.js';
import { unauthenticated, forbidden, seatRequired, notFound, readOnlyLink } from './errors.js';
import type { Account, ClusterStatus, Role } from '../shared/types.js';

export interface Ctx {
  db: Db;
  account: AccountRow | null;
}

export interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  handle: string;
  role: Role;
  group_id: string | null;
  workspace_id: string | null;
  has_seat: boolean;
}

export interface WorkspaceRow {
  id: string;
  group_id: string;
  slug: string;
  name: string;
  time_zone: string;
  position: number;
}

export interface ReviewLinkRow {
  id: string;
  token: string;
  cluster_id: string;
  workspace_id: string;
  email: string;
  expires_at: Date;
  can_comment: boolean;
  state: 'live' | 'revoked' | 'inactive';
}

export async function accountFromSession(db: Db, token: string | null): Promise<AccountRow | null> {
  if (!token) return null;
  return one<AccountRow>(
    db,
    `select a.* from accounts a join sessions s on s.account_id = a.id where s.token = $1`,
    [token],
  );
}

export async function loadAccount(db: Db, id: string): Promise<AccountRow | null> {
  return one<AccountRow>(db, `select * from accounts where id = $1`, [id]);
}

export function requireAccount(ctx: Ctx): AccountRow {
  if (!ctx.account) throw unauthenticated();
  return ctx.account;
}

export interface MemberContext {
  account: AccountRow;
  workspace: WorkspaceRow;
  isOpsLead: boolean;
  hasSeat: boolean;
}

/** The viewer must be a member of this workspace: an ops lead of its group or a designer of it. */
export async function requireMember(ctx: Ctx, slug: string): Promise<MemberContext> {
  const account = requireAccount(ctx);
  const ws = await one<WorkspaceRow>(ctx.db, `select * from workspaces where slug = $1`, [slug]);
  if (!ws) throw notFound();
  if (account.role === 'ops_lead') {
    if (account.group_id !== ws.group_id) throw notFound();
    return { account, workspace: ws, isOpsLead: true, hasSeat: true };
  }
  if (account.role === 'designer') {
    if (account.workspace_id !== ws.id) throw notFound();
    return { account, workspace: ws, isOpsLead: false, hasSeat: account.has_seat };
  }
  throw notFound();
}

export async function requireOpsLead(ctx: Ctx, slug: string): Promise<MemberContext> {
  const member = await requireMember(ctx, slug);
  if (!member.isOpsLead) throw forbidden();
  return member;
}

/**
 * Gate a write a member makes inside their workspace. The role check comes
 * first (a change the role never allows is forbidden), then the seat.
 */
export function requireSeat(member: MemberContext): void {
  if (member.isOpsLead) return;
  if (!member.hasSeat) throw seatRequired();
}

export async function workspaceOf(db: Db, slug: string): Promise<WorkspaceRow | null> {
  return one<WorkspaceRow>(db, `select * from workspaces where slug = $1`, [slug]);
}

/** The status a cluster effectively has right now (an embargoed cluster lifts at its instant). */
export function effectiveStatus(status: ClusterStatus, liftsAt: Date | null, now: Date): ClusterStatus {
  if (status === 'embargoed' && liftsAt && now.getTime() >= liftsAt.getTime()) return 'public';
  return status;
}
