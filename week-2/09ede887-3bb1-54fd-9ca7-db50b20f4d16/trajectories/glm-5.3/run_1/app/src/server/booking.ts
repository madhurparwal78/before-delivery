/**
 * The booking operations. Each runs in one PostgreSQL transaction that takes
 * the touched sessions' row locks in id order, settles ended holds first, and
 * runs promotion in the same step as the change that freed a seat. Refusals
 * are checked in the published order and store nothing.
 */

import type { Pool, PoolClient } from './db/pool.js';

/** A database client inside a transaction. */
type DbClient = PoolClient;
import {
  Refused,
  cascadeFor,
  createHold,
  getSession,
  lockSessions,
  myStake,
  overlappingStakes,
  promoteWaiters,
  readSeats,
  settleSession,
  type Seats,
} from './seats.js';

export interface BookingDeps {
  pool: Pool;
  holdSeconds: number;
  idempotencyKeyTtlSeconds: number;
}

export interface ReservationOutcome {
  reservationId: number;
  sessionId: string;
  createdAt: Date;
  seats: Seats;
}

const RETRY_CODES = new Set(['40P01', '40001']);

/** Run `fn` in a transaction, retrying serialisation conflicts inside the call. */
async function transact<T>(pool: Pool, fn: (db: DbClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* the connection is gone */
      }
      const code = (err as { code?: string }).code;
      if (attempt < 4 && code !== undefined && RETRY_CODES.has(code)) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}

/* ------------------------------------------------------------------ *
 * Idempotency                                                        *
 * ------------------------------------------------------------------ */

interface KeyRow {
  id: number;
  api_version: string;
  session_id: string;
  response_status: number;
  response_body: string;
  created_at: Date;
}


/**
 * Claim an idempotency key, or find what its earlier use means. Returns
 * - {kind:'claimed'} when the key is new and this call may proceed,
 * - {kind:'replay'} with the stored response,
 * - {kind:'reused'} when the key belongs to another session or version,
 * - {kind:'in_progress'} when another request with the key is still running.
 */
async function claimKey(
  db: DbClient,
  accountId: number,
  key: string,
  version: string,
  sessionId: string,
  ttlSeconds: number,
): Promise<{ kind: 'claimed' | 'replay' | 'reused' | 'in_progress'; row?: KeyRow }> {
  const existing = await db.query(
    `SELECT id, api_version, session_id, response_status, response_body, created_at
       FROM idempotency_keys WHERE account_id = $1 AND key = $2`,
    [accountId, key],
  );
  const live = existing.rows.filter(
    (r: { created_at: Date }) => r.created_at.getTime() + ttlSeconds * 1000 > Date.now(),
  );
  // A key whose lifetime has passed counts as new.
  const dead = existing.rows.filter(
    (r: { id: number }) => !live.some((l: { id: number }) => l.id === r.id),
  );
  for (const row of dead) {
    await db.query('DELETE FROM idempotency_keys WHERE id = $1', [row.id]);
  }
  if (live.length > 0) {
    const row = live[0] as KeyRow;
    if (row.api_version === version && row.session_id === sessionId && row.response_status !== 0) {
      return { kind: 'replay', row };
    }
    if (row.api_version === version && row.session_id === sessionId && row.response_status === 0) {
      return { kind: 'in_progress' };
    }
    return { kind: 'reused' };
  }
  const claim = await db.query(
    `INSERT INTO idempotency_keys (account_id, api_version, key, session_id, response_status, response_body)
     VALUES ($1, $2, $3, $4, 0, '')
     ON CONFLICT (account_id, api_version, key) DO NOTHING
     RETURNING id`,
    [accountId, version, key, sessionId],
  );
  if (claim.rows.length === 0) return { kind: 'in_progress' };
  return { kind: 'claimed' };
}

/* ------------------------------------------------------------------ *
 * Reserve                                                            *
 * ------------------------------------------------------------------ */

