import type { Request, Response } from 'express';
import { ApiError } from '../src-shared/errors.js';
import {
  addDays,
  compareDates,
  dayLabel,
  isoInstant,
  isoWeekDates,
  isoWeekOf,
  localDateOf,
} from '../src-shared/domain.js';
import { enqueueOutbox, type OutboxItem } from './outbox.js';
import { hmacSign, hashPassword, newFeedToken, newId, newInviteToken, verifyPassword } from './ids.js';
import {
  loadMemberByEmail,
  toApiMember,
  toApiWorkspace,
  type MemberRow,
  type TaskRow,
} from './repo.js';
import {
  h,
  sendJson,
  memberToday,
  requireMember,
  requireRole,
  requirePlanner,
  isPlainObject,
  type AppDeps,
} from './api-core.js';
import { loadMemberRow, originOf, setSessionCookie, readSessionCookie } from './api-routes.js';
import { KillBillError } from './killbill.js';
import { eventApplied, loadWorkspace, newestSeatsEvent, replayState, workspaceLock, type StateEventRow } from './subscriptions.js';

// ---------------------------------------------------------------------------
// Workspace management (owner) and invitations

export function workspaceHandlers(deps: AppDeps) {
  const members = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requireRole(member, 'owner');
    const rows = await deps.db.query<MemberRow>('SELECT * FROM members WHERE workspace_id = $1 AND removed_at IS NULL ORDER BY created_at, id', [member.workspace_id]);
    const seatHolders = rows.filter((m) => m.role === 'owner' || m.status === 'active' || m.status === 'invited');
    const billed = await billedSeats(deps, member.workspace_id);
    sendJson(res, 200, {
      members: rows.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        status: m.status,
      })),
      seats: { active: seatHolders.length, billed },
    });
  };

  const invite = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requireRole(member, 'owner');
    await requireWorkspaceWritableForInvite(deps, member);
    const body = isPlainObject(req.body) ? req.body : {};
    const email = cleanEmailField(body.email);
    const existing = await loadMemberByEmail(deps.db, email);
    if (existing !== null) {
      if (existing.workspace_id === member.workspace_id) throw new ApiError('already_member', `${email} is already in this workspace.`);
      throw new ApiError('email_taken', `${email} already has a Daybook.`);
    }
    const token = newInviteToken();
    const newMemberId = newId('mem');
    const origin = originOf(req);

    // Create the Kill Bill seat first; queue it when unreachable.
    let billingQueued = false;
    const outbox: OutboxItem[] = [];
    try {
      await deps.killbill.ensureCatalog();
      await deps.killbill.ensureSeat(member.workspace_id, newMemberId);
    } catch {
      billingQueued = true;
      outbox.push({ kind: 'billing_seat', workspaceId: member.workspace_id, memberId: newMemberId });
    }
    if (!billingQueued) {
      outbox.push({
        kind: 'email',
        message: {
          kind: 'invite',
          to: email,
          ownerName: member.name,
          workspaceName: (await loadWorkspace(deps.db, member.workspace_id))?.name ?? '',
          joinUrl: `${origin}/join/${token}`,
        },
      });
    }

    await deps.db.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO members (id, workspace_id, name, email, password_hash, role, status, time_zone, threshold_minutes, feed_token, invite_token, invite_used)
         VALUES ($1, $2, $3, $4, '', 'member', $5, 'UTC', 360, $6, $7, false)`,
        [newMemberId, member.workspace_id, email, email, billingQueued ? 'pending_billing' : 'invited', newFeedToken(), token],
      );
      await enqueueOutbox(client, outbox);
    });

    if (billingQueued) {
      const fresh = await loadMemberRow(deps, newMemberId);
      sendJson(res, 202, { member: { id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role, status: fresh.status }, billing: 'queued' });
      return;
    }
    let emailSent = 'sent';
    const queued = await deps.db.query("SELECT id FROM outbox WHERE status = 'pending' AND kind = 'email' ORDER BY id DESC LIMIT 1");
    const item = queued[0];
    if (item !== undefined) {
      try {
        const payloadRow = await deps.db.query<{ payload: OutboxItem }>('SELECT payload FROM outbox WHERE id = $1', [item.id]);
        const payload = payloadRow[0]?.payload;
        if (payload?.kind === 'email') {
          await deps.mailer.send(String(item.id), payload.message);
          await deps.db.query("UPDATE outbox SET status = 'done', sent_at = now(), attempts = attempts + 1 WHERE id = $1", [item.id]);
        }
      } catch {
        emailSent = 'queued';
      }
    }
    const fresh = await loadMemberRow(deps, newMemberId);
    sendJson(res, 201, {
      member: { id: fresh.id, name: fresh.name, email: fresh.email, role: fresh.role, status: fresh.status },
      email: emailSent,
    });
  };

  const removeMember = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requireRole(member, 'owner');
    const targetId = String(req.params.id);
    const rows = await deps.db.query<MemberRow>('SELECT * FROM members WHERE id = $1 AND workspace_id = $2 AND removed_at IS NULL', [targetId, member.workspace_id]);
    const target = rows[0];
    if (target === undefined) throw new ApiError('not_found', "That member doesn't exist.");
    if (target.role === 'owner') throw new ApiError('cannot_remove_owner', "The owner can't be removed.");

    if (target.status !== 'pending_billing') {
      try {
        await deps.killbill.cancelSeat(member.workspace_id, target.id);
      } catch {
        throw new ApiError('billing_unavailable', 'Billing is unreachable, so the member is still a member. Try again shortly.');
      }
    }
    await deps.db.withTransaction(async (client) => {
      await client.query('UPDATE members SET removed_at = now(), feed_token = $2 WHERE id = $1', [target.id, newFeedToken()]);
      await client.query('DELETE FROM sessions_auth WHERE member_id = $1', [target.id]);
    });
    const seatHolders = await seatHoldersOf(deps, member.workspace_id);
    sendJson(res, 200, { seats: { active: seatHolders.length, billed: await billedSeats(deps, member.workspace_id) } });
  };

  const review = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requireRole(member, 'owner');
    const today = memberToday(member);
    const rawWeek = req.query.week;
    const week = rawWeek === undefined || typeof rawWeek !== 'string' ? isoWeekOf(today) : rawWeek;
    const dates = isoWeekDates(week);
    if (dates === null) throw new ApiError('validation', 'Choose a week written YYYY-Www.', { fields: { week: 'Use the format YYYY-Www.' } });
    const seatMembers = (await deps.db.query<MemberRow>('SELECT * FROM members WHERE workspace_id = $1 AND removed_at IS NULL', [member.workspace_id]))
      .filter((m) => m.role === 'owner' || m.status === 'active' || m.status === 'invited');
    const rows: Array<{ memberId: string; name: string; plannedMinutes: number; doneMinutes: number }> = [];
    for (const m of seatMembers) {
      const tasks = await deps.db.query<TaskRow>('SELECT * FROM tasks WHERE member_id = $1 AND day_date >= $2 AND day_date <= $3', [m.id, dates.monday, dates.sunday]);
      let planned = 0;
      let done = 0;
      for (const t of tasks) {
        const estimate = t.estimate_minutes ?? 0;
        planned += estimate;
        if (t.status === 'done') done += estimate;
      }
      rows.push({ memberId: m.id, name: m.name, plannedMinutes: planned, doneMinutes: done });
    }
    const totals = rows.reduce(
      (acc, r) => ({ plannedMinutes: acc.plannedMinutes + r.plannedMinutes, doneMinutes: acc.doneMinutes + r.doneMinutes }),
      { plannedMinutes: 0, doneMinutes: 0 },
    );
    sendJson(res, 200, { week, members: rows, totals });
  };

  return { members, invite, removeMember, review };
}

async function seatHoldersOf(deps: AppDeps, workspaceId: string): Promise<MemberRow[]> {
  const rows = await deps.db.query<MemberRow>('SELECT * FROM members WHERE workspace_id = $1 AND removed_at IS NULL', [workspaceId]);
  return rows.filter((m) => m.role === 'owner' || m.status === 'active' || m.status === 'invited');
}

async function billedSeats(deps: AppDeps, workspaceId: string): Promise<number | null> {
  const rows = await deps.db.query<{ seats: number | null }>(
    `SELECT (payload->>'seats')::integer AS seats FROM billing_events WHERE workspace_id = $1 AND type = 'seats.changed' ORDER BY occurred_at DESC, event_id DESC LIMIT 1`,
    [workspaceId],
  );
  const newest = rows[0];
  return newest === undefined ? null : newest.seats;
}

async function requireWorkspaceWritableForInvite(deps: AppDeps, member: MemberRow): Promise<void> {
  const ws = await loadWorkspace(deps.db, member.workspace_id);
  if (ws === null) throw new ApiError('not_found', "That workspace doesn't exist.");
  if (ws.state === 'read_only' || ws.state === 'cancelled') {
    throw new ApiError('workspace_read_only', 'This workspace is read-only. Planning resumes when the subscription is active.');
  }
}

function cleanEmailField(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length === 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError('validation', 'Enter a valid email address.', { fields: { email: 'Enter a valid email address.' } });
  }
  return email;
}

// ---------------------------------------------------------------------------
// Invitations (no cookie needed)

export function invitationHandlers(deps: AppDeps) {
  const show = async (req: Request, res: Response): Promise<void> => {
    const token = String(req.params.token);
    const rows = await deps.db.query<{ workspace_id: string; email: string; invite_used: boolean; name: string }>(
      `SELECT m.workspace_id, m.email, m.invite_used, m.name FROM members m WHERE m.invite_token = $1 AND m.removed_at IS NULL`,
      [token],
    );
    const row = rows[0];
    if (row === undefined) throw new ApiError('not_found', "That invite doesn't exist.");
    if (row.invite_used) throw new ApiError('invitation_used', 'This invite has already been used.');
    const ws = await loadWorkspace(deps.db, row.workspace_id);
    sendJson(res, 200, { workspaceName: ws?.name ?? '', email: row.email });
  };

  const accept = async (req: Request, res: Response): Promise<void> => {
    const token = String(req.params.token);
    const body = isPlainObject(req.body) ? req.body : {};
    const name = cleanNameField(body.name);
    const password = typeof body.password === 'string' && body.password.length >= 10 ? body.password : (() => {
      throw new ApiError('validation', 'Passwords are at least 10 characters.', { fields: { password: 'Use at least 10 characters.' } });
    })();
    const timeZone = requireZoneField(body.timeZone);

    const result = await deps.db.withTransaction(async (client): Promise<MemberRow> => {
      const rows = await client.query<MemberRow>('SELECT * FROM members WHERE invite_token = $1 AND removed_at IS NULL FOR UPDATE', [token]);
      const member = rows.rows[0];
      if (member === undefined) throw new ApiError('not_found', "That invite doesn't exist.");
      if (member.invite_used) throw new ApiError('invitation_used', 'This invite has already been used.');
      await client.query(
        'UPDATE members SET name = $2, password_hash = $3, time_zone = $4, status = $5, invite_used = true, invite_token = NULL WHERE id = $1',
        [member.id, name, hashPassword(password), timeZone, 'active'],
      );
      const fresh = await client.query<MemberRow>('SELECT * FROM members WHERE id = $1', [member.id]);
      return fresh.rows[0] as MemberRow;
    });
    await setSessionCookie(deps, res, result.id);
    const ws = await loadWorkspace(deps.db, result.workspace_id);
    sendJson(res, 201, { member: toApiMember(result), workspace: toApiWorkspace(ws ?? { id: result.workspace_id, name: '', state: 'trialing', trial_ends_at: new Date().toISOString(), trial_notice_sent_at: null, created_at: new Date().toISOString() }) });
  };

  return { show, accept };
}

function cleanNameField(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 1 || name.length > 80) {
    throw new ApiError('validation', 'Enter between 1 and 80 characters.', { fields: { name: 'Enter between 1 and 80 characters.' } });
  }
  return name;
}

function requireZoneField(value: unknown): string {
  const zone = typeof value === 'string' ? value : '';
  const known = isKnownZoneValue(zone);
  if (!known) throw new ApiError('validation', 'Choose a time zone.', { fields: { timeZone: 'Choose a known IANA time zone.' } });
  return zone;
}

const isKnownZoneValue = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Billing callbacks

interface SeatsEventRow extends StateEventRow {
  readonly seats: number | null;
}

export function billingHandlers(deps: AppDeps) {
  const callbacks = async (req: Request, res: Response): Promise<void> => {
    const timestamp = req.header('X-Tidemark-Timestamp') ?? '';
    const signature = req.header('X-Tidemark-Signature') ?? '';
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const raw = rawBody === undefined ? '' : rawBody.toString('utf8');
    if (!/^\d+$/.test(timestamp)) throw new ApiError('stale_timestamp', 'That timestamp is stale.');
    const ts = Number(timestamp);
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > deps.config.timing.billingCallbackToleranceSeconds) {
      throw new ApiError('stale_timestamp', 'That timestamp is stale.');
    }
    const expected = `v1=${hmacSign(deps.config.killbill.apiSecret, `${timestamp}.${raw}`)}`;
    if (signature !== expected) throw new ApiError('invalid_signature', 'That signature is invalid.');

    const body = isPlainObject(req.body) ? req.body : {};
    const eventId = typeof body.eventId === 'string' && body.eventId.length > 0 ? body.eventId : (() => {
      throw new ApiError('validation', 'Send an event id.', { fields: { eventId: 'Send an event id.' } });
    })();
    const type = typeof body.type === 'string' ? body.type : (() => {
      throw new ApiError('validation', 'Send an event type.', { fields: { type: 'Send an event type.' } });
    })();
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : (() => {
      throw new ApiError('validation', 'Send a workspace id.', { fields: { workspaceId: 'Send a workspace id.' } });
    })();
    const occurredAt = typeof body.occurredAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(body.occurredAt) ? body.occurredAt : (() => {
      throw new ApiError('validation', 'Send occurredAt as a UTC instant.', { fields: { occurredAt: 'Send a UTC instant.' } });
    })();
    const seats = type === 'seats.changed' ? (typeof body.seats === 'number' && Number.isInteger(body.seats) && body.seats >= 0 ? body.seats : (() => {
      throw new ApiError('validation', 'Send a seat count.', { fields: { seats: 'Send a seat count.' } });
    })()) : undefined;

    const ws = await loadWorkspace(deps.db, workspaceId);
    if (ws === null) throw new ApiError('not_found', "That workspace doesn't exist.");

    const duplicate = await deps.db.query('SELECT event_id FROM billing_events WHERE event_id = $1', [eventId]);
    if (duplicate.length > 0) {
      sendJson(res, 200, { received: true, duplicate: true });
      return;
    }

    let applied = false;
    await deps.db.withAdvisoryTransaction(workspaceLock(workspaceId), async (client) => {
      await client.query(
        'INSERT INTO billing_events (event_id, workspace_id, type, occurred_at, seats) VALUES ($1, $2, $3, $4, $5)',
        [eventId, workspaceId, type, new Date(occurredAt), seats],
      );
      if (type === 'seats.changed') {
        // applied only when this is the newest seats.changed event.
        const all = await client.query<SeatsEventRow>('SELECT event_id, type, occurred_at, seats FROM billing_events WHERE workspace_id = $1', [workspaceId]);
        const newest = newestSeatsEvent(all.rows, (e) => e.seats);
        applied = newest?.event_id === eventId;
        return;
      }
      const all = await client.query<StateEventRow>('SELECT event_id, type, occurred_at FROM billing_events WHERE workspace_id = $1', [workspaceId]);
      applied = eventApplied(all.rows, new Date(ws.trial_ends_at), new Date(), eventId);
      const fresh = await loadWorkspaceRow(client, workspaceId);
      const state = replayState(all.rows, new Date(fresh.trial_ends_at), new Date());
      await client.query('UPDATE workspaces SET state = $1 WHERE id = $2', [state, workspaceId]);
    });
    sendJson(res, 200, { received: true, applied });
  };

  return { callbacks };
}

async function loadWorkspaceRow(client: { query: (text: string, params: readonly unknown[]) => Promise<{ rows: { trial_ends_at: string }[] }> }, workspaceId: string): Promise<{ trial_ends_at: string }> {
  const rows = await client.query('SELECT trial_ends_at FROM workspaces WHERE id = $1', [workspaceId]);
  const row = rows.rows[0];
  if (row === undefined) throw new ApiError('not_found', "That workspace doesn't exist.");
  return row;
}

// ---------------------------------------------------------------------------
// Operations (operator only)

export function opsHandlers(deps: AppDeps) {
  const workspaces = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requireRole(member, 'operator');
    const rows = await deps.db.query<{
      id: string; name: string; state: string; trial_ends_at: string;
    }>('SELECT id, name, state, trial_ends_at FROM workspaces ORDER BY created_at, id');
    const out = [];
    for (const ws of rows) {
      const seatRows = await deps.db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM members WHERE workspace_id = $1 AND removed_at IS NULL AND (role = 'owner' OR status = 'active' OR status = 'invited')`,
        [ws.id],
      );
      const billedRows = await deps.db.query<{ seats: number | null }>(
        `SELECT (payload->>'seats')::integer AS seats FROM billing_events WHERE workspace_id = $1 AND type = 'seats.changed' ORDER BY occurred_at DESC, event_id DESC LIMIT 1`,
        [ws.id],
      );
      const lastEvent = await deps.db.query<{ occurred_at: string }>(
        'SELECT occurred_at FROM billing_events WHERE workspace_id = $1 ORDER BY occurred_at DESC, event_id DESC LIMIT 1',
        [ws.id],
      );
      const outbox = await deps.db.query<{ pending: string; sent: string }>(
        `SELECT COUNT(*) FILTER (WHERE status <> 'done') AS pending, COUNT(*) FILTER (WHERE status = 'done') AS sent FROM outbox`,
      );
      const imports = await deps.db.query<{ batches: string; last_at: string | null }>(
        `SELECT COUNT(*) AS batches, MAX(created_at) AS last_at FROM import_batches WHERE member_id IN (SELECT id FROM members WHERE workspace_id = $1)`,
        [ws.id],
      );
      out.push({
        id: ws.id,
        name: ws.name,
        state: ws.state,
        trialEndsAt: isoInstant(new Date(ws.trial_ends_at)),
        activeSeats: Number(seatRows[0]?.count ?? '0'),
        billedSeats: billedRows[0]?.seats ?? null,
        lastBillingEventAt: lastEvent[0] === undefined ? null : isoInstant(new Date(lastEvent[0].occurred_at)),
        outbox: { pending: Number(outbox[0]?.pending ?? '0'), sent: Number(outbox[0]?.sent ?? '0') },
        imports: { batches: Number(imports[0]?.batches ?? '0'), lastAt: imports[0]?.last_at === null || imports[0]?.last_at === undefined ? null : isoInstant(new Date(imports[0].last_at)) },
      });
    }
    sendJson(res, 200, { workspaces: out });
  };

  return { workspaces };
}
