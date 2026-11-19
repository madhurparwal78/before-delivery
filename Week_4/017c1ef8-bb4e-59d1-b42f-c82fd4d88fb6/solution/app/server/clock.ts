import { config, DAY_SECONDS, MONTH_SECONDS, WEEK_SECONDS } from './config.js';
import { maybeRow, type Db } from './db.js';
import { publish } from './live.js';

let offsetMs = 0;

/** The business clock: real time plus the stored offset. Every stored time and time rule reads it. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

/** `at` moved by `seconds` of business time. */
function shifted(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}

/** Where a window of `seconds` ending at `at` began: an event exactly that old no longer counts. */
function windowStart(at: Date, seconds: number): Date {
  return shifted(at, -seconds);
}

// The business-clock rules. Every window and expiry decision in the app is made by one of these.

/** A job is open while the business clock is before its closing instant. The SQL forms below are the same rule. */
export const jobIsOpen = (closesAt: Date, at: Date = now()): boolean => at.getTime() < closesAt.getTime();
export const openJobSql = (alias: string, nowParam: string): string => `${alias}.closes_at > ${nowParam}`;
/** Jobs that closed after the business time `previousParam` and by `currentParam`. */
export const closedBetweenSql = (alias: string, previousParam: string, currentParam: string): string =>
  `${alias}.closes_at > ${previousParam} AND ${alias}.closes_at <= ${currentParam}`;

/** Whether a post created at `createdAt` may still be edited at business time `at`. */
export const postIsEditable = (createdAt: Date, at: Date): boolean => at.getTime() < shifted(createdAt, config.editWindowSeconds).getTime();

/** The span of post creation times whose edit window closed after `previous` and by `current`. */
export function closedEditWindowCreations(previous: Date, current: Date): [Date, Date] {
  return [windowStart(previous, config.editWindowSeconds), windowStart(current, config.editWindowSeconds)];
}

/** When the cooldown after a withdrawal ends: the instant the same sender may invite the same member again. */
export const inviteCooldownEnd = (withdrawnAt: Date): Date => shifted(withdrawnAt, config.inviteCooldownSeconds);

/** Where the rolling week ending at `at` began: the weekly invitation limit and the hashtag page's weekly members. */
export const weekStart = (at: Date): Date => windowStart(at, WEEK_SECONDS);

/** A stored idempotency key replays its response for one day of business time. */
export const idempotencyKeyLive = (createdAt: Date, at: Date): boolean => createdAt.getTime() > windowStart(at, DAY_SECONDS).getTime();

/** Job search's Date posted filter keeps jobs posted at or after this instant. */
export const postedSince = (at: Date, posted: 'day' | 'week' | 'month'): Date =>
  windowStart(at, { day: DAY_SECONDS, week: WEEK_SECONDS, month: MONTH_SECONDS }[posted]);

export async function initClock(db: Db): Promise<void> {
  const stored = await maybeRow<{ offset_ms: number }>(db, 'SELECT offset_ms FROM clock WHERE id = 1');
  if (stored) {
    offsetMs = stored.offset_ms;
    return;
  }
  offsetMs = config.startAt ? config.startAt.getTime() - Date.now() : 0;
  await db.query('INSERT INTO clock (id, offset_ms) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [offsetMs]);
}

export async function moveClock(db: Db, to: Date): Promise<Date> {
  offsetMs = to.getTime() - Date.now();
  await db.query('UPDATE clock SET offset_ms = $1 WHERE id = 1', [offsetMs]);
  const moved = now();
  publish('all', { type: 'clock', now: moved.toISOString() });
  return moved;
}