export async function reserve(
  deps: BookingDeps,
  sessionId: string,
  accountId: number,
  key: string | null,
  version: string,
  buildResponse: (outcome: ReservationOutcome) => { status: number; body: string },
): Promise<{ status: number; body: string }> {
  return transact(deps.pool, async (db) => {
    await lockSessions(db, [sessionId]);
    await settleSession(db, sessionId, deps.holdSeconds);

    const session = await getSession(db, sessionId);
    if (!session) throw new Refused('not_reservable');
    if (session.capacity === null) throw new Refused('not_reservable');

    let claimId: number | null = null;
    if (key !== null) {
      const claimed = await claimKey(db, accountId, key, version, sessionId, deps.idempotencyKeyTtlSeconds);
      if (claimed.kind === 'replay') {
        return { status: claimed.row!.response_status, body: claimed.row!.response_body };
      }
      if (claimed.kind === 'reused') throw new Refused('idempotency_key_reused');
      if (claimed.kind === 'in_progress') throw new Refused('request_in_progress');
      claimId = (await db.query('SELECT id FROM idempotency_keys WHERE account_id=$1 AND api_version=$2 AND key=$3', [accountId, version, key])).rows[0]?.id ?? null;
    }

    const stake = await myStake(db, sessionId, accountId);
    if (stake.reserved) throw new Refused('already_reserved');

    let outcome: ReservationOutcome;
    if (stake.liveHold) {
      // A reserve by the owner of a live hold on that session claims it.
      await db.query(
        `UPDATE holds SET ended_at = now(), end_kind = 'claimed' WHERE id = $1`,
        [stake.liveHold.id],
      );
      await db.query(
        `INSERT INTO seat_events (session_id, account_id, kind, at) VALUES ($1, $2, 'claimed', now())`,
        [sessionId, accountId],
      );
      const res = await db.query(
        `INSERT INTO reservations (session_id, account_id) VALUES ($1, $2)
         ON CONFLICT (session_id, account_id) DO NOTHING
         RETURNING id, created_at`,
        [sessionId, accountId],
      );
      const row = res.rows[0]!;
      outcome = {
        reservationId: Number(row.id),
        sessionId,
        createdAt: new Date(row.created_at),
        seats: (await readSeats(db, session))!,
      };
    } else {
      const overlapping = await firstOverlap(db, accountId, session);
      if (overlapping) {
        throw new Refused('time_conflict', { conflicts_with: overlapping });
      }
      const seats = await readSeats(db, session);
      if (!seats || seats.left <= 0) throw new Refused('session_full');
      const res = await db.query(
        `INSERT INTO reservations (session_id, account_id) VALUES ($1, $2)
         ON CONFLICT (session_id, account_id) DO NOTHING
         RETURNING id, created_at`,
        [sessionId, accountId],
      );
      const row = res.rows[0]!;
      // Reserving directly takes the caller off the waitlist.
      await db.query(
        'DELETE FROM waitlist_entries WHERE session_id = $1 AND account_id = $2',
        [sessionId, accountId],
      );
      outcome = {
        reservationId: Number(row.id),
        sessionId,
        createdAt: new Date(row.created_at),
        seats: (await readSeats(db, session))!,
      };
    }

    const response = buildResponse(outcome);
    if (claimId !== null) {
      await db.query(
        `UPDATE idempotency_keys SET response_status = $2, response_body = $3 WHERE id = $1`,
        [claimId, response.status, response.body],
      );
    }
    return response;
  });
}

/** The earliest-starting session that overlaps the caller's seats. */
async function firstOverlap(
  db: DbClient,
  accountId: number,
  session: { id: string; start_instant: Date; end_instant: Date },
): Promise<string | null> {
  const stakes = await overlappingStakes(db, accountId, session.start_instant, session.end_instant);
  if (stakes.length === 0) return null;
  const ids = [...new Set(stakes.map((s) => s.sessionId))];
  const res = await db.query(
    `SELECT id FROM sessions WHERE id = ANY($1) ORDER BY start_instant, id`,
    [ids],
  );
  return res.rows[0]?.id ?? null;
}

