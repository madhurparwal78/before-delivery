/**
 * The seat engine. Every booking decision lives here: the overlap test, the
 * refusal order, promotion and its cascade, hold settling, and seats left.
 *
 * All guarantees are held by PostgreSQL: a transaction takes the session's row
 * lock, settling is decided by comparing against the database clock, and
 * promotion runs in the same transaction as the change that freed the seat.
 */

import type { Pool } from './db/pool.js';

export type RefusalCode =
  | 'not_reservable'
  | 'already_reserved'
  | 'time_conflict'
  | 'session_full'
  | 'already_waitlisted'
  | 'seats_available'
  | 'not_waitlisted'
  | 'no_reservation'
  | 'no_hold'
  | 'hold_expired'
  | 'below_reserved'
  | 'request_in_progress'
  | 'idempotency_key_reused';

export class Refused extends Error {
  constructor(
    public code: RefusalCode,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface Seats {
  capacity: number;
  reserved: number;
  held: number;
  left: number;
}

export interface SessionRow {
  id: string;
  capacity: number | null;
  start_instant: Date;
  end_instant: Date;
}

interface Client {
  query: Pool['query'];
  release(): void;
}

type DbClient = Client & { query: Pool['query'] };

/**
 * Two sessions overlap when each starts before the other ends, compared as UTC
 * instants. Touching times do not overlap.
 */
export function overlaps(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Lock the given sessions in id order, so transactions never deadlock. */
export async function lockSessions(db: DbClient, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)].sort();
  for (const id of unique) {
    await db.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [id]);
  }
}

/** The session row, after its lock has been taken. */
export async function getSession(db: DbClient, id: string): Promise<SessionRow | null> {
  const res = await db.query(
    'SELECT id, capacity, start_instant, end_instant FROM sessions WHERE id = $1',
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    capacity: row.capacity === null ? null : (row.capacity as number),
    start_instant: new Date(row.start_instant),
    end_instant: new Date(row.end_instant),
  };
}

