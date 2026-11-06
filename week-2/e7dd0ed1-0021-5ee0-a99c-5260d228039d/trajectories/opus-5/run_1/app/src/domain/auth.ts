import { one, query, transaction } from '../db';
import { apiError } from '../errors';
import type { Context } from '../http/core';
import { appendAudit } from './audit';
import { findSessionByToken, isConfirmed, markEnded, sessionState, touchSession, type SessionRecord } from './sessions';

export type Role = 'owner' | 'developer' | 'viewer';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  is_operator: boolean;
  two_step_state: string;
}

export interface Membership {
  slug: string;
  name: string;
  role: Role;
}

export interface Principal {
  user: UserRecord;
  session: SessionRecord;
  memberships: Membership[];
}

export type Capability =
  | 'read'
  | 'mint_link'
  | 'revoke_any_link'
  | 'write'
  | 'manage_versions'
  | 'legal_hold'
  | 'admin';

const capabilities: Record<Role, Capability[]> = {
  viewer: ['read', 'mint_link'],
  developer: ['read', 'mint_link', 'revoke_any_link', 'write', 'manage_versions'],
  owner: ['read', 'mint_link', 'revoke_any_link', 'write', 'manage_versions', 'legal_hold', 'admin'],
};

/** The one role table: what each role may do. */
export function roleAllows(role: Role, capability: Capability): boolean {
  return capabilities[role].includes(capability);
}

export type Caller =
  | { kind: 'anonymous' }
  | { kind: 'pending'; session: SessionRecord }
  | { kind: 'active'; principal: Principal };

async function loadUser(userId: string): Promise<UserRecord | null> {
  return one<UserRecord>('select id, name, email, is_operator, two_step_state from users where id = $1', [userId]) as Promise<
    UserRecord | null
  >;
}

export async function loadMemberships(userId: string): Promise<Membership[]> {
  const found = await query<{ slug: string; name: string; role: string }>(
    `select w.slug, w.name, m.role from memberships m join workspaces w on w.slug = m.workspace_slug
     where m.user_id = $1 order by w.name`,
    [userId],
  );
  return found.map((item) => ({ slug: item.slug, name: item.name, role: item.role as Role }));
}

export async function resolveCaller(ctx: Context): Promise<Caller> {
  const token = ctx.cookies.fs_session;
  if (!token) return { kind: 'anonymous' };
  const session = await findSessionByToken(token);
  if (!session) return { kind: 'anonymous' };
  const state = sessionState(session);
  if (state === 'ended') {
    await markEnded(session.id);
    return { kind: 'anonymous' };
  }
  if (state === 'pending') {
    await touchSession(session.id);
    return { kind: 'pending', session };
  }
  const user = await loadUser(session.user_id);
  if (!user) return { kind: 'anonymous' };
  await touchSession(session.id);
  const memberships = await loadMemberships(user.id);
  return { kind: 'active', principal: { user, session, memberships } };
}

export function requireActive(caller: Caller): Principal {
  if (caller.kind === 'pending') throw apiError('two_step_required');
  if (caller.kind === 'anonymous') throw apiError('unauthenticated');
  return caller.principal;
}

export interface WorkspaceRecord {
  slug: string;
  name: string;
  plan_id: string;
  status: string;
  suspended_reason: string | null;
  key_generation: string;
  key_rotated_at: string | null;
  rotation_running: boolean;
}

export async function loadWorkspace(slug: string): Promise<WorkspaceRecord | null> {
  return one<WorkspaceRecord>(
    `select slug, name, plan_id, status, suspended_reason, key_generation, key_rotated_at, rotation_running
     from workspaces where slug = $1`,
    [slug],
  ) as Promise<WorkspaceRecord | null>;
}

export interface WorkspaceScope {
  workspace: WorkspaceRecord;
  role: Role;
  principal: Principal;
}

/** A workspace the caller does not belong to is indistinguishable from one that does not exist. */
export async function requireWorkspace(caller: Caller, slug: string): Promise<WorkspaceScope> {
  const principal = requireActive(caller);
  const membership = principal.memberships.find((item) => item.slug === slug);
  if (!membership) throw apiError('not_found');
  const workspace = await loadWorkspace(slug);
  if (!workspace) throw apiError('not_found');
  return { workspace, role: membership.role, principal };
}

export async function auditPermissionDenied(
  workspaceSlug: string,
  actor: string,
  target: string,
  method: string,
  path: string,
): Promise<void> {
  await transaction(async (client) => {
    await appendAudit(client, workspaceSlug, {
      actor,
      action: 'permission.denied',
      target,
      detail: `${method} ${path}`,
    });
  });
}

/** Refuses an action the caller's role may not take, and records it in the audit trail. */
export async function refuseByRole(scope: WorkspaceScope, ctx: Context, target: string): Promise<never> {
  await auditPermissionDenied(scope.workspace.slug, scope.principal.user.email, target, ctx.method, ctx.path);
  throw apiError('forbidden', "You can't do that.");
}

export async function requireCapability(
  scope: WorkspaceScope,
  capability: Capability,
  ctx: Context,
  target: string,
): Promise<void> {
  if (!roleAllows(scope.role, capability)) await refuseByRole(scope, ctx, target);
}

/** Enrolled members confirm with a fresh code before a sensitive action. */
export function requireStepUp(scope: WorkspaceScope): void {
  if (scope.principal.user.two_step_state !== 'on') return;
  if (!isConfirmed(scope.principal.session)) throw apiError('step_up_required');
}

export function requireActiveWorkspace(scope: WorkspaceScope): void {
  if (scope.workspace.status === 'suspended') throw apiError('workspace_suspended', 'This workspace is suspended.');
}
