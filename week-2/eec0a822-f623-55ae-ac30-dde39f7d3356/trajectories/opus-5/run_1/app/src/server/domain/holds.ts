import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { lockKey, query, txRows } from '../db.js';
import { conflict } from '../http/errors.js';
import { toInstantString } from '../../shared/zone.js';
import { seasonOf, weekEndOf } from './weeks.js';

export type HoldStatus = 'waiting' | 'live' | 'lapsed' | 'released' | 'charter';
export type WeekStatus = 'free' | 'held' | 'booked';

export interface HoldRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly yacht_id: string;
  readonly week_start: string;
  readonly week_end: string;
  readonly client_name: string;
  readonly placed_by_member_id: string | null;
  readonly placed_by_member_name: string | null;
  readonly placed_by_broker_id: string | null;
  readonly placed_by_broker_name: string | null;
  readonly status: HoldStatus;
  readonly position: number | null;
  readonly placed_at: Date;
  readonly live_since: Date | null;
  readonly lapses_at: Date | null;
  readonly charter_id: string | null;
}

/** A live hold is lapsed from its lapse instant on, including the instant itself. */
export function effectiveStatus(hold: HoldRow, now: Date): HoldStatus {
  if (hold.status === 'live' && hold.lapses_at !== null && now.getTime() >= hold.lapses_at.getTime()) {
    return 'lapsed';
  }
  return hold.status;
}

export function holdTaker(hold: HoldRow): string {
  return hold.placed_by_broker_name ?? hold.placed_by_member_name ?? 'Tidewright';
}

export function holdJson(hold: HoldRow, yachtSlug: string, now: Date): Record<string, unknown> {
  const status = effectiveStatus(hold, now);
  return {
    id: hold.id,
    yachtSlug,
    weekStart: hold.week_start,
    weekEnd: hold.week_end,
    clientName: hold.client_name,
    placedBy: {
      kind: hold.placed_by_broker_id === null ? 'member' : 'broker',
      name: holdTaker(hold),
    },
    status,
    position: status === 'waiting' ? hold.position : null,
    placedAt: toInstantString(hold.placed_at),
    liveSince: status === 'waiting' ? null : hold.live_since === null ? null : toInstantString(hold.live_since),
    lapsesAt: status === 'waiting' ? null : hold.lapses_at === null ? null : toInstantString(hold.lapses_at),
    charterId: hold.charter_id,
  };
}

/**
 * Settles one week in the database: lapses a live hold whose time is up and
 * moves the next hold in line up. The single place hold transitions happen.
 */
export async function settleWeek(
  client: PoolClient,
  yachtId: string,
  weekStart: string,
  now: Date,
): Promise<void> {
  const held = await txRows<HoldRow>(
    client,
    `SELECT * FROM holds WHERE yacht_id = $1 AND week_start = $2 AND status IN ('live','waiting')
      ORDER BY position NULLS FIRST, placed_at FOR UPDATE`,
    [yachtId, weekStart],
  );
  const live = held.find((hold) => hold.status === 'live');
  let liveGone = live === undefined;
  if (live !== undefined && effectiveStatus(live, now) === 'lapsed') {
    await client.query('UPDATE holds SET status = $2 WHERE id = $1', [live.id, 'lapsed']);
    liveGone = true;
  }
  if (!liveGone) return;
  const waiting = held
    .filter((hold) => hold.status === 'waiting')
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  if (waiting.length === 0) return;
  const next = waiting[0];
  await client.query(
    `UPDATE holds SET status = 'live', position = NULL, live_since = $2, lapses_at = $3 WHERE id = $1`,
    [next.id, now, new Date(now.getTime() + config.timers.holdSeconds * 1000)],
  );
  for (const [index, hold] of waiting.slice(1).entries()) {
    await client.query('UPDATE holds SET position = $2 WHERE id = $1', [hold.id, index + 1]);
  }
}

export interface WeekState {
  readonly status: WeekStatus;
  readonly liveHold: HoldRow | null;
  readonly waitingCount: number;
  readonly charterId: string | null;
}

export async function weekState(
  client: PoolClient,
  yachtId: string,
  weekStart: string,
): Promise<WeekState> {
  const charter = await txRows<{ id: string }>(
    client,
    'SELECT id FROM charters WHERE yacht_id = $1 AND week_start = $2',
    [yachtId, weekStart],
  );
  if (charter.length > 0) {
    return { status: 'booked', liveHold: null, waitingCount: 0, charterId: charter[0].id };
  }
  const held = await txRows<HoldRow>(
    client,
    `SELECT * FROM holds WHERE yacht_id = $1 AND week_start = $2 AND status IN ('live','waiting')`,
    [yachtId, weekStart],
  );
  const liveHold = held.find((hold) => hold.status === 'live') ?? null;
  const waitingCount = held.filter((hold) => hold.status === 'waiting').length;
  return {
    status: liveHold === null && waitingCount === 0 ? 'free' : 'held',
    liveHold,
    waitingCount,
    charterId: null,
  };
}