/* ------------------------------------------------------------------ *
 * Cancel                                                             *
 * ------------------------------------------------------------------ */

export async function cancel(
  deps: BookingDeps,
  sessionId: string,
  accountId: number,
): Promise<{ seats: Seats }> {
  return transact(deps.pool, async (db) => {
    // The cascade may touch every session the caller waits on.
    const waited = await db.query(
      'SELECT session_id FROM waitlist_entries WHERE account_id = $1',
      [accountId],
    );
    const ids = [sessionId, ...waited.rows.map((r: { session_id: string }) => r.session_id)];
    await lockSessions(db, ids);
    await settleSession(db, sessionId, deps.holdSeconds);

    const session = await getSession(db, sessionId);
    const stake = await myStake(db, sessionId, accountId);
    if (!stake.reserved) throw new Refused('no_reservation');
    await db.query('DELETE FROM reservations WHERE session_id = $1 AND account_id = $2', [
      sessionId,
      accountId,
    ]);
    const seats = (await readSeats(db, session!))!;
    // The freed seat is held for the oldest eligible waiter in the same step,
    // and the caller becomes eligible for the sessions they wait on.
    await promoteWaiters(db, sessionId, deps.holdSeconds);
    await cascadeFor(db, accountId, sessionId, deps.holdSeconds);
    return { seats };
  });
}

/* ------------------------------------------------------------------ *
 * Waitlist                                                           *
 * ------------------------------------------------------------------ */

export async function joinWaitlist(
  deps: BookingDeps,
  sessionId: string,
  accountId: number,
): Promise<{ position: number; createdAt: Date }> {
  return transact(deps.pool, async (db) => {
    await lockSessions(db, [sessionId]);
    await settleSession(db, sessionId, deps.holdSeconds);

    const session = await getSession(db, sessionId);
    if (!session) throw new Refused('not_reservable');
    if (session.capacity === null) throw new Refused('not_reservable');

    const stake = await myStake(db, sessionId, accountId);
    if (stake.reserved || stake.liveHold) throw new Refused('already_reserved');

    const existing = await db.query(
      'SELECT id FROM waitlist_entries WHERE session_id = $1 AND account_id = $2',
      [sessionId, accountId],
    );
    if (existing.rows.length > 0) throw new Refused('already_waitlisted');

    const overlapping = await firstOverlap(db, accountId, session);
    if (overlapping) throw new Refused('time_conflict', { conflicts_with: overlapping });

    const seats = await readSeats(db, session);
    if (seats && seats.left > 0) throw new Refused('seats_available');

    const insert = await db.query(
      `INSERT INTO waitlist_entries (session_id, account_id)
       VALUES ($1, $2) RETURNING created_at`,
      [sessionId, accountId],
    );
    const position = await waitlistPosition(db, sessionId, accountId);
    return { position, createdAt: new Date(insert.rows[0]!.created_at) };
  });
}

export async function waitlistPosition(
  db: DbClient,
  sessionId: string,
  accountId: number,
): Promise<number> {
  const res = await db.query(
    `SELECT position FROM (
       SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS position
         FROM waitlist_entries WHERE session_id = $1
     ) p JOIN waitlist_entries w ON w.id = p.id
     WHERE w.session_id = $1 AND w.account_id = $2`,
    [sessionId, accountId],
  );
  return Number(res.rows[0]!.position);
}

export async function leaveWaitlist(
  deps: BookingDeps,
  sessionId: string,
  accountId: number,
): Promise<void> {
  await transact(deps.pool, async (db) => {
    await lockSessions(db, [sessionId]);
    await settleSession(db, sessionId, deps.holdSeconds);
    const res = await db.query(
      'DELETE FROM waitlist_entries WHERE session_id = $1 AND account_id = $2 RETURNING id',
      [sessionId, accountId],
    );
    if (res.rows.length === 0) throw new Refused('not_waitlisted');
  });
}

