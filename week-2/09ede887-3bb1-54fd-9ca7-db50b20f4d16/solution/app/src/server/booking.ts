import { config } from './config';
import { db, transaction, type Db } from './db';
import { ApiError, belowReserved } from './errors';

// Seats, holds, waitlists and promotion. Every guarantee here rests on PostgreSQL: session rows
// locked in id order, account rows locked after them, unique constraints, and the database clock
// (the live_holds and session_seats views). Nothing is remembered in the process.

type Tx = Db;

export interface SeatCounts {
  capacity: number;
  reserved: number;
  held: number;
  seats_left: number;
}

async function seatCounts(tx: Db, sessionId: string): Promise<SeatCounts | null> {
  const result = await tx.query<SeatCounts & { capacity: number | null }>(
    'SELECT capacity, reserved, held, seats_left FROM session_seats WHERE session_id = $1',
    [sessionId],
  );
  const row = result.rows[0];
  return row === undefined || row.capacity === null ? null : row;
}

async function lockSessions(tx: Tx, ids: string[]): Promise<void> {
  await tx.query('SELECT id FROM sessions WHERE id = ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE', [ids]);
}

async function lockAccount(tx: Tx, accountId: string): Promise<void> {
  await tx.query('SELECT id FROM accounts WHERE id = $1 FOR NO KEY UPDATE', [accountId]);
}

async function waitedSessions(tx: Tx, accountIds: string[]): Promise<string[]> {
  const result = await tx.query<{ session_id: string }>(
    'SELECT DISTINCT session_id FROM waitlist_entries WHERE account_id = ANY($1::uuid[])',
    [accountIds],
  );
  return result.rows.map((row) => row.session_id);
}

// The overlap test: the caller's reservation or live hold in another session that overlaps this
// one, compared as UTC instants. Touching times do not overlap.
async function conflictingSession(tx: Db, accountId: string, sessionId: string): Promise<string | null> {
  const result = await tx.query<{ id: string }>(
    `SELECT o.id
       FROM sessions s
       JOIN sessions o ON o.id <> s.id AND o.start_instant < s.end_instant AND s.start_instant < o.end_instant
      WHERE s.id = $2
        AND (EXISTS (SELECT 1 FROM reservations r WHERE r.account_id = $1 AND r.session_id = o.id)
             OR EXISTS (SELECT 1 FROM live_holds h WHERE h.account_id = $1 AND h.session_id = o.id))
      ORDER BY o.start_instant, o.id
      LIMIT 1`,
    [accountId, sessionId],
  );
  return result.rows[0]?.id ?? null;
}

async function createHold(tx: Tx, sessionId: string, accountId: string): Promise<void> {
  await tx.query(
    `WITH clock AS (SELECT clock_timestamp() AS now),
          hold AS (INSERT INTO holds (session_id, account_id, held_from, held_until)
                   SELECT $1, $2, now, now + make_interval(secs => $3) FROM clock
                   RETURNING session_id, account_id, held_from)
     INSERT INTO seat_events (session_id, account_id, kind, at)
     SELECT session_id, account_id, 'promoted', held_from FROM hold`,
    [sessionId, accountId, config.holdSeconds],
  );
}

// Promotion: while the session has an open seat, the oldest eligible waiter (no overlapping
// reservation or live hold, counting holds made earlier in this transaction) gets a hold.
async function promote(tx: Tx, sessionId: string): Promise<void> {
  for (;;) {
    const counts = await seatCounts(tx, sessionId);
    if (counts === null || counts.seats_left <= 0) return;
    const waiters = await tx.query<{ id: number; account_id: string }>(
      'SELECT id, account_id FROM waitlist_entries WHERE session_id = $1 ORDER BY created_at, id',
      [sessionId],
    );
    let promoted = false;
    for (const waiter of waiters.rows) {
      await lockAccount(tx, waiter.account_id);
      if ((await conflictingSession(tx, waiter.account_id, sessionId)) !== null) continue;
      await tx.query('DELETE FROM waitlist_entries WHERE id = $1', [waiter.id]);
      await createHold(tx, sessionId, waiter.account_id);
      promoted = true;
      break;
    }
    if (!promoted) return;
  }
}

// The cascade after a seat's former owner loses it: promote into the freed seat, then re-run
// promotion on every other session the owner waits for that has an open seat, earliest first.
async function releaseSeat(tx: Tx, sessionId: string, formerOwner: string): Promise<void> {
  await promote(tx, sessionId);
  const waits = await tx.query<{ id: string }>(
    `SELECT s.id FROM waitlist_entries w
       JOIN sessions s ON s.id = w.session_id
       JOIN session_seats ss ON ss.session_id = s.id
      WHERE w.account_id = $1 AND s.id <> $2 AND ss.seats_left > 0
      ORDER BY s.start_instant, s.id`,
    [formerOwner, sessionId],
  );
  for (const { id } of waits.rows) {
    await lockSessions(tx, [id]);
    await promote(tx, id);
  }
}

