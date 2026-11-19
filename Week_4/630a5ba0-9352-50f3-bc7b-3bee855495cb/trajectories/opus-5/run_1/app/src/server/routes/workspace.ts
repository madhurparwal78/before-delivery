import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import type { MemberRow, WorkspaceRow } from '../db/records.js';
import type { ReviewDto, WorkspaceMemberDto } from '../../shared/types.js';
import { Response, accepted, created } from '../http/server.js';
import {
  jsonBody,
  requireOwner,
  requireWritable,
  type RequestContext,
} from '../http/context.js';
import { ApiError, conflict, notFound, unprocessable } from '../http/errors.js';
import { FieldErrors, checkEmail, checkName, checkPassword, checkTimeZone } from '../http/validate.js';
import { createAuthSession, hashPassword, newId, randomToken } from '../services/auth.js';
import { enqueue, runItemNow } from '../services/outbox.js';
import { inviteMail } from '../services/messages.js';
import { BillingUnavailable, cancelSeat, ensureAccount, ensureCatalog } from '../services/killbill.js';
import { activeSeatCount, billingEventsFor, statusFrom, workspaceDto } from '../services/workspaces.js';
import { emailTaken, memberDto, sessionCookie } from './auth.js';
import { addDays, isoWeekMonday, isoWeekOf, todayInZone } from '../../shared/time.js';
import type { Router } from '../http/router.js';

function memberRowDto(member: MemberRow): WorkspaceMemberDto {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    status: member.status === 'removed' ? 'active' : member.status,
  };
}

async function seatsOf(context: RequestContext, workspaceId: string): Promise<{ active: number; billed: number | null }> {
  return { active: await activeSeatCount(workspaceId), billed: context.billedSeats };
}

async function listMembers(context: RequestContext): Promise<unknown> {
  const { workspace } = requireOwner(context);
  const members = await pool.query<MemberRow>(
    `select * from members where workspace_id = $1 and status <> 'removed'
      order by case when role = 'owner' then 0 else 1 end, created_at, name`,
    [workspace.id],
  );
  return {
    members: members.rows.map(memberRowDto),
    seats: await seatsOf(context, workspace.id),
  };
}

/** An invite holds a seat: Kill Bill must accept the seat before the email goes out. */
async function invite(context: RequestContext): Promise<Response> {
  const { member: owner, workspace } = requireOwner(context);
  requireWritable(context);
  const body = jsonBody(context);
  const errors = new FieldErrors();
  const email = checkEmail(errors, 'email', body.email);
  errors.throwIfAny();

  const inside = await pool.query(
    `select 1 from members where workspace_id = $1 and email_lower = $2 and status <> 'removed'`,
    [workspace.id, email.toLowerCase()],
  );
  if ((inside.rowCount ?? 0) > 0) {
    throw conflict('already_member', `${email} is already in this workspace.`);
  }
  if (await emailTaken(pool, email)) {
    throw conflict('email_taken', `${email} already has a Daybook.`);
  }

  const invited = await withTransaction(async (tx) => {
    const memberId = newId();
    const token = randomToken();
    const row = await tx.query<MemberRow>(
      `insert into members (id, workspace_id, name, email, email_lower, password_hash, role, time_zone,
                            threshold_minutes, status, feed_token, invite_token, created_at, updated_at)
       values ($1, $2, $3, $4, lower($4), '', 'member', $5, 360, 'pending_billing', $6, $7, now(), now())
       returning *`,
      [memberId, workspace.id, email, email, owner.time_zone, randomToken(), token],
    );
    const queueId = await enqueue(tx, 'killbill_add_seat', {
      workspaceId: workspace.id,
      memberId,
      origin: context.origin,
    });
    return { row: row.rows[0]!, token, queueId };
  });

  const seated = await runItemNow(invited.queueId);
  if (!seated) {
    return accepted({ member: memberRowDto({ ...invited.row, status: 'pending_billing' }), billing: 'queued' });
  }

  const refreshed = await pool.query<MemberRow>('select * from members where id = $1', [invited.row.id]);
  const row = refreshed.rows[0] ?? invited.row;
  const mailQueueId = await pool.query<{ id: string }>(
    `select id from outbox where dedupe_key = $1 and status = 'pending'`,
    [`invite:${invited.row.id}`],
  );
  const sent = await runItemNow(mailQueueId.rows[0]?.id ?? null);
  return created({ member: memberRowDto(row), email: sent ? 'sent' : 'queued' });
}

/** Removing a member cancels their seat, or changes nothing when billing is unreachable. */
async function removeMember(context: RequestContext): Promise<unknown> {
  const { workspace } = requireOwner(context);
  const id = context.params.id ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();

  const found = await pool.query<MemberRow>(
    `select * from members where id = $1 and workspace_id = $2 and status <> 'removed'`,
    [id, workspace.id],
  );
  const member = found.rows[0];
  if (!member) throw notFound();
  if (member.role === 'owner') throw conflict('cannot_remove_owner', "The owner can't be removed.");

  if (member.status === 'pending_billing') {
    await withTransaction(async (tx) => {
      await tx.query(`delete from outbox where dedupe_key is null and kind = 'killbill_add_seat'
                       and payload->>'memberId' = $1 and status = 'pending'`, [member.id]);
      await removeRow(tx, member.id);
    });
    return { seats: await seatsOf(context, workspace.id) };
  }

  try {
    await withTransaction(async (tx) => {
      await removeRow(tx, member.id);
      await ensureCatalog();
      const accountId =
        workspace.killbill_account_id ??
        (await ensureAccount({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          ownerEmail: context.member?.email ?? '',
        }));
      await cancelSeat({
        accountId,
        workspaceId: workspace.id,
        memberId: member.id,
        subscriptionId: member.killbill_subscription_id,
      });
    });
  } catch (error) {
    if (error instanceof BillingUnavailable) {
      throw new ApiError(503, 'billing_unavailable', 'Billing is unreachable, so nothing changed.');
    }
    throw error;
  }
  return { seats: await seatsOf(context, workspace.id) };
}

