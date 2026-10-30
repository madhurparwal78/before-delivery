import { config } from '../config.js';
import { many, one, type Queryable } from '../db/pool.js';
import { newId } from '../lib/codes.js';
import { addSeconds, toUtcIso } from '../lib/time.js';
import { queueMail } from '../services/mail.js';
import { liveHold } from './liveness.js';
import { formatDeadline } from './format.js';
import { seatsRemaining } from './programme.js';

export interface HoldRow {
  id: string;
  session_id: string;
  quantity: number;
  expires_at: Date;
  status: 'active' | 'expired' | 'released' | 'converted';
}

export interface SerialisedHold {
  id: string;
  session_id: string;
  quantity: number;
  expires_at: string;
  status: HoldRow['status'];
}

export function serialiseHold(row: HoldRow): SerialisedHold {
  return {
    id: row.id,
    session_id: row.session_id,
    quantity: row.quantity,
    expires_at: toUtcIso(row.expires_at),
    status: row.status,
  };
}

export async function activeHolds(db: Queryable, userId: string): Promise<HoldRow[]> {
  return many<HoldRow>(
    db,
    `SELECT h.id, h.session_id, h.quantity, h.expires_at, h.status FROM holds h
     WHERE h.user_id = $1 AND ${liveHold('h')} ORDER BY h.created_at`,
    [userId],
  );
}

export async function loadOwnHold(
  db: Queryable,
  id: string,
  userId: string,
): Promise<(HoldRow & { live: boolean }) | null> {
  return one<HoldRow & { live: boolean }>(
    db,
    `SELECT h.id, h.session_id, h.quantity, h.expires_at, h.status, (${liveHold('h')}) AS live
     FROM holds h WHERE h.id = $1 AND h.user_id = $2`,
    [id, userId],
  );
}

export async function createHold(
  db: Queryable,
  userId: string,
  sessionId: string,
  quantity: number,
): Promise<HoldRow> {
  const id = newId();
  const expiresAt = addSeconds(new Date(), config.times.holdSeconds);
  const row = await one<HoldRow>(
    db,
    `INSERT INTO holds (id, user_id, session_id, quantity, expires_at, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     RETURNING id, session_id, quantity, expires_at, status`,
    [id, userId, sessionId, quantity, expiresAt],
  );
  if (row === null) throw new Error('hold insert failed');
  return row;
}

export async function releaseHold(db: Queryable, holdId: string): Promise<void> {
  const row = await one<{ session_id: string; quantity: number }>(
    db,
    `UPDATE holds SET status = 'released' WHERE id = $1 AND status = 'active'
     RETURNING session_id, quantity`,
    [holdId],
  );
  if (row === null) return;
  await offerFreedSeats(db, row.session_id, row.quantity);
}

export async function convertHolds(db: Queryable, holdIds: readonly string[]): Promise<void> {
  if (holdIds.length === 0) return;
  await db.query(`UPDATE holds SET status = 'converted' WHERE id = ANY($1::uuid[])`, [
    [...holdIds],
  ]);
}

export interface WaitlistRow {
  id: string;
  session_id: string;
  title: string;
  status: 'waiting' | 'offered' | 'claimed' | 'lapsed' | 'closed';
  offer_expires_at: Date | null;
  position: number;
}

export async function waitlistFor(db: Queryable, userId: string): Promise<WaitlistRow[]> {
  return many<WaitlistRow>(
    db,
    `SELECT w.id, w.session_id, s.title, w.status, w.offer_expires_at,
            (SELECT COUNT(*) FROM waitlist_entries o
              WHERE o.session_id = w.session_id AND o.seq < w.seq
                AND o.status IN ('waiting', 'offered'))::int + 1 AS position
     FROM waitlist_entries w
     JOIN programme_sessions s ON s.id = w.session_id
     WHERE w.user_id = $1 ORDER BY w.seq`,
    [userId],
  );
}

export async function waitlistEntry(db: Queryable, id: string): Promise<WaitlistRow | null> {
  return one<WaitlistRow>(
    db,
    `SELECT w.id, w.session_id, s.title, w.status, w.offer_expires_at,
            (SELECT COUNT(*) FROM waitlist_entries o
              WHERE o.session_id = w.session_id AND o.seq < w.seq
                AND o.status IN ('waiting', 'offered'))::int + 1 AS position
     FROM waitlist_entries w
     JOIN programme_sessions s ON s.id = w.session_id
     WHERE w.id = $1`,
    [id],
  );
}

export async function joinWaitlist(
  db: Queryable,
  userId: string,
  sessionId: string,
): Promise<WaitlistRow> {
  const id = newId();
  await db.query(
    `INSERT INTO waitlist_entries (id, user_id, session_id, status) VALUES ($1, $2, $3, 'waiting')`,
    [id, userId, sessionId],
  );
  const row = await waitlistEntry(db, id);
  if (row === null) throw new Error('waitlist insert failed');
  return row;
}

export async function alreadyWaiting(
  db: Queryable,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const row = await one<{ id: string }>(
    db,
    `SELECT id FROM waitlist_entries
     WHERE user_id = $1 AND session_id = $2 AND status IN ('waiting', 'offered')`,
    [userId, sessionId],
  );
  return row !== null;
}

/**
 * A freed seat goes to the earliest waiting visitor as a mailed offer; with no one waiting it
 * returns to the pool.
 */
export async function offerFreedSeats(
  db: Queryable,
  sessionId: string,
  freedSeats: number,
): Promise<number> {
  if (freedSeats <= 0) return 0;
  const available = (await seatsRemaining(db, sessionId)) ?? 0;
  const offers = Math.min(freedSeats, available);
  if (offers <= 0) return 0;

  const waiting = await many<{ id: string; user_id: string }>(
    db,
    `SELECT id, user_id FROM waitlist_entries
     WHERE session_id = $1 AND status = 'waiting' ORDER BY seq LIMIT $2`,
    [sessionId, offers],
  );

  for (const entry of waiting) {
    await makeOffer(db, entry.id, entry.user_id, sessionId);
  }
  return waiting.length;
}

export async function makeOffer(
  db: Queryable,
  entryId: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  const expiresAt = addSeconds(new Date(), config.times.waitlistClaimSeconds);
  await db.query(
    `UPDATE waitlist_entries SET status = 'offered', offer_expires_at = $2, offered_at = now()
     WHERE id = $1 AND status = 'waiting'`,
    [entryId, expiresAt],
  );
  const details = await one<{ email: string; title: string }>(
    db,
    `SELECT u.email, s.title FROM users u, programme_sessions s WHERE u.id = $1 AND s.id = $2`,
    [userId, sessionId],
  );
  if (details === null) return;
  await queueMail(db, {
    eventKey: `waitlist-offer:${entryId}`,
    to: details.email,
    subject: `A seat is free: ${details.title}`,
    body: [
      `A seat has come free for ${details.title}.`,
      '',
      `Claim it by ${formatDeadline(expiresAt)}.`,
      '',
      'Open My tickets to claim your seat: /tickets',
    ].join('\n'),
  });
}
