import type { PoolClient } from 'pg';
import { pool, withClient, withTransaction } from '../db/pool.js';
import { AppError, FIELD_MESSAGES } from '../errors.js';
import { newId, newLinkToken } from '../ids.js';
import { config } from '../config.js';
import { hasControlCharacters, distinctAddresses, readAddress } from '../domain/addresses.js';
import { parseFee } from '../domain/money.js';
import { isTemplateCode, templateFrames, type TemplateCode } from '../domain/templates.js';
import { isoDateIn, nextLocalMidnight, parseWallClock, resolveWallClock } from '../domain/schedule.js';
import { entitlementsFor, planLimitMessage } from '../domain/plans.js';
import {
  isLegalEdge,
  isWorkshopStatus,
  statusLabel,
  TERMINAL_STATUSES,
  type WorkshopStatus,
} from '../domain/states.js';
import { recordActivity } from '../activity.js';
import { readMirror, readUsage } from '../billing/mirror.js';
import type { FacilitatorActor } from '../auth/sessions.js';
import { bumpVersion, findWorkshop, lockWorkshop, writeSnapshot, type WorkshopRow } from '../board/repository.js';
import { publishSessionEnded } from '../board/events.js';
import { startRecap } from '../recap/pipeline.js';
import { deliverQueuedInvites } from '../services/delivery.js';

const CREATE_KEYS = ['title', 'template', 'scheduledStart', 'scheduledEnd', 'sponsorEmail', 'fee'];

export interface CreateWorkshopInput {
  readonly title: string;
  readonly template: TemplateCode;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly sponsorEmail: string;
  readonly fee: string;
}

interface ResolvedTime {
  readonly wallClock: string;
  readonly instantMs: number;
}

function readScheduledTime(
  raw: unknown,
  timeZone: string,
  field: string,
  fields: Record<string, string>,
): ResolvedTime | null {
  if (typeof raw !== 'string') {
    fields[field] = FIELD_MESSAGES.scheduleMalformed;
    return null;
  }
  const wall = parseWallClock(raw);
  if (wall === null) {
    fields[field] = FIELD_MESSAGES.scheduleMalformed;
    return null;
  }
  const resolved = resolveWallClock(wall, timeZone);
  if (resolved.kind === 'gap') {
    fields[field] = FIELD_MESSAGES.scheduleGap(timeZone);
    return null;
  }
  return { wallClock: raw, instantMs: resolved.instantMs };
}

/** Validates the create body, reporting every failing field. */
export function readCreateInput(body: Record<string, unknown>, timeZone: string): CreateWorkshopInput {
  const fields: Record<string, string> = {};

  const rawTitle = body.title;
  let title = '';
  if (typeof rawTitle !== 'string' || rawTitle.length < 1 || rawTitle.length > 120) {
    fields.title = FIELD_MESSAGES.titleLength;
  } else if (hasControlCharacters(rawTitle)) {
    fields.title = FIELD_MESSAGES.titleControl;
  } else {
    title = rawTitle;
  }

  const template = body.template;
  if (!isTemplateCode(template)) fields.template = FIELD_MESSAGES.template;

  const start = readScheduledTime(body.scheduledStart, timeZone, 'scheduledStart', fields);
  const end = readScheduledTime(body.scheduledEnd, timeZone, 'scheduledEnd', fields);
  // The end must be strictly after the start, comparing the resolved instants.
  if (start !== null && end !== null && end.instantMs <= start.instantMs) {
    fields.scheduledEnd = FIELD_MESSAGES.endNotAfterStart;
  }

  const sponsorEmail = readAddress(body.sponsorEmail);
  if (sponsorEmail === null) fields.sponsorEmail = FIELD_MESSAGES.sponsorEmail;

  let fee = '0.00';
  if (body.fee !== undefined && body.fee !== null) {
    // A JSON number as the fee also fails.
    const parsed = typeof body.fee === 'string' ? parseFee(body.fee) : null;
    if (parsed === null) fields.fee = FIELD_MESSAGES.fee;
    else fee = parsed;
  }

  for (const key of Object.keys(body)) {
    if (!CREATE_KEYS.includes(key)) fields[key] = FIELD_MESSAGES.unknownKey;
  }

  if (Object.keys(fields).length > 0) throw new AppError('validation', { fields });
  return {
    title,
    template: template as TemplateCode,
    scheduledStart: (start as ResolvedTime).wallClock,
    scheduledEnd: (end as ResolvedTime).wallClock,
    sponsorEmail: sponsorEmail as string,
    fee,
  };
}

