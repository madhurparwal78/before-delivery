import type { Database, Queryable } from './pool.js';
import { isRetryable } from './pool.js';
import { ApiError, belowReserved, conflict, timeConflict, unavailable } from '../http/errors.js';
import { DB_NOW } from './sql.js';

export interface SeatCounts {
  readonly capacity: number | null;
  readonly reserved: number;
  readonly held: number;
  readonly waitlisted: number;
}

export interface ReservationRow {
  readonly id: number;
  readonly sessionId: string;
  readonly createdAt: Date;
}

export interface WaitlistRow {
  readonly sessionId: string;
  readonly position: number;
  readonly createdAt: Date;
}

/** Raised inside a locked transaction when the lock set has to grow. */
class NeedsLocks extends Error {
  constructor(readonly ids: readonly string[]) {
    super('more session locks needed');
  }
}

const MAX_ATTEMPTS = 16;

export class BookingStore {
  constructor(
    private readonly database: Database,
    private readonly holdSeconds: number,
  ) {}

  /**
   * Runs `body` in one transaction holding the named session rows, locked in
   * id order. Grows the lock set and retries on serialisation conflicts.
   */
  private async locked<T>(
    initialIds: readonly string[],
    body: (tx: Queryable, locked: ReadonlySet<string>) => Promise<T>,
  ): Promise<T> {
    let ids = [...new Set(initialIds)];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.database.transaction(async (tx) => {
          await lockSessions(tx, ids);
          return await body(tx, new Set(ids));
        });
      } catch (error) {
        if (error instanceof NeedsLocks) {
          ids = [...new Set([...ids, ...error.ids])];
          continue;
        }
        if (isRetryable(error)) continue;
        throw error;
      }
    }
    throw unavailable();
  }

  /** The sessions an account waits for, so they can be locked up front. */
  private async waitlistSessions(account: number): Promise<string[]> {
    const result = await this.database.query<{ session_id: string }>(
      'SELECT session_id FROM waitlist_entries WHERE account_id = $1',
      [account],
    );
    return result.rows.map((row) => row.session_id);
  }

  /**
   * Ends every hold whose `held_until` has passed on the database clock and
   * passes each freed seat on, under the session's lock.
   */
  async settleDueSessions(): Promise<void> {
    const due = await this.database.query<{ session_id: string }>(
      `SELECT DISTINCT session_id FROM holds
       WHERE settled_as IS NULL AND held_until <= now() ORDER BY session_id`,
    );
    for (const row of due.rows) {
      await this.locked([row.session_id], async (tx, lockedIds) => {
        await this.settleSession(tx, row.session_id, lockedIds);
      });
    }
  }

  private async settleSession(tx: Queryable, sessionId: string, lockedIds: ReadonlySet<string>): Promise<void> {
    const expired = await tx.query<{ id: number; account_id: number }>(
      `SELECT id, account_id FROM holds
       WHERE session_id = $1 AND settled_as IS NULL AND held_until <= now()
       ORDER BY held_until, id`,
      [sessionId],
    );
    for (const hold of expired.rows) {
      await tx.query(`UPDATE holds SET settled_as = 'expired', settled_at = ${DB_NOW} WHERE id = $1`, [hold.id]);
      await tx.query(
        `INSERT INTO seat_events (session_id, account_id, kind, at)
         SELECT session_id, account_id, 'expired', held_until FROM holds WHERE id = $1`,
        [hold.id],
      );
      await this.cascade(tx, sessionId, hold.account_id, lockedIds);
    }
  }

  /** Step 1 promotes into the freed seat; step 2 revisits the former owner's other waitlists. */
  private async cascade(
    tx: Queryable,
    sessionId: string,
    formerOwner: number,
    lockedIds: ReadonlySet<string>,
  ): Promise<void> {
    await this.promote(tx, sessionId);
    const others = await tx.query<{ id: string }>(
      `SELECT s.id FROM waitlist_entries w
         JOIN sessions s ON s.id = w.session_id
       WHERE w.account_id = $1 AND s.id <> $2 AND s.capacity IS NOT NULL
       ORDER BY s.start_instant, s.id`,
      [formerOwner, sessionId],
    );
    const missing = others.rows.map((row) => row.id).filter((id) => !lockedIds.has(id));
    if (missing.length > 0) throw new NeedsLocks([...lockedIds, ...missing]);
    for (const other of others.rows) {
      await this.promote(tx, other.id);
    }
  }

  /** Hands every open seat of one session to the oldest eligible waiter. */
  private async promote(tx: Queryable, sessionId: string): Promise<void> {
    const counts = await seatCounts(tx, sessionId);
    if (counts.capacity === null) return;
    let open = counts.capacity - counts.reserved - counts.held;
    while (open > 0) {
      const next = await tx.query<{ id: number; account_id: number }>(ELIGIBLE_WAITER_SQL, [sessionId]);
      const entry = next.rows[0];
      if (entry === undefined) return;
      await tx.query('DELETE FROM waitlist_entries WHERE id = $1', [entry.id]);
      await tx.query(
        `INSERT INTO holds (session_id, account_id, held_from, held_until)
         VALUES ($1, $2, ${DB_NOW}, ${DB_NOW} + make_interval(secs => $3))`,
        [sessionId, entry.account_id, this.holdSeconds],
      );
      await tx.query(
        `INSERT INTO seat_events (session_id, account_id, kind, at) VALUES ($1, $2, 'promoted', ${DB_NOW})`,
        [sessionId, entry.account_id],
      );
      open -= 1;
    }
  }

  async reserve(
    account: number,
    sessionId: string,
    onStored: (tx: Queryable, reservation: ReservationRow, seats: SeatCounts) => Promise<void>,
  ): Promise<{ reservation: ReservationRow; seats: SeatCounts }> {
    return this.locked([sessionId], async (tx, lockedIds) => {
      await this.settleSession(tx, sessionId, lockedIds);
      const counts = await seatCounts(tx, sessionId);
      if (counts.capacity === null) throw conflict('not_reservable');
      if (await hasReservation(tx, account, sessionId)) throw conflict('already_reserved');
      const hold = await liveHoldId(tx, account, sessionId);
      if (hold === null) {
        const clash = await overlappingSession(tx, account, sessionId);
        if (clash !== null) throw timeConflict(clash);
        if (counts.capacity - counts.reserved - counts.held <= 0) throw conflict('session_full');
      }
      const reservation = await this.storeReservation(tx, account, sessionId, hold);
      const seats = await seatCounts(tx, sessionId);
      await onStored(tx, reservation, seats);
      return { reservation, seats };
    });
  }

  private async storeReservation(
    tx: Queryable,
    account: number,
    sessionId: string,
    holdId: number | null,
  ): Promise<ReservationRow> {
    if (holdId !== null) {
      await tx.query(`UPDATE holds SET settled_as = 'claimed', settled_at = ${DB_NOW} WHERE id = $1`, [holdId]);
      await tx.query(
        `INSERT INTO seat_events (session_id, account_id, kind, at) VALUES ($1, $2, 'claimed', ${DB_NOW})`,
        [sessionId, account],
      );
    }
    await tx.query('DELETE FROM waitlist_entries WHERE session_id = $1 AND account_id = $2', [sessionId, account]);
    const inserted = await tx.query<{ id: number; created_at: Date }>(
      `INSERT INTO reservations (session_id, account_id, created_at) VALUES ($1, $2, ${DB_NOW})
       RETURNING id, created_at`,
      [sessionId, account],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw unavailable();
    return { id: row.id, sessionId, createdAt: row.created_at };
  }

  async claim(account: number, sessionId: string): Promise<{ reservation: ReservationRow; seats: SeatCounts }> {
    return this.locked([sessionId], async (tx, lockedIds) => {
      await this.settleSession(tx, sessionId, lockedIds);
      if (await hasReservation(tx, account, sessionId)) throw conflict('already_reserved');
      const hold = await liveHoldId(tx, account, sessionId);
      if (hold === null) throw await noLiveHoldError(tx, account, sessionId);
      const reservation = await this.storeReservation(tx, account, sessionId, hold);
      return { reservation, seats: await seatCounts(tx, sessionId) };
    });
  }

  async cancel(account: number, sessionId: string): Promise<SeatCounts> {
    const plan = [sessionId, ...(await this.waitlistSessions(account))];
    return this.locked(plan, async (tx, lockedIds) => {
      await this.settleSession(tx, sessionId, lockedIds);
      const removed = await tx.query(
        'DELETE FROM reservations WHERE session_id = $1 AND account_id = $2',
        [sessionId, account],
      );
      if (removed.rowCount === 0) throw conflict('no_reservation');
      await this.cascade(tx, sessionId, account, lockedIds);
      return seatCounts(tx, sessionId);
    });
  }

  async release(account: number, sessionId: string): Promise<void> {
    const plan = [sessionId, ...(await this.waitlistSessions(account))];
    await this.locked(plan, async (tx, lockedIds) => {
      await this.settleSession(tx, sessionId, lockedIds);
      const hold = await liveHoldId(tx, account, sessionId);
      if (hold === null) throw await noLiveHoldError(tx, account, sessionId);
      await tx.query(`UPDATE holds SET settled_as = 'surrendered', settled_at = ${DB_NOW} WHERE id = $1`, [hold]);
      await tx.query(
        `INSERT INTO seat_events (session_id, account_id, kind, at) VALUES ($1, $2, 'surrendered', ${DB_NOW})`,
        [sessionId, account],
      );
      await this.cascade(tx, sessionId, account, lockedIds);
    });
  }

  async joinWaitlist(account: number, sessionId: string): Promise<WaitlistRow> {
    return this.locked([sessionId], async (tx, lockedIds) => {
      await this.settleSession(tx, sessionId, lockedIds);
      const counts = await seatCounts(tx, sessionId);
      if (counts.capacity === null) throw conflict('not_reservable');
      if (await hasReservation(tx, account, sessionId)) throw conflict('already_reserved');
      if ((await liveHoldId(tx, account, sessionId)) !== null) throw conflict('already_reserved');
      const existing = await tx.query(
        'SELECT 1 FROM waitlist_entries WHERE session_id = $1 AND account_id = $2',
        [sessionId, account],
      );
      if (existing.rowCount !== 0) throw conflict('already_waitlisted');
      const clash = await overlappingSession(tx, account, sessionId);
      if (clash !== null) throw timeConflict(clash);
      if (counts.capacity - counts.reserved - counts.held > 0) throw conflict('seats_available');
      const inserted = await tx.query<{ id: number; created_at: Date }>(
        `INSERT INTO waitlist_entries (session_id, account_id, created_at) VALUES ($1, $2, ${DB_NOW})
         RETURNING id, created_at`,
        [sessionId, account],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw unavailable();
      const position = await tx.query<{ position: number }>(
        `SELECT count(*)::int AS position FROM waitlist_entries w
          WHERE w.session_id = $1
            AND (w.created_at, w.id) <= (SELECT created_at, id FROM waitlist_entries WHERE id = $2)`,
        [sessionId, row.id],
      );
      return { sessionId, position: position.rows[0]?.position ?? 1, createdAt: row.created_at };
    });
  }

  async leaveWaitlist(account: number, sessionId: string): Promise<void> {
    await this.locked([sessionId], async (tx, lockedIds) => {
      await this.settleSession(tx, sessionId, lockedIds);
      const removed = await tx.query(
        'DELETE FROM waitlist_entries WHERE session_id = $1 AND account_id = $2',
        [sessionId, account],
      );
      if (removed.rowCount === 0) throw conflict('not_waitlisted');
    });
  }

  async setCapacity(sessionId: string, capacity: number): Promise<void> {
    await this.locked([sessionId], async (tx, lockedIds) => {
      await this.settleSession(tx, sessionId, lockedIds);
      const counts = await seatCounts(tx, sessionId);
      if (counts.capacity === null) throw conflict('not_reservable');
      const taken = counts.reserved + counts.held;
      if (capacity < taken) throw belowReserved(taken);
      await tx.query('UPDATE sessions SET capacity = $2 WHERE id = $1', [sessionId, capacity]);
      await this.promote(tx, sessionId);
    });
  }
}

async function lockSessions(tx: Queryable, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.query('SELECT id FROM sessions WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE', [[...ids].sort()]);
}

export async function seatCounts(tx: Queryable, sessionId: string): Promise<SeatCounts> {
  const result = await tx.query<SeatCounts>(
    `SELECT s.capacity,
            (SELECT count(*)::int FROM reservations r WHERE r.session_id = s.id) AS reserved,
            (SELECT count(*)::int FROM holds h
               WHERE h.session_id = s.id AND h.settled_as IS NULL AND h.held_until > now()) AS held,
            (SELECT count(*)::int FROM waitlist_entries w WHERE w.session_id = s.id) AS waitlisted
       FROM sessions s WHERE s.id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw unavailable();
  return row;
}

async function hasReservation(tx: Queryable, account: number, sessionId: string): Promise<boolean> {
  const result = await tx.query(
    'SELECT 1 FROM reservations WHERE session_id = $1 AND account_id = $2',
    [sessionId, account],
  );
  return result.rowCount !== 0;
}

async function liveHoldId(tx: Queryable, account: number, sessionId: string): Promise<number | null> {
  const result = await tx.query<{ id: number }>(
    `SELECT id FROM holds
      WHERE session_id = $1 AND account_id = $2 AND settled_as IS NULL AND held_until > now()`,
    [sessionId, account],
  );
  return result.rows[0]?.id ?? null;
}

/** `hold_expired` when the caller's latest hold there ended by time, else `no_hold`. */
async function noLiveHoldError(tx: Queryable, account: number, sessionId: string): Promise<ApiError> {
  const result = await tx.query<{ settled_as: string | null }>(
    `SELECT settled_as FROM holds WHERE session_id = $1 AND account_id = $2
     ORDER BY held_from DESC, id DESC LIMIT 1`,
    [sessionId, account],
  );
  return result.rows[0]?.settled_as === 'expired' ? conflict('hold_expired') : conflict('no_hold');
}

/** The caller's reservation or live hold that clashes with this session, if any. */
async function overlappingSession(tx: Queryable, account: number, sessionId: string): Promise<string | null> {
  const result = await tx.query<{ id: string }>(
    `SELECT o.id FROM sessions t
       JOIN sessions o
         ON o.id <> t.id
        AND o.start_instant < t.end_instant
        AND t.start_instant < o.end_instant
      WHERE t.id = $1
        AND (EXISTS (SELECT 1 FROM reservations r WHERE r.session_id = o.id AND r.account_id = $2)
          OR EXISTS (SELECT 1 FROM holds h WHERE h.session_id = o.id AND h.account_id = $2
                       AND h.settled_as IS NULL AND h.held_until > now()))
      ORDER BY o.start_instant, o.id
      LIMIT 1`,
    [sessionId, account],
  );
  return result.rows[0]?.id ?? null;
}

const ELIGIBLE_WAITER_SQL = `
SELECT w.id, w.account_id FROM waitlist_entries w
 WHERE w.session_id = $1
   AND NOT EXISTS (SELECT 1 FROM reservations r
                    WHERE r.session_id = $1 AND r.account_id = w.account_id)
   AND NOT EXISTS (SELECT 1 FROM holds h
                    WHERE h.session_id = $1 AND h.account_id = w.account_id
                      AND h.settled_as IS NULL AND h.held_until > now())
   AND NOT EXISTS (
     SELECT 1 FROM sessions t
       JOIN sessions o
         ON o.id <> t.id
        AND o.start_instant < t.end_instant
        AND t.start_instant < o.end_instant
      WHERE t.id = $1
        AND (EXISTS (SELECT 1 FROM reservations r2
                      WHERE r2.session_id = o.id AND r2.account_id = w.account_id)
          OR EXISTS (SELECT 1 FROM holds h2
                      WHERE h2.session_id = o.id AND h2.account_id = w.account_id
                        AND h2.settled_as IS NULL AND h2.held_until > now())))
 ORDER BY w.created_at, w.id
 LIMIT 1`;