/** Seats computed from stored rows: capacity minus reservations minus live holds. */
export async function readSeats(db: DbClient, session: SessionRow): Promise<Seats | null> {
  if (session.capacity === null) return null;
  const res = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM reservations WHERE session_id = $1) AS reserved,
       (SELECT COUNT(*) FROM holds WHERE session_id = $1 AND ended_at IS NULL) AS held`,
    [session.id],
  );
  const reserved = Number(res.rows[0]!.reserved);
  const held = Number(res.rows[0]!.held);
  return {
    capacity: session.capacity,
    reserved,
    held,
    left: session.capacity - reserved - held,
  };
}

/** The caller's reservation or live hold on a session, if any. */
export async function myStake(
  db: DbClient,
  sessionId: string,
  accountId: number,
): Promise<{
  reserved: boolean;
  liveHold: { id: number; heldUntil: Date } | null;
  latestHoldEndedAsExpired: boolean;
}> {
  const res = await db.query(
    `SELECT
       EXISTS (SELECT 1 FROM reservations WHERE session_id = $1 AND account_id = $2) AS reserved,
       (SELECT id FROM holds WHERE session_id = $1 AND account_id = $2 AND ended_at IS NULL
         ORDER BY id DESC LIMIT 1) AS live_hold_id,
       (SELECT held_until FROM holds WHERE session_id = $1 AND account_id = $2 AND ended_at IS NULL
         ORDER BY id DESC LIMIT 1) AS live_hold_until,
       (SELECT end_kind FROM holds WHERE session_id = $1 AND account_id = $2 AND ended_at IS NOT NULL
         ORDER BY id DESC LIMIT 1) AS last_ended`,
    [sessionId, accountId],
  );
  const row = res.rows[0]!;
  return {
    reserved: row.reserved === true,
    liveHold:
      row.live_hold_id === null
        ? null
        : { id: Number(row.live_hold_id), heldUntil: new Date(row.live_hold_until) },
    latestHoldEndedAsExpired: row.last_ended === 'expired',
  };
}

/** The caller's live reservations and holds that overlap the given times. */
export async function overlappingStakes(
  db: DbClient,
  accountId: number,
  start: Date,
  end: Date,
): Promise<Array<{ sessionId: string; kind: 'reservation' | 'hold' }>> {
  const res = await db.query(
    `SELECT s.id AS session_id, 'reservation'::text AS kind
       FROM reservations r JOIN sessions s ON s.id = r.session_id
      WHERE r.account_id = $1 AND s.start_instant < $3 AND s.end_instant > $2
     UNION ALL
    SELECT s.id AS session_id, 'hold'::text AS kind
       FROM holds h JOIN sessions s ON s.id = h.session_id
      WHERE h.account_id = $1 AND h.ended_at IS NULL
        AND s.start_instant < $3 AND s.end_instant > $2`,
    [accountId, start, end],
  );
  return res.rows.map((r) => ({
    sessionId: r.session_id as string,
    kind: r.kind as 'reservation' | 'hold',
  }));
}

/**
 * Settle every ended hold on the given session. Each ended hold is settled
 * exactly once, whichever request gets there first, and the freed seat is
 * passed on in the same transaction.
 */
export async function settleSession(db: DbClient, sessionId: string, holdSeconds: number): Promise<void> {
  const ended = await db.query(
    `SELECT id, account_id, held_until FROM holds
      WHERE session_id = $1 AND ended_at IS NULL AND held_until <= now()
      ORDER BY held_until, id`,
    [sessionId],
  );
  for (const row of ended.rows) {
    // Each ended hold is settled exactly once, whichever instance gets there
    // first: the claim is conditional, and a lost claim settles nothing.
    const settled = await db.query(
      `UPDATE holds SET ended_at = $2, end_kind = 'expired'
        WHERE id = $1 AND ended_at IS NULL RETURNING id`,
      [row.id, row.held_until],
    );
    if (settled.rows.length === 0) continue;
    await db.query(
      `INSERT INTO seat_events (session_id, account_id, kind, at) VALUES ($1, $2, 'expired', $3)`,
      [sessionId, row.account_id, row.held_until],
    );
    // Pass the freed seat on, and cascade for the former owner.
    await promoteWaiters(db, sessionId, holdSeconds);
    await cascadeFor(db, row.account_id, sessionId, holdSeconds);
  }
}

/** Promote eligible waiters into every open seat of a session, oldest first. */
async function promoteWaiters(db: DbClient, sessionId: string, holdSeconds: number): Promise<void> {
  const seats = await liveSeatCounts(db, sessionId);
  if (seats.capacity === null) return;
  let open = seats.capacity - seats.reserved - seats.held;
  if (open <= 0) return;
  const waiting = await db.query(
    `SELECT w.id, w.account_id FROM waitlist_entries w
      WHERE w.session_id = $1 ORDER BY w.created_at, w.id`,
    [sessionId],
  );
  const session = await sessionTimes(db, sessionId);
  for (const row of waiting.rows) {
    if (open <= 0) return;
    const eligible = await isEligible(db, row.account_id, session);
    if (!eligible) continue;
    await db.query('DELETE FROM waitlist_entries WHERE id = $1', [row.id]);
    await createHold(db, sessionId, row.account_id, holdSeconds);
    open--;
  }
}

/**
 * Give the former owner of a freed seat holds on the other sessions they wait
 * for that have an open seat, earliest start first, never two that overlap.
 */
async function cascadeFor(
  db: DbClient,
  accountId: number,
  justHandledSession: string,
  holdSeconds: number,
): Promise<void> {
  const waiting = await db.query(
    `SELECT w.session_id, s.start_instant, s.id
       FROM waitlist_entries w JOIN sessions s ON s.id = w.session_id
      WHERE w.account_id = $1 AND w.session_id <> $2`,
    [accountId, justHandledSession],
  );
  // Earliest start instant first, then lower session id.
  const ordered = waiting.rows
    .map((r) => ({ sessionId: r.session_id as string, start: new Date(r.start_instant) }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.sessionId < b.sessionId ? -1 : 1));
  for (const target of ordered) {
    const seats = await liveSeatCounts(db, target.sessionId);
    if (seats.capacity === null) continue;
    if (seats.reserved + seats.held >= seats.capacity) continue;
    const session = await sessionTimes(db, target.sessionId);
    // Eligibility counts holds just created earlier in this transaction.
    if (!(await isEligible(db, accountId, session))) continue;
    await db.query('DELETE FROM waitlist_entries WHERE session_id = $1 AND account_id = $2', [
      target.sessionId,
      accountId,
    ]);
    await createHold(db, target.sessionId, accountId, holdSeconds);
  }
}

/** May this account take a seat in this session: no overlapping reservation or hold. */
async function isEligible(
  db: DbClient,
  accountId: number,
  session: { id: string; start: Date; end: Date },
): Promise<boolean> {
  const res = await db.query(
    `SELECT 1 FROM reservations r JOIN sessions s ON s.id = r.session_id
      WHERE r.account_id = $1 AND s.start_instant < $3 AND s.end_instant > $2
      LIMIT 1`,
    [accountId, session.start, session.end],
  );
  if (res.rows.length > 0) return false;
  const holds = await db.query(
    `SELECT 1 FROM holds h JOIN sessions s ON s.id = h.session_id
      WHERE h.account_id = $1 AND h.ended_at IS NULL
        AND s.start_instant < $3 AND s.end_instant > $2
      LIMIT 1`,
    [accountId, session.start, session.end],
  );
  return holds.rows.length === 0;
}

/** A hold's start and end both come from PostgreSQL's clock. */
async function createHold(
  db: DbClient,
  sessionId: string,
  accountId: number,
  holdSeconds: number,
): Promise<void> {
  await db.query(
    `INSERT INTO holds (session_id, account_id, held_from, held_until)
     VALUES ($1, $2, now(), now() + make_interval(secs => $3))`,
    [sessionId, accountId, holdSeconds],
  );
  await db.query(
    `INSERT INTO seat_events (session_id, account_id, kind, at) VALUES ($1, $2, 'promoted', now())`,
    [sessionId, accountId],
  );
}

async function sessionTimes(
  db: DbClient,
  sessionId: string,
): Promise<{ id: string; start: Date; end: Date }> {
  const res = await db.query(
    'SELECT id, start_instant, end_instant FROM sessions WHERE id = $1',
    [sessionId],
  );
  const row = res.rows[0]!;
  return { id: row.id, start: new Date(row.start_instant), end: new Date(row.end_instant) };
}

async function liveSeatCounts(
  db: DbClient,
  sessionId: string,
): Promise<{ capacity: number | null; reserved: number; held: number }> {
  const res = await db.query(
    `SELECT s.capacity,
       (SELECT COUNT(*) FROM reservations r WHERE r.session_id = s.id) AS reserved,
       (SELECT COUNT(*) FROM holds h WHERE h.session_id = s.id AND h.ended_at IS NULL) AS held
      FROM sessions s WHERE s.id = $1`,
    [sessionId],
  );
  const row = res.rows[0]!;
  return {
    capacity: row.capacity === null ? null : Number(row.capacity),
    reserved: Number(row.reserved),
    held: Number(row.held),
  };
}

/**
 * Every session with a hold past its `held_until`. Read endpoints settle each
 * of these before answering, so a hold ends on the database clock whether or
 * not any process ran in between.
 */
export async function sessionsWithEndedHolds(db: DbClient): Promise<string[]> {
  const res = await db.query(
    `SELECT DISTINCT session_id FROM holds WHERE ended_at IS NULL AND held_until <= now()`,
  );
  return res.rows.map((r) => r.session_id as string);
}

/** Lock the sessions in id order, settle their ended holds, pass the seats on. */
export async function settleAll(db: DbClient, holdSeconds: number): Promise<void> {
  const ids = await sessionsWithEndedHolds(db);
  if (ids.length === 0) return;
  await lockSessions(db, ids);
  for (const id of [...ids].sort()) {
    await settleSession(db, id, holdSeconds);
  }
}

export { promoteWaiters, cascadeFor, createHold };
