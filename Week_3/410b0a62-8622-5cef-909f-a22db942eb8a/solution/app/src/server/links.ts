import type { LinkRow } from '../shared/types.js';
import { newId, type User } from './access.js';
import { pool } from './db.js';
import { config } from './config.js';
import { conflict, FieldErrors, notFound } from './errors.js';
import { publishChange, publishNotice } from './live.js';
import { MESSAGES } from './validation.js';

interface Row {
  id: string;
  coach_id: string;
  coach_name: string;
  athlete_id: string;
  athlete_name: string;
  status: string;
  expires_at: Date;
}

const SELECT = `SELECT l.id, l.coach_id, c.name AS coach_name, l.athlete_id, a.name AS athlete_name, l.expires_at,
    CASE WHEN l.status = 'requested' AND l.expires_at <= now() THEN 'expired' ELSE l.status END AS status
  FROM links l JOIN users c ON c.id = l.coach_id JOIN users a ON a.id = l.athlete_id`;

const linkOf = (row: Row): LinkRow => ({
  id: row.id,
  coach_id: row.coach_id,
  coach_name: row.coach_name,
  athlete_id: row.athlete_id,
  athlete_name: row.athlete_name,
  status: row.status as LinkRow['status'],
  expires_at: row.expires_at.toISOString()
});

export async function listLinks(user: User): Promise<LinkRow[]> {
  const { rows } = await pool.query<Row>(`${SELECT} WHERE ${user.role === 'coach' ? 'l.coach_id' : 'l.athlete_id'} = $1 ORDER BY l.created_at, l.id`, [user.id]);
  return rows.map(linkOf);
}

async function linkById(id: string): Promise<LinkRow | null> {
  const { rows } = await pool.query<Row>(`${SELECT} WHERE l.id = $1`, [id]);
  return rows[0] ? linkOf(rows[0]) : null;
}

async function currentLink(id: string): Promise<LinkRow> {
  const link = await linkById(id);
  if (!link) throw notFound();
  return link;
}

/** A coach code starts a request that expires LINK_REQUEST_TTL_HOURS later. */
export async function requestLink(athlete: User, body: { coach_code?: unknown }): Promise<LinkRow> {
  const errors = new FieldErrors();
  const code = typeof body.coach_code === 'string' ? body.coach_code.trim().toUpperCase() : '';
  const coach = (await pool.query<{ id: string }>("SELECT id FROM users WHERE role = 'coach' AND coach_code = $1", [code])).rows[0];
  errors.add('coach_code', coach ? null : MESSAGES.coachCode);
  errors.throwIfAny();
  const coachId = (coach as { id: string }).id;

  await pool.query("UPDATE links SET status = 'expired' WHERE coach_id = $1 AND athlete_id = $2 AND status = 'requested' AND expires_at <= now()", [coachId, athlete.id]);
  const open = (await pool.query<{ status: string }>("SELECT status FROM links WHERE coach_id = $1 AND athlete_id = $2 AND status IN ('requested', 'accepted')", [coachId, athlete.id])).rows[0];
  if (open?.status === 'accepted') throw conflict('already_linked');
  if (open) throw conflict('already_requested');
  const id = newId();
  try {
    await pool.query("INSERT INTO links (id, coach_id, athlete_id, status, expires_at) VALUES ($1, $2, $3, 'requested', now() + make_interval(secs => $4))", [
      id,
      coachId,
      athlete.id,
      config.linkRequestTtlHours * 3600
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw conflict('already_requested');
    throw error;
  }
  publishChange([athlete.id, coachId], athlete.id, ['links']);
  publishNotice([coachId], `${athlete.name} sent a link request.`);
  return currentLink(id);
}

/** Accepts or declines a request; of two simultaneous calls exactly one succeeds. */
export async function answerRequest(coach: User, id: string, answer: 'accepted' | 'declined'): Promise<LinkRow> {
  const link = await linkById(id);
  if (!link || link.coach_id !== coach.id) throw notFound();
  const { rowCount } = await pool.query("UPDATE links SET status = $2 WHERE id = $1 AND status = 'requested' AND expires_at > now()", [id, answer]);
  if (rowCount !== 1) throw conflict((await linkById(id))?.status === 'expired' ? 'expired' : 'not_pending');
  publishChange([link.athlete_id, coach.id], link.athlete_id, ['links']);
  return currentLink(id);
}

/** Either party ends an accepted link; the coach's access ends with their next request. */
export async function removeLink(user: User, id: string): Promise<void> {
  const link = await linkById(id);
  if (!link || (link.coach_id !== user.id && link.athlete_id !== user.id)) throw notFound();
  const { rowCount } = await pool.query("UPDATE links SET status = 'removed' WHERE id = $1 AND status = 'accepted'", [id]);
  if (rowCount !== 1) throw conflict('not_pending');
  publishChange([link.athlete_id, link.coach_id], link.athlete_id, ['links']);
}
