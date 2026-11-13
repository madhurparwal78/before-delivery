import { ACTIVITY_MAX_LIMIT, ACTIVITY_PAGE_SIZE, type ActivityAction } from '../../shared/activity.js';
import type { ActivityResponse, InviteRow, MemberRow, WorkspaceResponse } from '../../shared/api.js';
import { canAdminister, inviteStatusAt, type InviteRole, type WorkspaceRole } from '../../shared/states.js';
import { one, query } from '../db.js';
import { faults } from '../errors.js';
import { newId } from '../ids.js';
import { created, ok, type Ctx, type Reply, type Route } from '../http.js';
import { queueMessage, roleChangeMessage } from '../mailer.js';
import { recordActivity, requireDomainName, requireRole, requireWorkspace } from '../repo.js';
import { releaseLeasesForUser } from '../locks.js';

async function touchLastOpened(userId: string, workspaceId: string): Promise<void> {
  await query('update accounts set last_workspace_id = $1 where id = $2', [workspaceId, userId]);
}

async function createWorkspace(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const name = requireDomainName(ctx.body(), 'name');
  const id = newId();
  await query('insert into workspaces (id, name, owner_id) values ($1,$2,$3)', [
    id,
    name,
    account.id,
  ]);
  await query('insert into memberships (workspace_id, user_id, role) values ($1,$2,$3)', [
    id,
    account.id,
    'owner',
  ]);
  await recordActivity(id, account.id, 'workspace.created', name);
  await touchLastOpened(account.id, id);
  return created({ workspace: { id, name, role: 'owner' } });
}

export async function pendingInvites(workspaceId: string): Promise<InviteRow[]> {
  const rows = await query<{
    id: string;
    email: string;
    role: InviteRole;
    status: string;
    expires_at: Date;
  }>(
    `select id, email, role, status, expires_at from invites
      where workspace_id = $1 and status = 'pending' order by created_at desc`,
    [workspaceId],
  );
  const now = new Date();
  return rows
    .map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: inviteStatusAt('pending', row.expires_at, now),
      expiresAt: row.expires_at.toISOString(),
    }))
    .filter((invite) => invite.status === 'pending');
}

async function getWorkspace(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const workspace = await requireWorkspace(ctx.params.wid, account.id);
  const members = await query<{
    user_id: string;
    display_name: string;
    email: string;
    role: WorkspaceRole;
  }>(
    `select m.user_id, a.display_name, a.email, m.role
       from memberships m join accounts a on a.id = m.user_id
      where m.workspace_id = $1 order by m.joined_at, a.display_name`,
    [workspace.workspaceId],
  );
  await touchLastOpened(account.id, workspace.workspaceId);
  const response: WorkspaceResponse = {
    workspace: {
      id: workspace.workspaceId,
      name: workspace.workspaceName,
      role: workspace.role,
    },
    members: members.map<MemberRow>((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      role: row.role,
    })),
    invites: canAdminister(workspace.role) ? await pendingInvites(workspace.workspaceId) : [],
  };
  return ok(response);
}

async function changeMemberRole(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const workspace = await requireWorkspace(ctx.params.wid, account.id);
  if (!canAdminister(workspace.role)) throw faults.forbidden();
  const target = await one<{
    user_id: string;
    display_name: string;
    email: string;
    role: WorkspaceRole;
  }>(
    `select m.user_id, a.display_name, a.email, m.role
       from memberships m join accounts a on a.id = m.user_id
      where m.workspace_id = $1 and m.user_id = $2`,
    [workspace.workspaceId, ctx.params.userId],
  );
  if (!target) throw faults.notFound();
  const role = requireRole(ctx.body());
  if (target.role === 'owner') throw faults.ownerRoleFixed();

  await query('update memberships set role = $1 where workspace_id = $2 and user_id = $3', [
    role,
    workspace.workspaceId,
    target.user_id,
  ]);
  if (role === 'viewer') await releaseLeasesForUser(target.user_id).catch(() => undefined);
  await recordActivity(
    workspace.workspaceId,
    account.id,
    'member.role_changed',
    target.display_name,
  );
  const message = roleChangeMessage({
    email: target.email,
    workspaceName: workspace.workspaceName,
    role,
  });
  await queueMessage({ kind: 'role', ...message });
  return ok({
    member: {
      userId: target.user_id,
      displayName: target.display_name,
      email: target.email,
      role,
    },
  });
}

async function activity(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const workspace = await requireWorkspace(ctx.params.wid, account.id);
  const limitText = ctx.query('limit');
  let limit = ACTIVITY_PAGE_SIZE;
  if (limitText !== null) {
    const parsed = Number(limitText);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > ACTIVITY_MAX_LIMIT)
      throw faults.invalidCursor();
    limit = parsed;
  }
  const before = ctx.query('before');
  let cursor: { at: Date; id: string } | null = null;
  if (before !== null) {
    const row = await one<{ at: Date; id: string }>(
      'select at, id from activity where id = $1 and workspace_id = $2',
      [before, workspace.workspaceId],
    );
    if (!row) throw faults.invalidCursor();
    cursor = row;
  }
  const rows = await query<{
    id: string;
    at: Date;
    action: ActivityAction;
    target_name: string;
    actor_id: string;
    display_name: string;
  }>(
    `select e.id, e.at, e.action, e.target_name, e.actor_id, a.display_name
       from activity e join accounts a on a.id = e.actor_id
      where e.workspace_id = $1
        ${cursor ? 'and (e.at, e.id) < ($2::timestamptz, $3)' : ''}
      order by e.at desc, e.id desc
      limit ${limit}`,
    cursor ? [workspace.workspaceId, cursor.at.toISOString(), cursor.id] : [workspace.workspaceId],
  );
  const events = rows.map((row) => ({
    id: row.id,
    at: row.at.toISOString(),
    actor: { userId: row.actor_id, displayName: row.display_name },
    action: row.action,
    targetName: row.target_name,
  }));
  let nextBefore: string | null = null;
  if (events.length > 0) {
    const last = events[events.length - 1];
    const older = await one<{ id: string }>(
      `select id from activity
        where workspace_id = $1 and (at, id) < ($2::timestamptz, $3)
        order by at desc, id desc limit 1`,
      [workspace.workspaceId, last.at, last.id],
    );
    nextBefore = older ? last.id : null;
  }
  const response: ActivityResponse = { events, nextBefore };
  return ok(response);
}

export const workspaceRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/workspaces', handler: createWorkspace },
  { method: 'GET', pattern: '/api/workspaces/:wid', handler: getWorkspace },
  {
    method: 'PATCH',
    pattern: '/api/workspaces/:wid/members/:userId',
    handler: changeMemberRole,
  },
  { method: 'GET', pattern: '/api/workspaces/:wid/activity', handler: activity },
];
