import { query, type Tx } from '../db.js';
import { newId } from '../ids.js';
import { conflict } from '../http/errors.js';
import { toIsoInstant } from '../../shared/zone.js';
import type { OptionRecord, OptionState } from '../../shared/types.js';

export type OptionRow = {
  id: string;
  talent_id: string;
  client_id: string;
  job_date: string;
  job_title: string;
  note: string | null;
  rank: number | null;
  last_rank: number | null;
  state: OptionState;
  auto_release_at: Date;
  hold_until: Date | null;
  hold_until_local: string | null;
  release_at: Date;
  challenge_deadline: Date | null;
  challenged_by_option_id: string | null;
  placed_by: string;
  placed_by_name: string;
  placed_at: Date;
  saved_by_name: string;
  saved_at: Date;
  released_at: Date | null;
  release_reason: string | null;
  booking_id: string | null;
  version: number;
  feed_sequence: number;
};

export type OptionWithClient = OptionRow & { client_company: string };

const SELECT_OPTION = `
  SELECT o.*, c.company AS client_company
  FROM options o JOIN clients c ON c.id = o.client_id`;

export function optionView(row: OptionWithClient): OptionRecord {
  return {
    id: row.id,
    talentId: row.talent_id,
    clientId: row.client_id,
    clientCompany: row.client_company,
    date: row.job_date,
    jobTitle: row.job_title,
    note: row.note,
    rank: row.rank,
    state: row.state,
    autoReleaseAt: toIsoInstant(row.auto_release_at.getTime()),
    holdUntil: row.hold_until ? toIsoInstant(row.hold_until.getTime()) : null,
    holdUntilLocal: row.hold_until_local,
    releaseAt: toIsoInstant(row.release_at.getTime()),
    challengeDeadline: row.challenge_deadline ? toIsoInstant(row.challenge_deadline.getTime()) : null,
    placedBy: { id: row.placed_by, name: row.placed_by_name },
    placedAt: toIsoInstant(row.placed_at.getTime()),
    releasedAt: row.released_at ? toIsoInstant(row.released_at.getTime()) : null,
    releaseReason: (row.release_reason ?? null) as OptionRecord['releaseReason'],
    version: row.version,
  };
}

const LIVE_STATES: OptionState[] = ['placed', 'challenged'];

export async function findOption(id: string): Promise<OptionWithClient | null> {
  const rows = await query<OptionWithClient>(`${SELECT_OPTION} WHERE o.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function optionsBetween(
  talentId: string,
  fromDate: string,
  toDate: string,
): Promise<OptionWithClient[]> {
  return query<OptionWithClient>(
    `${SELECT_OPTION} WHERE o.talent_id = $1 AND o.job_date >= $2 AND o.job_date <= $3
     ORDER BY o.job_date, o.rank NULLS LAST, o.placed_at`,
    [talentId, fromDate, toDate],
  );
}

export async function optionsOfTalent(talentId: string): Promise<OptionWithClient[]> {
  return query<OptionWithClient>(`${SELECT_OPTION} WHERE o.talent_id = $1 ORDER BY o.job_date`, [talentId]);
}

/** Serialises every change to one talent-day so ranks stay distinct and gapless. */
export async function lockDay(tx: Tx, talentId: string, date: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${talentId}:${date}`]);
}

export async function dayOptions(tx: Tx, talentId: string, date: string): Promise<OptionWithClient[]> {
  return tx.query<OptionWithClient>(
    `${SELECT_OPTION} WHERE o.talent_id = $1 AND o.job_date = $2 ORDER BY o.rank NULLS LAST, o.placed_at`,
    [talentId, date],
  );
}

export async function liveDayOptions(tx: Tx, talentId: string, date: string): Promise<OptionWithClient[]> {
  const options = await dayOptions(tx, talentId, date);
  return options.filter((option) => LIVE_STATES.includes(option.state));
}

/** Ranks the day's live options 1, 2, 3 in placement order, with no gaps. */
export async function reRank(tx: Tx, talentId: string, date: string): Promise<void> {
  const live = await tx.query<{ id: string; rank: number | null }>(
    `SELECT id, rank FROM options
     WHERE talent_id = $1 AND job_date = $2 AND state IN ('placed', 'challenged')
     ORDER BY placed_at, id`,
    [talentId, date],
  );
  await tx.query(
    `UPDATE options SET rank = NULL
     WHERE talent_id = $1 AND job_date = $2 AND state IN ('placed', 'challenged')`,
    [talentId, date],
  );
  for (let index = 0; index < live.length; index += 1) {
    const option = live[index];
    const rank = index + 1;
    if (option.rank === rank) {
      await tx.query('UPDATE options SET rank = $2 WHERE id = $1', [option.id, rank]);
      continue;
    }
    await tx.query(
      `UPDATE options SET rank = $2, version = version + 1, feed_sequence = feed_sequence + 1 WHERE id = $1`,
      [option.id, rank],
    );
  }
  await clearOrphanedChallenges(tx, talentId, date);
}