export interface PlaceHoldRequest {
  readonly workspaceId: string;
  readonly yachtId: string;
  readonly weekStart: string;
  readonly clientName: string;
  readonly queue: boolean;
  readonly memberId: string | null;
  readonly memberName: string | null;
  readonly brokerId: string | null;
  readonly brokerName: string | null;
}

/** The one place a hold is created, deciding live or waiting from the week's state. */
export async function placeHold(
  client: PoolClient,
  request: PlaceHoldRequest,
  now: Date,
): Promise<HoldRow> {
  await lockKey(client, 'week', request.yachtId, request.weekStart);
  await settleWeek(client, request.yachtId, request.weekStart, now);
  const state = await weekState(client, request.yachtId, request.weekStart);
  if (state.status === 'booked') throw conflict('week_booked');
  if (state.status === 'held' && !request.queue) {
    const live = state.liveHold as HoldRow;
    throw conflict('week_taken', {
      takenBy: holdTaker(live),
      takenAt: toInstantString(live.live_since as Date),
    });
  }
  const id = randomUUID();
  const live = state.status === 'free';
  const position = live ? null : state.waitingCount + 1;
  const inserted = await txRows<HoldRow>(
    client,
    `INSERT INTO holds (id, workspace_id, yacht_id, week_start, week_end, client_name,
        placed_by_member_id, placed_by_member_name, placed_by_broker_id, placed_by_broker_name,
        status, position, placed_at, live_since, lapses_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      id,
      request.workspaceId,
      request.yachtId,
      request.weekStart,
      weekEndOf(request.weekStart),
      request.clientName,
      request.memberId,
      request.memberName,
      request.brokerId,
      request.brokerName,
      live ? 'live' : 'waiting',
      position,
      now,
      live ? now : null,
      live ? new Date(now.getTime() + config.timers.holdSeconds * 1000) : null,
    ],
  );
  return inserted[0];
}

/** Refuses any action on a hold that is not live, with the published refusal. */
export function requireLiveHold(hold: HoldRow, now: Date): void {
  const status = effectiveStatus(hold, now);
  if (status === 'lapsed') {
    throw conflict('hold_lapsed', { lapsedAt: toInstantString(hold.lapses_at as Date) });
  }
  if (status !== 'live') throw conflict('hold_not_live', { status });
}

export async function releaseHold(client: PoolClient, hold: HoldRow, now: Date): Promise<HoldRow> {
  await lockKey(client, 'week', hold.yacht_id, hold.week_start);
  await settleWeek(client, hold.yacht_id, hold.week_start, now);
  const current = (
    await txRows<HoldRow>(client, 'SELECT * FROM holds WHERE id = $1 FOR UPDATE', [hold.id])
  )[0];
  const status = effectiveStatus(current, now);
  if (status === 'lapsed') {
    throw conflict('hold_lapsed', { lapsedAt: toInstantString(current.lapses_at as Date) });
  }
  if (status !== 'live' && status !== 'waiting') throw conflict('hold_not_live', { status });
  const released = await txRows<HoldRow>(
    client,
    `UPDATE holds SET status = 'released', position = NULL WHERE id = $1 RETURNING *`,
    [current.id],
  );
  if (status === 'waiting') {
    const waiting = await txRows<HoldRow>(
      client,
      `SELECT * FROM holds WHERE yacht_id = $1 AND week_start = $2 AND status = 'waiting'
        ORDER BY position`,
      [current.yacht_id, current.week_start],
    );
    for (const [index, other] of waiting.entries()) {
      await client.query('UPDATE holds SET position = $2 WHERE id = $1', [other.id, index + 1]);
    }
  } else {
    await settleWeek(client, current.yacht_id, current.week_start, now);
  }
  return released[0];
}

export interface WeekSummary {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly status: WeekStatus;
  readonly season: string;
  readonly weeklyRateMinor: number;
  readonly currency: string;
  readonly liveHoldId: string | null;
  readonly waitingCount: number;
}

export async function weekSummaries(
  yachtId: string,
  weekStarts: readonly string[],
  rateFor: (season: string) => bigint,
  currency: string,
  now: Date,
): Promise<WeekSummary[]> {
  const charters = await query<{ week_start: string }>(
    'SELECT week_start FROM charters WHERE yacht_id = $1',
    [yachtId],
  );
  const booked = new Set(charters.map((charter) => charter.week_start));
  const held = await query<HoldRow>(
    `SELECT * FROM holds WHERE yacht_id = $1 AND status IN ('live','waiting')`,
    [yachtId],
  );
  return weekStarts.map((weekStart) => {
    const season = seasonOf(weekStart);
    const weekHolds = held.filter((hold) => hold.week_start === weekStart);
    const live = weekHolds.find((hold) => effectiveStatus(hold, now) === 'live') ?? null;
    const waitingCount = weekHolds.filter((hold) => hold.status === 'waiting').length;
    const status: WeekStatus = booked.has(weekStart)
      ? 'booked'
      : live !== null || waitingCount > 0
        ? 'held'
        : 'free';
    return {
      weekStart,
      weekEnd: weekEndOf(weekStart),
      status,
      season,
      weeklyRateMinor: Number(rateFor(season)),
      currency,
      liveHoldId: live === null ? null : live.id,
      waitingCount,
    };
  });
}
