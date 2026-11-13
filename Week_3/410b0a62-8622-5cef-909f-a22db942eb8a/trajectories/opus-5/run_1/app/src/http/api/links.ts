import { config, JSON_BODY_MAX_BYTES } from '../../config.js';
import { pool } from '../../db/pool.js';
import {
  findLink,
  findUserByCoachCode,
  insertLink,
  linksBetween,
  linksForUser,
  setLinkStatus,
  type LinkRow,
} from '../../db/users.js';
import {
  effectiveStatus,
  expiryFrom,
  LINK_CONFLICTS,
  pendingDecisionConflict,
  requestConflict,
  type LinkConflict,
} from '../../domain/links.js';
import type { CoachLink } from '../../domain/types.js';
import { MESSAGES } from '../../domain/validation.js';
import { publishChange, publishNotice } from '../../services/live.js';
import { readJsonBody } from '../body.js';
import { requireAthlete, requireCoach, requireUser, type RequestContext } from '../context.js';
import { ApiError, notFound, ValidationError } from '../errors.js';
import { sendJson, sendNoContent } from '../respond.js';

function conflict(code: LinkConflict): ApiError {
  return new ApiError(409, code, LINK_CONFLICTS[code]);
}

function linkPayload(row: LinkRow, now: Date): CoachLink {
  return {
    id: row.id,
    coach_id: row.coach_id,
    coach_name: row.coach_name,
    athlete_id: row.athlete_id,
    athlete_name: row.athlete_name,
    status: effectiveStatus(row.status, row.expires_at, now),
    expires_at: row.expires_at.toISOString(),
  };
}

export async function listLinks(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const now = new Date();
  const rows = await linksForUser(pool, user.id);
  sendJson(ctx.res, 200, { links: rows.map((row) => linkPayload(row, now)) });
}

export async function createLink(ctx: RequestContext): Promise<void> {
  const athlete = requireAthlete(ctx);
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  const code = typeof body.coach_code === 'string' ? body.coach_code.trim().toUpperCase() : '';
  const coach = code === '' ? null : await findUserByCoachCode(pool, code);
  if (!coach) throw new ValidationError({ coach_code: MESSAGES.coachCode });

  const now = new Date();
  const existing = await linksBetween(pool, coach.id, athlete.id);
  const statuses = existing.map((row) => effectiveStatus(row.status, row.expires_at, now));
  const blocked = requestConflict(statuses);
  if (blocked) throw conflict(blocked);

  const row = await insertLink(pool, {
    coachId: coach.id,
    athleteId: athlete.id,
    status: 'requested',
    expiresAt: expiryFrom(now, config.linkRequestTtlHours),
  });
  await publishChange(athlete.id, 'links', { alsoNotify: [coach.id] });
  publishNotice([coach.id], `${athlete.name} sent a link request.`);
  const link = linkPayload(row, now);
  sendJson(ctx.res, 201, {
    link: {
      id: link.id,
      coach_id: link.coach_id,
      coach_name: link.coach_name,
      status: link.status,
      expires_at: link.expires_at,
    },
  });
}

async function decide(ctx: RequestContext, decision: 'accepted' | 'declined'): Promise<void> {
  const coach = requireCoach(ctx);
  const row = await findLink(pool, ctx.params.id as string);
  if (!row || row.coach_id !== coach.id) throw notFound();
  const now = new Date();
  const status = effectiveStatus(row.status, row.expires_at, now);
  const blocked = pendingDecisionConflict(status);
  if (blocked) throw conflict(blocked);
  if (!(await setLinkStatus(pool, row.id, 'requested', decision))) {
    throw conflict('not_pending');
  }
  const updated = (await findLink(pool, row.id)) as LinkRow;
  await publishChange(row.athlete_id, 'links', { alsoNotify: [coach.id] });
  sendJson(ctx.res, 200, { link: linkPayload(updated, now) });
}

export function acceptLink(ctx: RequestContext): Promise<void> {
  return decide(ctx, 'accepted');
}

export function declineLink(ctx: RequestContext): Promise<void> {
  return decide(ctx, 'declined');
}

export async function removeLink(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const row = await findLink(pool, ctx.params.id as string);
  if (!row || (row.coach_id !== user.id && row.athlete_id !== user.id)) throw notFound();
  if (row.status !== 'accepted') throw conflict('not_pending');
  if (!(await setLinkStatus(pool, row.id, 'accepted', 'removed'))) throw conflict('not_pending');
  await publishChange(row.athlete_id, 'links', { alsoNotify: [row.coach_id] });
  sendNoContent(ctx.res);
}
