// The one token-bucket decision.
import { query } from './db';

const CAPACITY = 8;
const REFILL_SECONDS = 15;

export interface BucketState {
  level: number;
  retryAfterSeconds: number | null;
}

export async function readBucket(gameId: string, playerId: string): Promise<BucketState> {
  const result = await query<{ tokens: string }>(
    'SELECT GREATEST(0, LEAST($3, tokens + EXTRACT(EPOCH FROM (now() - last_refill)) / $4)) AS tokens FROM buckets WHERE game_id=$1 AND player_id=$2',
    [gameId, playerId, CAPACITY, REFILL_SECONDS],
  );
  if (result.rows.length === 0) return { level: CAPACITY, retryAfterSeconds: null };
  const level = Math.min(CAPACITY, Number(result.rows[0].tokens));
  if (level >= 1) return { level: Math.floor(level), retryAfterSeconds: null };
  return { level: Math.floor(level), retryAfterSeconds: Math.max(1, Math.ceil((1 - level) * REFILL_SECONDS)) };
}

export async function takeToken(gameId: string, playerId: string): Promise<{ ok: boolean; previous: number; level: number; retryAfterSeconds: number | null }> {
  const advanced = `
    UPDATE buckets
       SET tokens = GREATEST(0, tokens - 1),
           last_refill = now()
     WHERE game_id = $1 AND player_id = $2
       AND GREATEST(0, LEAST($3, tokens + EXTRACT(EPOCH FROM (now() - last_refill)) / $4)) >= 1
     RETURNING tokens, GREATEST(0, LEAST($3, tokens + EXTRACT(EPOCH FROM (now() - last_refill)) / $4)) AS before`;
  const attempt = await query<{ tokens: string; before: string }>(advanced, [gameId, playerId, CAPACITY, REFILL_SECONDS]);
  if (attempt.rows.length === 0) {
    const state = await readBucket(gameId, playerId);
    return { ok: false, previous: state.level, level: state.level, retryAfterSeconds: state.retryAfterSeconds ?? 1 };
  }
  const remaining = Number(attempt.rows[0].tokens);
  const previous = Math.floor(Number(attempt.rows[0].before));
  return { ok: true, previous, level: Math.floor(remaining), retryAfterSeconds: null };
}

export function bucketCapacity(): number {
  return CAPACITY;
}

export function refillSeconds(): number {
  return REFILL_SECONDS;
}