/** A challenged 1st returns to placed once the challenging 2nd leaves the ladder. */
async function clearOrphanedChallenges(tx: Tx, talentId: string, date: string): Promise<void> {
  await tx.query(
    `UPDATE options SET state = 'placed', challenge_deadline = NULL, challenged_by_option_id = NULL,
            version = version + 1, feed_sequence = feed_sequence + 1
     WHERE talent_id = $1 AND job_date = $2 AND state = 'challenged'
       AND (challenged_by_option_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM options challenger
              WHERE challenger.id = options.challenged_by_option_id
                AND challenger.state IN ('placed', 'challenged')))`,
    [talentId, date],
  );
}

export type InsertOptionInput = {
  talentId: string;
  clientId: string;
  date: string;
  jobTitle: string;
  note: string | null;
  holdUntilMs: number | null;
  holdUntilLocal: string | null;
  autoReleaseMs: number;
  rank: number;
  placedBy: string;
  placedByName: string;
  nowMs: number;
};

export async function insertOption(tx: Tx, input: InsertOptionInput): Promise<OptionWithClient> {
  const id = newId('opt');
  await tx.query(
    `INSERT INTO options (
       id, talent_id, client_id, job_date, job_title, note, rank, state,
       auto_release_at, hold_until, hold_until_local, placed_by, placed_by_name, placed_at,
       saved_by_name, saved_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'placed', $8, $9, $10, $11, $12, $13, $12, $13)`,
    [
      id,
      input.talentId,
      input.clientId,
      input.date,
      input.jobTitle,
      input.note,
      input.rank,
      new Date(input.autoReleaseMs),
      input.holdUntilMs === null ? null : new Date(input.holdUntilMs),
      input.holdUntilLocal,
      input.placedBy,
      input.placedByName,
      new Date(input.nowMs),
    ],
  );
  const rows = await tx.query<OptionWithClient>(`${SELECT_OPTION} WHERE o.id = $1`, [id]);
  return rows[0];
}

/** Every illegal transition answers its published conflict, checked in one order. */
export function refuseWhenNotLive(option: OptionWithClient, booking: {
  bookedBy: string | null;
  bookedAt: Date | null;
  bookingId: string | null;
}): void {
  if (option.state === 'confirmed') {
    throw conflict('already_booked', {
      bookedBy: booking.bookedBy,
      bookedAt: booking.bookedAt ? toIsoInstant(booking.bookedAt.getTime()) : null,
      bookingId: booking.bookingId,
    });
  }
  if (option.state === 'released' || option.state === 'expired') {
    throw conflict('option_released', {
      releasedAt: option.released_at ? toIsoInstant(option.released_at.getTime()) : null,
    });
  }
}

export function refuseWhenChallengeExpired(option: OptionWithClient, nowMs: number): void {
  if (
    option.state === 'challenged'
    && option.challenge_deadline
    && nowMs >= option.challenge_deadline.getTime()
  ) {
    throw conflict('challenge_expired', {
      challengeDeadline: toIsoInstant(option.challenge_deadline.getTime()),
    });
  }
}

export async function markReleased(
  tx: Tx,
  optionId: string,
  reason: 'manual' | 'challenge_timeout' | 'day_booked' | 'hold_expired' | 'auto_release',
  nowMs: number,
): Promise<void> {
  await tx.query(
    `UPDATE options SET state = 'released', last_rank = coalesce(rank, last_rank), rank = NULL,
            released_at = $2, release_reason = $3,
            challenge_deadline = NULL, challenged_by_option_id = NULL,
            version = version + 1, feed_sequence = feed_sequence + 1
     WHERE id = $1`,
    [optionId, new Date(nowMs), reason],
  );
}

export async function markExpired(
  tx: Tx,
  optionId: string,
  reason: 'hold_expired' | 'auto_release',
  nowMs: number,
): Promise<void> {
  await tx.query(
    `UPDATE options SET state = 'expired', last_rank = coalesce(rank, last_rank), rank = NULL,
            released_at = $2, release_reason = $3,
            challenge_deadline = NULL, challenged_by_option_id = NULL,
            version = version + 1, feed_sequence = feed_sequence + 1
     WHERE id = $1`,
    [optionId, new Date(nowMs), reason],
  );
}

export async function startChallenge(
  tx: Tx,
  firstOptionId: string,
  challengerId: string,
  deadlineMs: number,
): Promise<void> {
  await tx.query(
    `UPDATE options SET state = 'challenged', challenge_deadline = $2, challenged_by_option_id = $3,
            version = version + 1, feed_sequence = feed_sequence + 1
     WHERE id = $1`,
    [firstOptionId, new Date(deadlineMs), challengerId],
  );
}

/** A new closure date moves the automatic release of every future hold of that office. */
export async function recomputeAutoReleases(
  office: string,
  compute: (jobDate: string) => number,
  nowMs: number,
): Promise<void> {
  const rows = await query<{ id: string; job_date: string }>(
    `SELECT o.id, o.job_date FROM options o
     JOIN talent t ON t.id = o.talent_id
     WHERE t.office_id = $1 AND o.state IN ('placed', 'challenged') AND o.auto_release_at > $2`,
    [office, new Date(nowMs)],
  );
  for (const row of rows) {
    await query(
      `UPDATE options SET auto_release_at = $2, version = version + 1, feed_sequence = feed_sequence + 1
       WHERE id = $1`,
      [row.id, new Date(compute(row.job_date))],
    );
  }
}