/** Serialises an entitlement-bounded action per facilitator across instances. */
async function withFacilitatorLock<T>(facilitatorId: string, run: () => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [`facilitator:${facilitatorId}`]);
    try {
      return await run();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`facilitator:${facilitatorId}`]);
    }
  });
}

function resolvedInstant(wallClock: string, timeZone: string): number {
  const wall = parseWallClock(wallClock);
  const resolved = wall === null ? null : resolveWallClock(wall, timeZone);
  if (resolved === null || resolved.kind !== 'ok') {
    throw new AppError('validation', { fields: { scheduledStart: FIELD_MESSAGES.scheduleMalformed } });
  }
  return resolved.instantMs;
}

export async function createWorkshop(
  facilitator: FacilitatorActor,
  input: CreateWorkshopInput,
  nowMs: number,
): Promise<WorkshopRow> {
  return withFacilitatorLock(facilitator.facilitatorId, async () => {
    const mirror = await readMirror(pool, facilitator.facilitatorId);
    const cap = entitlementsFor(mirror.plan).activeWorkshops;
    const usage = await readUsage(pool, facilitator.facilitatorId, isoDateIn(nowMs, facilitator.timeZone));
    if (cap !== null && usage.activeWorkshops >= cap) {
      throw new AppError('plan_limit', {
        message: planLimitMessage(mirror.plan, cap, 'active workshops'),
        detail: { limit: cap, used: usage.activeWorkshops, plan: mirror.plan },
      });
    }

    const workshopId = newId('wk');
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO workshops (id, facilitator_id, title, template, status, scheduled_start, scheduled_end,
           start_at, end_at, sponsor_email, fee)
         VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10)`,
        [
          workshopId,
          facilitator.facilitatorId,
          input.title,
          input.template,
          input.scheduledStart,
          input.scheduledEnd,
          new Date(resolvedInstant(input.scheduledStart, facilitator.timeZone)),
          new Date(resolvedInstant(input.scheduledEnd, facilitator.timeZone)),
          input.sponsorEmail,
          input.fee,
        ],
      );
      // A workshop gets a join link when it is created.
      await client.query('INSERT INTO join_links (id, workshop_id, token) VALUES ($1,$2,$3)', [
        newId('jl'),
        workshopId,
        newLinkToken(),
      ]);
      for (const frame of templateFrames(input.template)) {
        await client.query(
          `INSERT INTO frames (id, workshop_id, title, x, y, width, height, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [newId('fr'), workshopId, frame.title, frame.x, frame.y, frame.width, frame.height, frame.position],
        );
      }
      await recordActivity(client, {
        facilitatorId: facilitator.facilitatorId,
        actor: 'facilitator',
        action: 'workshop.created',
        workshopId,
      });
    });

    const created = await findWorkshop(pool, workshopId);
    if (created === null) throw new AppError('not_found');
    return created;
  });
}

export interface TransitionSettings {
  readonly durationSeconds: number | null;
  readonly dotBudget: number | null;
}

function readInteger(
  body: Record<string, unknown>,
  key: string,
  low: number,
  high: number,
  fields: Record<string, string>,
): number | null {
  const value = body[key];
  if (!Number.isInteger(value) || (value as number) < low || (value as number) > high) {
    fields[key] = FIELD_MESSAGES.generic;
    return null;
  }
  return value as number;
}

export function readTransitionTarget(body: Record<string, unknown>): WorkshopStatus {
  const to = body.to;
  if (!isWorkshopStatus(to)) throw new AppError('validation', { fields: { to: FIELD_MESSAGES.generic } });
  return to;
}

/**
 * Read only once the edge is known to be legal, because a 409 state conflict comes before
 * 422 validation in the error order. The fields are ignored for other targets.
 */
function readTransitionSettings(to: WorkshopStatus, body: Record<string, unknown>): TransitionSettings {
  const fields: Record<string, string> = {};
  let durationSeconds: number | null = null;
  let dotBudget: number | null = null;
  if (to === 'silent_round') {
    durationSeconds = readInteger(body, 'durationSeconds', 5, 3600, fields);
  } else if (to === 'voting') {
    durationSeconds = readInteger(body, 'durationSeconds', 5, 3600, fields);
    dotBudget = readInteger(body, 'dotBudget', 1, 20, fields);
  }
  if (Object.keys(fields).length > 0) throw new AppError('validation', { fields });
  return { durationSeconds, dotBudget };
}

async function prepareRecap(client: PoolClient, workshop: WorkshopRow): Promise<void> {
  const mirror = await readMirror(client, workshop.facilitatorId);
  await client.query(
    `INSERT INTO recaps (workshop_id, status, reason, recap_token, scale)
     VALUES ($1, 'queued', NULL, $2, $3)
     ON CONFLICT (workshop_id) DO NOTHING`,
    [workshop.id, newLinkToken(), entitlementsFor(mirror.plan).recapScale],
  );
}