// Settling: every hold in this (locked) session that reached held_until ends as expired, at
// held_until, exactly once, and passes its seat on in the same transaction.
async function settleSession(tx: Tx, sessionId: string): Promise<void> {
  const ended = await tx.query<{ account_id: string }>(
    `WITH ended AS (DELETE FROM holds WHERE session_id = $1 AND held_until <= clock_timestamp()
                    RETURNING id, session_id, account_id, held_until)
     INSERT INTO seat_events (session_id, account_id, kind, at)
     SELECT session_id, account_id, 'expired', held_until FROM ended ORDER BY held_until, id
     RETURNING account_id`,
    [sessionId],
  );
  for (const { account_id } of ended.rows) await releaseSeat(tx, sessionId, account_id);
}

// Locks the session plus every session that the given accounts or the owners of its ended holds
// wait for (all in id order, so a cascade never has to lock out of order), then settles it.
async function lockAndSettle(tx: Tx, sessionId: string, accounts: string[]): Promise<void> {
  const endedOwners = await tx.query<{ account_id: string }>(
    'SELECT account_id FROM holds WHERE session_id = $1 AND held_until <= clock_timestamp()',
    [sessionId],
  );
  const affected = [...accounts, ...endedOwners.rows.map((row) => row.account_id)];
  await lockSessions(tx, [sessionId, ...(await waitedSessions(tx, affected))]);
  await settleSession(tx, sessionId);
}

async function begin(tx: Tx, sessionId: string, actor: string): Promise<void> {
  await lockAndSettle(tx, sessionId, [actor]);
  await lockAccount(tx, actor);
}

// Settles every session with an ended hold, each in its own transaction under its lock.
export async function settleEndedHolds(): Promise<void> {
  const due = await db.query<{ session_id: string }>(
    'SELECT DISTINCT session_id FROM holds WHERE held_until <= clock_timestamp() ORDER BY session_id',
  );
  for (const { session_id } of due.rows) await transaction((tx) => lockAndSettle(tx, session_id, []));
}

interface CallerState {
  reserved: boolean;
  liveHold: boolean;
  waiting: boolean;
}

async function callerState(tx: Tx, accountId: string, sessionId: string): Promise<CallerState> {
  const result = await tx.query<CallerState>(
    `SELECT EXISTS (SELECT 1 FROM reservations WHERE account_id = $1 AND session_id = $2) AS reserved,
            EXISTS (SELECT 1 FROM live_holds WHERE account_id = $1 AND session_id = $2) AS "liveHold",
            EXISTS (SELECT 1 FROM waitlist_entries WHERE account_id = $1 AND session_id = $2) AS waiting`,
    [accountId, sessionId],
  );
  const row = result.rows[0];
  return row ?? { reserved: false, liveHold: false, waiting: false };
}

async function requireReservable(tx: Tx, sessionId: string): Promise<SeatCounts> {
  const counts = await seatCounts(tx, sessionId);
  if (counts === null) throw new ApiError('not_reservable');
  return counts;
}

export interface Created {
  id: number;
  session_id: string;
  created_at: string;
}