async function removeRow(tx: PoolClient, memberId: string): Promise<void> {
  await tx.query(
    `update members set status = 'removed', feed_token = null, invite_token = null, updated_at = now()
      where id = $1`,
    [memberId],
  );
  await tx.query('delete from auth_sessions where member_id = $1', [memberId]);
}

async function invitationDetails(context: RequestContext): Promise<unknown> {
  const token = context.params.token ?? '';
  const found = await pool.query<MemberRow & { workspace_name: string }>(
    `select m.*, w.name as workspace_name from members m join workspaces w on w.id = m.workspace_id
      where m.invite_token = $1`,
    [token],
  );
  const member = found.rows[0];
  if (!member) throw notFound();
  if (member.invite_used_at !== null) {
    throw new ApiError(410, 'invitation_used', 'This invite has already been used.');
  }
  return { workspaceName: member.workspace_name, email: member.email };
}

async function acceptInvitation(context: RequestContext): Promise<Response> {
  const token = context.params.token ?? '';
  const body = jsonBody(context);
  const found = await pool.query<MemberRow>('select * from members where invite_token = $1', [token]);
  const member = found.rows[0];
  if (!member) throw notFound();
  if (member.invite_used_at !== null) {
    throw new ApiError(410, 'invitation_used', 'This invite has already been used.');
  }

  const errors = new FieldErrors();
  const name = checkName(errors, 'name', body.name);
  const password = checkPassword(errors, 'password', body.password);
  const timeZone = checkTimeZone(errors, 'timeZone', body.timeZone);
  errors.throwIfAny();

  const passwordHash = await hashPassword(password);
  const result = await withTransaction(async (tx) => {
    const updated = await tx.query<MemberRow>(
      `update members
          set name = $2, password_hash = $3, time_zone = $4, status = 'active',
              invite_used_at = now(), updated_at = now()
        where id = $1 and invite_used_at is null
        returning *`,
      [member.id, name, passwordHash, timeZone],
    );
    const row = updated.rows[0];
    if (!row) throw new ApiError(410, 'invitation_used', 'This invite has already been used.');
    const sessionToken = await createAuthSession(tx, row.id);
    return { row, sessionToken };
  });

  const workspace = await pool.query<WorkspaceRow>('select * from workspaces where id = $1', [
    result.row.workspace_id,
  ]);
  const row = workspace.rows[0]!;
  const status = statusFrom(row, await billingEventsFor(row.id));
  return created(
    { member: memberDto(result.row), workspace: workspaceDto(row, status.state) },
    sessionCookie(result.sessionToken),
  );
}

/**
 * Planned and done estimate minutes per seat-holding member for an ISO week, by each
 * member's own local dates, for the owner's workspace only.
 */
async function review(context: RequestContext): Promise<ReviewDto> {
  const { member: owner, workspace } = requireOwner(context);
  const requested = context.query.get('week');
  const week = requested ?? isoWeekOf(todayInZone(owner.time_zone));
  const monday = isoWeekMonday(week);
  if (monday === null) throw unprocessable('validation_failed', 'Use an ISO week like 2026-W09.');
  const sunday = addDays(monday, 6);

  const members = await pool.query<MemberRow>(
    `select * from members where workspace_id = $1 and status in ('active', 'invited')
      order by case when role = 'owner' then 0 else 1 end, created_at, name`,
    [workspace.id],
  );
  const rows = await pool.query<{ member_id: string; planned: string; done: string }>(
    `select member_id,
            coalesce(sum(estimate_minutes), 0)::text as planned,
            coalesce(sum(case when status = 'done' then estimate_minutes else 0 end), 0)::text as done
       from tasks
      where workspace_id = $1 and day_date between $2 and $3
      group by member_id`,
    [workspace.id, monday, sunday],
  );
  const totals = new Map(rows.rows.map((row) => [row.member_id, row]));

  const perMember = members.rows.map((row) => {
    const found = totals.get(row.id);
    return {
      memberId: row.id,
      name: row.name,
      plannedMinutes: Number(found?.planned ?? '0'),
      doneMinutes: Number(found?.done ?? '0'),
    };
  });

  return {
    week,
    members: perMember,
    totals: {
      plannedMinutes: perMember.reduce((sum, entry) => sum + entry.plannedMinutes, 0),
      doneMinutes: perMember.reduce((sum, entry) => sum + entry.doneMinutes, 0),
    },
  };
}

export function registerWorkspaceRoutes(router: Router): void {
  router.get('/api/workspace/members', listMembers);
  router.post('/api/workspace/invitations', invite);
  router.delete('/api/workspace/members/:id', removeMember);
  router.get('/api/invitations/:token', invitationDetails);
  router.post('/api/invitations/:token/accept', acceptInvitation);
  router.get('/api/workspace/review', review);
}
