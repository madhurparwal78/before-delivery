import type { InviteRow } from '../../shared/api.js';
import {
  canAdminister,
  inviteBlock,
  inviteStatusAt,
  type InviteBlock,
  type InviteRevokeReason,
  type InviteRole,
  type InviteStatus,
} from '../../shared/states.js';
import { foldEmail } from '../auth.js';
import { config } from '../config.js';
import { one, query, transaction } from '../db.js';
import { Fault, faults } from '../errors.js';
import { newId, newToken } from '../ids.js';
import { created, ok, type Ctx, type Reply, type Route } from '../http.js';
import { inviteMessage, queueMessage } from '../mailer.js';
import { recordActivity, requireEmail, requireRole, requireWorkspace } from '../repo.js';

interface InviteDbRow {
  id: string;
  workspace_id: string;
  email: string;
  email_folded: string;
  role: InviteRole;
  status: InviteStatus;
  reason: InviteRevokeReason;
  token: string;
  expires_at: Date;
}

function blockFault(block: InviteBlock): Fault {
  if (block === 'invite_used') return faults.inviteUsed();
  if (block === 'invite_superseded') return faults.inviteSuperseded();
  if (block === 'invite_revoked') return faults.inviteRevoked();
  return faults.inviteExpired();
}

function liveStatus(row: InviteDbRow): InviteStatus {
  return inviteStatusAt(row.status, row.expires_at, new Date());
}

function inviteJson(row: InviteDbRow): InviteRow {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: liveStatus(row),
    expiresAt: row.expires_at.toISOString(),
  };
}

async function createInvite(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const workspace = await requireWorkspace(ctx.params.wid, account.id);
  if (!canAdminister(workspace.role)) throw faults.forbidden();
  const body = ctx.body();
  const email = requireEmail(body);
  const role = requireRole(body);
  const folded = foldEmail(email);

  const member = await one<{ user_id: string }>(
    `select m.user_id from memberships m join accounts a on a.id = m.user_id
      where m.workspace_id = $1 and a.email_folded = $2`,
    [workspace.workspaceId, folded],
  );
  if (member) throw faults.alreadyMember();

  const expiresAt = new Date(Date.now() + config.inviteTtlSeconds * 1000);
  let superseded: string | null = null;
  let row: InviteDbRow | null = null;
  for (let attempt = 0; attempt < 3 && row === null; attempt += 1) {
    try {
      row = await transaction(async (run) => {
        const older = await run<{ id: string }>(
          `update invites set status = 'revoked', reason = 'superseded'
            where workspace_id = $1 and email_folded = $2 and status = 'pending'
            returning id`,
          [workspace.workspaceId, folded],
        );
        superseded = older.length > 0 ? older[0].id : null;
        const inserted = await run<InviteDbRow>(
          `insert into invites (id, workspace_id, inviter_id, email, email_folded, role, status, token, expires_at)
           values ($1,$2,$3,$4,$5,$6,'pending',$7,$8)
           returning id, workspace_id, email, email_folded, role, status, reason, token, expires_at`,
          [
            newId(),
            workspace.workspaceId,
            account.id,
            email,
            folded,
            role,
            newToken(),
            expiresAt.toISOString(),
          ],
        );
        return inserted[0];
      });
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
    }
  }
  if (!row) throw faults.alreadyMember();

  await recordActivity(workspace.workspaceId, account.id, 'invite.created', email);
  const message = inviteMessage({
    inviter: account.displayName,
    workspaceName: workspace.workspaceName,
    email,
    role,
    token: row.token,
    expiresAt: expiresAt.toISOString(),
  });
  const delivery = await queueMessage({ kind: 'invite', refId: row.id, ...message });
  return created({ invite: inviteJson(row), delivery, superseded });
}

async function revokeInvite(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const workspace = await requireWorkspace(ctx.params.wid, account.id);
  if (!canAdminister(workspace.role)) throw faults.forbidden();
  const row = await one<InviteDbRow>(
    `select id, workspace_id, email, email_folded, role, status, reason, token, expires_at
       from invites where id = $1 and workspace_id = $2`,
    [ctx.params.inviteId, workspace.workspaceId],
  );
  if (!row) throw faults.notFound();
  const block = inviteBlock({ status: liveStatus(row), reason: row.reason });
  if (block) throw blockFault(block);
  await query("update invites set status = 'revoked', reason = 'owner' where id = $1", [row.id]);
  await recordActivity(workspace.workspaceId, account.id, 'invite.revoked', row.email);
  return ok({
    invite: { ...inviteJson(row), status: 'revoked', reason: 'owner' },
  });
}

async function readInvite(ctx: Ctx): Promise<Reply> {
  const row = await one<InviteDbRow & { workspace_name: string }>(
    `select i.id, i.workspace_id, i.email, i.email_folded, i.role, i.status, i.reason,
            i.token, i.expires_at, w.name as workspace_name
       from invites i join workspaces w on w.id = i.workspace_id
      where i.token = $1`,
    [ctx.params.token],
  );
  if (!row) throw faults.notFound();
  const status = liveStatus(row);
  if (status === 'revoked' && row.reason === 'superseded') throw faults.inviteSuperseded();
  return ok({
    invite: {
      workspaceName: row.workspace_name,
      email: row.email,
      role: row.role,
      status,
      reason: status === 'revoked' ? row.reason : null,
      expiresAt: row.expires_at.toISOString(),
    },
  });
}

async function acceptInvite(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const row = await one<InviteDbRow>(
    `select id, workspace_id, email, email_folded, role, status, reason, token, expires_at
       from invites where token = $1`,
    [ctx.params.token],
  );
  if (!row) throw faults.notFound();
  if (foldEmail(account.email) !== row.email_folded)
    throw faults.inviteEmailMismatch(row.email);
  const block = inviteBlock({ status: liveStatus(row), reason: row.reason });
  if (block) throw blockFault(block);

  await transaction(async (run) => {
    await run("update invites set status = 'accepted', reason = null where id = $1", [row.id]);
    await run(
      `insert into memberships (workspace_id, user_id, role) values ($1,$2,$3)
         on conflict (workspace_id, user_id) do update set role = excluded.role`,
      [row.workspace_id, account.id, row.role],
    );
    await run('update accounts set last_workspace_id = $1 where id = $2', [
      row.workspace_id,
      account.id,
    ]);
  });
  await recordActivity(row.workspace_id, account.id, 'invite.accepted', row.email);
  return ok({ workspaceId: row.workspace_id, role: row.role, landing: `/w/${row.workspace_id}` });
}

export const inviteRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/workspaces/:wid/invites', handler: createInvite },
  { method: 'DELETE', pattern: '/api/workspaces/:wid/invites/:inviteId', handler: revokeInvite },
  { method: 'GET', pattern: '/api/invites/:token', handler: readInvite, open: true },
  { method: 'POST', pattern: '/api/invites/:token/accept', handler: acceptInvite },
];