// A live hold becomes a reservation stamped with the claim time.
async function convertHold(tx: Tx, accountId: string, sessionId: string): Promise<Created> {
  const result = await tx.query<Created>(
    `WITH clock AS (SELECT clock_timestamp() AS now),
          gone AS (DELETE FROM holds WHERE account_id = $1 AND session_id = $2 RETURNING account_id, session_id),
          logged AS (INSERT INTO seat_events (session_id, account_id, kind, at)
                     SELECT session_id, account_id, 'claimed', now FROM gone, clock)
     INSERT INTO reservations (account_id, session_id, created_at)
     SELECT account_id, session_id, now FROM gone, clock
     RETURNING id, session_id, iso(created_at) AS created_at`,
    [accountId, sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new ApiError('no_hold');
  return row;
}

// Reserve: not_reservable, already_reserved, time_conflict, session_full, in that order. The
// owner of a live hold claims it instead, with no overlap or seat check.
export async function reserve(tx: Tx, accountId: string, sessionId: string): Promise<{ created: Created; seats: SeatCounts }> {
  await begin(tx, sessionId, accountId);
  const counts = await requireReservable(tx, sessionId);
  const state = await callerState(tx, accountId, sessionId);
  if (state.reserved) throw new ApiError('already_reserved');
  let created: Created;
  if (state.liveHold) {
    created = await convertHold(tx, accountId, sessionId);
  } else {
    const conflict = await conflictingSession(tx, accountId, sessionId);
    if (conflict !== null) throw new ApiError('time_conflict', { conflicts_with: conflict });
    if (counts.seats_left <= 0) throw new ApiError('session_full');
    await tx.query('DELETE FROM waitlist_entries WHERE account_id = $1 AND session_id = $2', [accountId, sessionId]);
    const inserted = await tx.query<Created>(
      `INSERT INTO reservations (account_id, session_id) VALUES ($1, $2)
       RETURNING id, session_id, iso(created_at) AS created_at`,
      [accountId, sessionId],
    );
    created = inserted.rows[0] as Created;
  }
  return { created, seats: await requireReservable(tx, sessionId) };
}

export async function cancel(accountId: string, sessionId: string): Promise<SeatCounts> {
  return transaction(async (tx) => {
    await begin(tx, sessionId, accountId);
    const removed = await tx.query('DELETE FROM reservations WHERE account_id = $1 AND session_id = $2', [
      accountId,
      sessionId,
    ]);
    if (removed.rowCount === 0) throw new ApiError('no_reservation');
    await releaseSeat(tx, sessionId, accountId);
    return requireReservable(tx, sessionId);
  });
}

export async function joinWaitlist(accountId: string, sessionId: string): Promise<{ position: number; created_at: string }> {
  return transaction(async (tx) => {
    await begin(tx, sessionId, accountId);
    const counts = await requireReservable(tx, sessionId);
    const state = await callerState(tx, accountId, sessionId);
    if (state.reserved || state.liveHold) throw new ApiError('already_reserved');
    if (state.waiting) throw new ApiError('already_waitlisted');
    // Waitlist entries never conflict; an overlap only explains why an open seat cannot be taken.
    if (counts.seats_left > 0) {
      const conflict = await conflictingSession(tx, accountId, sessionId);
      if (conflict !== null) throw new ApiError('time_conflict', { conflicts_with: conflict });
      throw new ApiError('seats_available');
    }
    const joined = await tx.query<{ created_at: string; position: number }>(
      `WITH entry AS (INSERT INTO waitlist_entries (account_id, session_id) VALUES ($1, $2) RETURNING created_at)
       SELECT iso(entry.created_at) AS created_at,
              (SELECT count(*) FROM waitlist_entries WHERE session_id = $2)::int + 1 AS position
       FROM entry`,
      [accountId, sessionId],
    );
    return joined.rows[0] as { position: number; created_at: string };
  });
}

export async function leaveWaitlist(accountId: string, sessionId: string): Promise<void> {
  await transaction(async (tx) => {
    await begin(tx, sessionId, accountId);
    const removed = await tx.query('DELETE FROM waitlist_entries WHERE account_id = $1 AND session_id = $2', [
      accountId,
      sessionId,
    ]);
    if (removed.rowCount === 0) throw new ApiError('not_waitlisted');
  });
}

// With no live hold: hold_expired when the caller's latest hold here ended by time, else no_hold.
async function noLiveHold(tx: Tx, accountId: string, sessionId: string): Promise<ApiError> {
  const latest = await tx.query<{ kind: string }>(
    `SELECT kind FROM seat_events
      WHERE account_id = $1 AND session_id = $2 AND kind IN ('claimed', 'expired', 'surrendered')
      ORDER BY id DESC LIMIT 1`,
    [accountId, sessionId],
  );
  return new ApiError(latest.rows[0]?.kind === 'expired' ? 'hold_expired' : 'no_hold');
}

export async function claim(accountId: string, sessionId: string): Promise<{ created: Created; seats: SeatCounts }> {
  return transaction(async (tx) => {
    await begin(tx, sessionId, accountId);
    const state = await callerState(tx, accountId, sessionId);
    if (state.reserved) throw new ApiError('already_reserved');
    if (!state.liveHold) throw await noLiveHold(tx, accountId, sessionId);
    const created = await convertHold(tx, accountId, sessionId);
    return { created, seats: await requireReservable(tx, sessionId) };
  });
}

export async function release(accountId: string, sessionId: string): Promise<void> {
  await transaction(async (tx) => {
    await begin(tx, sessionId, accountId);
    const state = await callerState(tx, accountId, sessionId);
    if (!state.liveHold) throw await noLiveHold(tx, accountId, sessionId);
    await tx.query(
      `WITH gone AS (DELETE FROM holds WHERE account_id = $1 AND session_id = $2 RETURNING account_id, session_id)
       INSERT INTO seat_events (session_id, account_id, kind, at)
       SELECT session_id, account_id, 'surrendered', clock_timestamp() FROM gone`,
      [accountId, sessionId],
    );
    await releaseSeat(tx, sessionId, accountId);
  });
}

// Capacity change, serialised with every booking change on the session by its row lock.
export async function changeCapacity(sessionId: string, capacity: number): Promise<void> {
  await transaction(async (tx) => {
    await lockAndSettle(tx, sessionId, []);
    const counts = await requireReservable(tx, sessionId);
    const taken = counts.reserved + counts.held;
    if (capacity < taken) throw belowReserved(taken);
    await tx.query('UPDATE sessions SET capacity = $2 WHERE id = $1', [sessionId, capacity]);
    if (capacity > counts.capacity) await promote(tx, sessionId);
  });
}