/* ------------------------------------------------------------------ *
 * Claim and release                                                  *
 * ------------------------------------------------------------------ */

export async function claim(
  deps: BookingDeps,
  sessionId: string,
  accountId: number,
): Promise<ReservationOutcome> {
  return transact(deps.pool, async (db) => {
    await lockSessions(db, [sessionId]);
    await settleSession(db, sessionId, deps.holdSeconds);

    const session = await getSession(db, sessionId);
    const stake = await myStake(db, sessionId, accountId);
    if (stake.reserved) throw new Refused('already_reserved');
    if (!stake.liveHold) {
      throw new Refused(stake.latestHoldEndedAsExpired ? 'hold_expired' : 'no_hold');
    }
    await db.query(`UPDATE holds SET ended_at = now(), end_kind = 'claimed' WHERE id = $1`, [
      stake.liveHold.id,
    ]);
    await db.query(
      `INSERT INTO seat_events (session_id, account_id, kind, at) VALUES ($1, $2, 'claimed', now())`,
      [sessionId, accountId],
    );
    const res = await db.query(
      `INSERT INTO reservations (session_id, account_id) VALUES ($1, $2)
       ON CONFLICT (session_id, account_id) DO NOTHING
       RETURNING id, created_at`,
      [sessionId, accountId],
    );
    const row = res.rows[0]!;
    return {
      reservationId: Number(row.id),
      sessionId,
      createdAt: new Date(row.created_at),
      seats: (await readSeats(db, session!))!,
    };
  });
}

export async function release(
  deps: BookingDeps,
  sessionId: string,
  accountId: number,
): Promise<void> {
  await transact(deps.pool, async (db) => {
    const waited = await db.query(
      'SELECT session_id FROM waitlist_entries WHERE account_id = $1',
      [accountId],
    );
    const ids = [sessionId, ...waited.rows.map((r: { session_id: string }) => r.session_id)];
    await lockSessions(db, ids);
    await settleSession(db, sessionId, deps.holdSeconds);

    const stake = await myStake(db, sessionId, accountId);
    if (!stake.liveHold) {
      throw new Refused(stake.latestHoldEndedAsExpired ? 'hold_expired' : 'no_hold');
    }
    await db.query(`UPDATE holds SET ended_at = now(), end_kind = 'surrendered' WHERE id = $1`, [
      stake.liveHold.id,
    ]);
    await db.query(
      `INSERT INTO seat_events (session_id, account_id, kind, at) VALUES ($1, $2, 'surrendered', now())`,
      [sessionId, accountId],
    );
    await promoteWaiters(db, sessionId, deps.holdSeconds);
    await cascadeFor(db, accountId, sessionId, deps.holdSeconds);
  });
}

/* ------------------------------------------------------------------ *
 * Capacity                                                           *
 * ------------------------------------------------------------------ */

export async function setCapacity(
  deps: BookingDeps,
  sessionId: string,
  capacity: number,
): Promise<{ seats: Seats }> {
  return transact(deps.pool, async (db) => {
    await lockSessions(db, [sessionId]);
    await settleSession(db, sessionId, deps.holdSeconds);

    const session = await getSession(db, sessionId);
    if (!session) throw new Refused('not_reservable');
    if (session.capacity === null) throw new Refused('not_reservable');

    const seats = (await readSeats(db, session))!;
    const taken = seats.reserved + seats.held;
    if (capacity < taken) {
      throw new Refused('below_reserved', { reserved: taken });
    }
    await db.query('UPDATE sessions SET capacity = $2 WHERE id = $1', [sessionId, capacity]);
    // A raise holds the new seats for eligible waiters in the same step.
    if (capacity > session.capacity) {
      await promoteWaiters(db, sessionId, deps.holdSeconds);
    }
    const fresh = (await readSeats(db, { ...session, capacity }))!;
    return { seats: fresh };
  });
}

export { createHold };
