import type pg from 'pg';
import { nowDate } from './clock.js';
import { db, isUnavailable, pool, tx, type Queryable } from './db.js';
import { ApiError } from './errors.js';
import { appendEvent } from './events.js';
import { loadHistory, workspaceToday } from './calendarstore.js';
import { clearSchedule, readSeatRecord, writeSchedule, writeSeats } from './services/killbill.js';

export const SEAT_PRICE = '8.00';
export const MIN_SEATS = 1;
export const MAX_SEATS = 40;
const FRESHNESS_MS = 10000;

export type WorkspaceSeatRow = {
  id: string;
  name: string;
  seats_limit: number;
  seats_confirmed_at: string | null;
  scheduled_limit: number | null;
  scheduled_on: string | null;
};

export type ConfirmedSeats = {
  limit: number;
  billingStatus: 'ok' | 'unavailable';
  scheduledLimit: number | null;
  scheduledOn: string | null;
  chargedThroughDate: string | null;
  subscriptionId: string | null;
};

async function seatRow(workspaceId: string, client: Queryable = db): Promise<WorkspaceSeatRow> {
  const row = await client.one<WorkspaceSeatRow>(
    'select id, name, seats_limit, seats_confirmed_at, scheduled_limit, scheduled_on from workspaces where id = $1',
    [workspaceId],
  );
  if (row === undefined) throw new ApiError('not_found');
  return row;
}

/**
 * The confirmed seat limit. Kill Bill's `seats` field is the limit, so a copy
 * older than 10 seconds is re-read before any seat decision.
 */
export async function confirmedSeats(
  workspaceId: string,
  options: { force?: boolean; strict?: boolean } = {},
): Promise<ConfirmedSeats> {
  const row = await seatRow(workspaceId);
  const age =
    row.seats_confirmed_at === null ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(row.seats_confirmed_at);
  if (options.force !== true && age < FRESHNESS_MS) {
    return {
      limit: row.seats_limit,
      billingStatus: 'ok',
      scheduledLimit: row.scheduled_limit,
      scheduledOn: row.scheduled_on,
      chargedThroughDate: null,
      subscriptionId: null,
    };
  }
  try {
    const record = await readSeatRecord(workspaceId, row.name, row.seats_limit);
    const history = await loadHistory(workspaceId);
    const today = workspaceToday(history);
    let limit = record.limit;
    let scheduledLimit = record.scheduledLimit;
    let scheduledOn = record.scheduledOn;
    if (scheduledOn !== null && scheduledLimit !== null && scheduledOn <= today) {
      await writeSeats(record.subscriptionId, scheduledLimit);
      limit = scheduledLimit;
      scheduledLimit = null;
      scheduledOn = null;
    }
    await storeConfirmed(workspaceId, limit, scheduledLimit, scheduledOn);
    return {
      limit,
      billingStatus: 'ok',
      scheduledLimit,
      scheduledOn,
      chargedThroughDate: record.chargedThroughDate,
      subscriptionId: record.subscriptionId,
    };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'billing_unavailable') throw error;
    if (options.strict === true) throw error;
    return {
      limit: row.seats_limit,
      billingStatus: 'unavailable',
      scheduledLimit: row.scheduled_limit,
      scheduledOn: row.scheduled_on,
      chargedThroughDate: null,
      subscriptionId: null,
    };
  }
}

async function storeConfirmed(
  workspaceId: string,
  limit: number,
  scheduledLimit: number | null,
  scheduledOn: string | null,
): Promise<void> {
  const at = nowDate().toISOString();
  await tx(async (client) => {
    const previous = await client.one<{ seats_limit: number; scheduled_limit: number | null }>(
      'select seats_limit, scheduled_limit from workspaces where id = $1 for update',
      [workspaceId],
    );
    await client.query(
      `update workspaces set seats_limit = $2, seats_confirmed_at = $3, scheduled_limit = $4, scheduled_on = $5
        where id = $1`,
      [workspaceId, limit, at, scheduledLimit, scheduledOn],
    );
    const scheduleApplied =
      previous !== undefined && previous.scheduled_limit !== null && scheduledLimit === null && previous.seats_limit !== limit;
    if (scheduleApplied) {
      await appendEvent(client, workspaceId, 'notice', {}, { type: 'workspace' }, at);
    }
  });
}

export async function pendingInviteCount(workspaceId: string, client: Queryable = db): Promise<number> {
  const row = await client.one<{ count: number }>(
    `select count(*)::int as count from invites
      where workspace_id = $1 and status = 'pending' and expires_at > $2`,
    [workspaceId, nowDate().toISOString()],
  );
  return row?.count ?? 0;
}

export function monthlyTotal(limit: number): string {
  return (limit * 8).toFixed(2);
}

export type SeatChange = {
  limit: number;
  scheduledLimit: number | null;
  scheduledOn: string | null;
  outcome: 'raised' | 'scheduled' | 'unchanged';
};

/**
 * Seat changes for a workspace run one at a time across app copies: a raise is
 * confirmed by Kill Bill before it counts, and a reduction waits for the paid period.
 */
export async function changeSeats(workspaceId: string, seats: number, activePeople: number): Promise<SeatChange> {
  const client = await lockSeatChanges(workspaceId);
  try {
    const current = await confirmedSeats(workspaceId, { force: true, strict: true });
    if (seats < activePeople) throw new ApiError('seats_below_active');
    if (current.subscriptionId === null) throw new ApiError('billing_unavailable');
    if (seats > current.limit) {
      const confirmed = await writeSeats(current.subscriptionId, seats);
      await storeConfirmed(workspaceId, confirmed, null, null);
      return { limit: confirmed, scheduledLimit: null, scheduledOn: null, outcome: 'raised' };
    }
    if (seats === current.limit) {
      await clearSchedule(current.subscriptionId);
      await storeConfirmed(workspaceId, current.limit, null, null);
      return { limit: current.limit, scheduledLimit: null, scheduledOn: null, outcome: 'unchanged' };
    }
    if (current.chargedThroughDate === null) throw new ApiError('billing_unavailable');
    await writeSchedule(current.subscriptionId, seats, current.chargedThroughDate);
    await storeConfirmed(workspaceId, current.limit, seats, current.chargedThroughDate);
    return {
      limit: current.limit,
      scheduledLimit: seats,
      scheduledOn: current.chargedThroughDate,
      outcome: 'scheduled',
    };
  } finally {
    await client.release();
  }
}

type SeatLock = { release: () => Promise<void> };

async function lockSeatChanges(workspaceId: string): Promise<SeatLock> {
  const key = workspaceLockKey(workspaceId);
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
    await client.query('select pg_advisory_lock($1)', [key]);
  } catch (error) {
    if (isUnavailable(error)) throw new ApiError('database_unavailable');
    throw error;
  }
  return {
    async release() {
      try {
        await client.query('select pg_advisory_unlock($1)', [key]);
      } catch {
        // Dropping the connection releases the lock as well.
      } finally {
        client.release();
      }
    },
  };
}

export function workspaceLockKey(workspaceId: string): number {
  let hash = 0;
  for (const character of workspaceId) hash = (hash * 31 + character.charCodeAt(0)) % 2147483647;
  return hash;
}