/**
 * Moves the workshop along one legal edge. The workshop row is locked, so when the same
 * transition arrives several times at once exactly one commits.
 */
export async function applyTransition(
  facilitator: FacilitatorActor,
  workshopId: string,
  to: WorkshopStatus,
  body: Record<string, unknown>,
  nowMs: number,
): Promise<WorkshopRow> {
  const updated = await withTransaction(async (client) => {
    const workshop = await lockWorkshop(client, workshopId);

    if (!isLegalEdge(workshop.status, to)) {
      // An illegal edge out of closed or archived answers workshop_closed, which comes first
      // in the 409 order; every other illegal edge answers illegal_transition.
      if (TERMINAL_STATUSES.has(workshop.status)) throw new AppError('workshop_closed');
      throw new AppError('illegal_transition', {
        message: `The workshop can't move from ${statusLabel(workshop.status)} to ${statusLabel(to)}`,
      });
    }
    const input = readTransitionSettings(to, body);

    if (to === 'silent_round') {
      const mirror = await readMirror(client, workshop.facilitatorId);
      const cap = entitlementsFor(mirror.plan).silentRoundsPerWorkshop;
      if (cap !== null && workshop.roundsUsed >= cap) {
        throw new AppError('plan_limit', {
          message: planLimitMessage(mirror.plan, cap, 'silent rounds per workshop'),
          detail: { limit: cap, used: workshop.roundsUsed, plan: mirror.plan },
        });
      }
      await client.query(
        `UPDATE workshops
            SET status = 'silent_round', round_number = round_number + 1,
                rounds_used = rounds_used + 1, round_ends_at = $2
          WHERE id = $1`,
        [workshopId, new Date(nowMs + (input.durationSeconds as number) * 1000)],
      );
    } else if (to === 'revealed') {
      // Entering revealed marks every unrevealed note revealed.
      await client.query('UPDATE notes SET revealed = true WHERE workshop_id = $1 AND revealed = false', [
        workshopId,
      ]);
      await client.query(`UPDATE workshops SET status = 'revealed', round_ends_at = NULL WHERE id = $1`, [
        workshopId,
      ]);
    } else if (to === 'voting') {
      await client.query(
        `UPDATE workshops SET status = 'voting', dot_budget = $2, voting_ends_at = $3 WHERE id = $1`,
        [workshopId, input.dotBudget, new Date(nowMs + (input.durationSeconds as number) * 1000)],
      );
    } else if (to === 'closed') {
      await client.query(
        `UPDATE workshops SET status = 'closed', round_ends_at = NULL, voting_ends_at = NULL WHERE id = $1`,
        [workshopId],
      );
    } else {
      await client.query('UPDATE workshops SET status = $2 WHERE id = $1', [workshopId, to]);
    }

    const version = await bumpVersion(client, workshopId);
    if (to === 'closed') {
      // Closing freezes the board, writes a close version and starts the recap.
      await writeSnapshot(client, workshopId, version, 'close');
      await prepareRecap(client, workshop);
    }
    await recordActivity(client, {
      facilitatorId: facilitator.facilitatorId,
      actor: 'facilitator',
      action: 'workshop.transitioned',
      workshopId,
    });
    const after = await findWorkshop(client, workshopId);
    if (after === null) throw new AppError('not_found');
    return after;
  });

  // The first recap attempt starts at once on the instance that accepted the close.
  if (to === 'closed') void startRecap(workshopId);
  return updated;
}

async function revokeActiveLink(client: PoolClient, workshopId: string): Promise<string[]> {
  const revoked = await client.query<{ id: string }>(
    `UPDATE join_links SET revoked_at = now() WHERE workshop_id = $1 AND revoked_at IS NULL RETURNING id`,
    [workshopId],
  );
  const linkIds = revoked.rows.map((row) => row.id);
  if (linkIds.length === 0) return [];
  const participants = await client.query<{ id: string }>(
    'SELECT id FROM participants WHERE join_link_id = ANY($1::text[])',
    [linkIds],
  );
  return participants.rows.map((row) => row.id);
}

