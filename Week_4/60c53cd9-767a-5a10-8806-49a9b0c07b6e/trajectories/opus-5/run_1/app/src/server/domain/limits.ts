/** The hold-attempt, re-hold cooldown and search rate limits, all decided in Postgres. */

import type { PoolClient } from 'pg';
import { query, queryOne, type Db } from '../db';
import { now } from '../clock';
import { config, HOLD_ATTEMPT_LIMIT } from '../config';

function secondsUntil(instant: Date): number {
  return Math.max(1, Math.ceil((instant.getTime() - now().getTime()) / 1000));
}

export interface LimitDecision {
  refused: boolean;
  retryAfterSeconds: number;
}

/**
 * Counts one anonymous search against the client address over a sliding 60
 * second window. Rejected requests are counted too.
 */
export async function countSearchRequest(db: Db, clientAddress: string): Promise<LimitDecision> {
  const at = now();
  const windowStart = new Date(at.getTime() - 60_000);
  const before = await query<{ hit_at: Date }>(
    db,
    'select hit_at from search_rate_hits where client_address = $1 and hit_at > $2 order by hit_at',
    [clientAddress, windowStart],
  );
  await query(db, 'insert into search_rate_hits (client_address, hit_at) values ($1, $2)', [clientAddress, at]);
  if (before.length < config.searchRateLimit) return { refused: false, retryAfterSeconds: 0 };

  const inWindow = [...before.map((row) => row.hit_at), at];
  const mustExpire = inWindow.length - (config.searchRateLimit - 1);
  const releasing = inWindow[mustExpire - 1];
  return { refused: true, retryAfterSeconds: secondsUntil(new Date(releasing.getTime() + 60_000)) };
}

export async function cleanSearchRateHits(db: Db): Promise<void> {
  await query(db, 'delete from search_rate_hits where hit_at < $1', [new Date(now().getTime() - 120_000)]);
}

/**
 * Counts one hold attempt, or refuses when the window is already full. Only
 * counted attempts are recorded, so a refusal never fills the window further.
 */
export async function countHoldAttempt(client: PoolClient, accountId: string): Promise<LimitDecision> {
  const at = now();
  const windowStart = new Date(at.getTime() - config.holdAttemptWindowSeconds * 1000);
  const attempts = await query<{ attempted_at: Date }>(
    client,
    'select attempted_at from hold_attempts where account_id = $1 and attempted_at > $2 order by attempted_at',
    [accountId, windowStart],
  );
  if (attempts.length >= HOLD_ATTEMPT_LIMIT) {
    const oldest = attempts[0].attempted_at;
    return {
      refused: true,
      retryAfterSeconds: secondsUntil(new Date(oldest.getTime() + config.holdAttemptWindowSeconds * 1000)),
    };
  }
  await query(client, 'insert into hold_attempts (account_id, attempted_at) values ($1, $2)', [accountId, at]);
  return { refused: false, retryAfterSeconds: 0 };
}

/**
 * When this buyer's own hold on this unit ended by release or lapse, the moment
 * they may hold it again. Withdrawal and conversion never start a cooldown.
 */
export async function reHoldCooldownUntil(db: Db, accountId: string, unitCode: string): Promise<Date | null> {
  const row = await queryOne<{ ended_at: Date }>(
    db,
    `select ended_at from holds
      where account_id = $1 and unit_code = $2 and ended_by in ('buyer', 'lapse') and ended_at is not null
      order by ended_at desc limit 1`,
    [accountId, unitCode],
  );
  if (!row) return null;
  const until = new Date(row.ended_at.getTime() + config.holdCooldownSeconds * 1000);
  return until.getTime() > now().getTime() ? until : null;
}