/** Rotating creates a new link and revokes the old one, ending every session joined through it. */
export async function rotateJoinLink(facilitator: FacilitatorActor, workshopId: string): Promise<string> {
  const token = newLinkToken();
  await withTransaction(async (client) => {
    await lockWorkshop(client, workshopId);
    const ended = await revokeActiveLink(client, workshopId);
    await client.query('INSERT INTO join_links (id, workshop_id, token) VALUES ($1,$2,$3)', [
      newId('jl'),
      workshopId,
      token,
    ]);
    await bumpVersion(client, workshopId);
    await publishSessionEnded(client, { workshopId, participantIds: ended });
    await recordActivity(client, {
      facilitatorId: facilitator.facilitatorId,
      actor: 'facilitator',
      action: 'join_link.rotated',
      workshopId,
    });
  });
  return `${config.publicBaseUrl}/join/${token}`;
}

/** Turning the link off revokes it and leaves none active. */
export async function turnOffJoinLink(facilitator: FacilitatorActor, workshopId: string): Promise<void> {
  await withTransaction(async (client) => {
    await lockWorkshop(client, workshopId);
    const ended = await revokeActiveLink(client, workshopId);
    await bumpVersion(client, workshopId);
    await publishSessionEnded(client, { workshopId, participantIds: ended });
    await recordActivity(client, {
      facilitatorId: facilitator.facilitatorId,
      actor: 'facilitator',
      action: 'join_link.turned_off',
      workshopId,
    });
  });
}

export interface InviteOutcome {
  readonly email: string;
  readonly status: 'sent' | 'queued';
}

/**
 * Reads a batch of client addresses. The whole batch is rejected if any entry is not a bare
 * address, and addresses differing only in letter case are one address.
 */
export function readInviteBatch(body: Record<string, unknown>): string[] {
  const raw = body.emails;
  if (!Array.isArray(raw)) throw new AppError('validation', { fields: { emails: FIELD_MESSAGES.emailEntry } });
  if (raw.length < 1 || raw.length > 30) {
    throw new AppError('validation', { fields: { emails: FIELD_MESSAGES.emailBatchSize } });
  }
  const addresses: string[] = [];
  for (const entry of raw) {
    const address = readAddress(entry);
    if (address === null) throw new AppError('validation', { fields: { emails: FIELD_MESSAGES.emailEntry } });
    addresses.push(address);
  }
  return distinctAddresses(addresses);
}

export async function addInvites(
  facilitator: FacilitatorActor,
  workshop: WorkshopRow,
  addresses: readonly string[],
  nowMs: number,
): Promise<InviteOutcome[]> {
  const localDay = isoDateIn(nowMs, facilitator.timeZone);
  const outcome = await withFacilitatorLock(facilitator.facilitatorId, async () => {
    const active = await pool.query(
      'SELECT 1 FROM join_links WHERE workshop_id = $1 AND revoked_at IS NULL',
      [workshop.id],
    );
    if (active.rowCount === 0) throw new AppError('no_join_link');

    const mirror = await readMirror(pool, facilitator.facilitatorId);
    const allowance = entitlementsFor(mirror.plan).invitesPerDay;
    const usage = await readUsage(pool, facilitator.facilitatorId, localDay);
    // A batch that does not fit is rejected whole.
    if (allowance !== null && usage.invitesToday + addresses.length > allowance) {
      const waitSeconds = Math.ceil((nextLocalMidnight(nowMs, facilitator.timeZone) - nowMs) / 1000);
      throw new AppError('quota_exceeded', {
        detail: { limit: allowance, used: usage.invitesToday, plan: mirror.plan },
        headers: { 'Retry-After': String(waitSeconds) },
      });
    }

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO invite_quota (facilitator_id, local_day, used) VALUES ($1,$2,$3)
         ON CONFLICT (facilitator_id, local_day) DO UPDATE SET used = invite_quota.used + $3`,
        [facilitator.facilitatorId, localDay, addresses.length],
      );
      for (const email of addresses) {
        await client.query(`INSERT INTO invites (id, workshop_id, email, status) VALUES ($1,$2,$3,'queued')`, [
          newId('iv'),
          workshop.id,
          email,
        ]);
      }
      await bumpVersion(client, workshop.id);
      await recordActivity(client, {
        facilitatorId: facilitator.facilitatorId,
        actor: 'facilitator',
        action: 'invites.sent',
        workshopId: workshop.id,
      });
    });
    return true;
  });
  void outcome;

  // Try delivery at once; anything mail cannot take stays queued for the worker.
  await deliverQueuedInvites(workshop.id);

  const statuses = await pool.query<{ email: string; status: 'sent' | 'queued' }>(
    `SELECT DISTINCT ON (email) email, status FROM invites
      WHERE workshop_id = $1 AND email = ANY($2::text[])
      ORDER BY email, created_seq DESC`,
    [workshop.id, [...addresses]],
  );
  const latest = new Map(statuses.rows.map((row) => [row.email, row.status]));
  return addresses.map((email) => ({ email, status: latest.get(email) ?? 'queued' }));
}
