import { limits } from '../config';
import { withTransaction, one } from '../db';

/** The one place bucket arithmetic lives. */

const CAPACITY = limits.bucketCapacity;
const REFILL_SECONDS = limits.bucketRefillSeconds;
const EPSILON = 1e-9;

export function levelAfterRefill(tokens: number, ageSeconds: number): number {
  return Math.min(CAPACITY, tokens + ageSeconds / REFILL_SECONDS);
}

export function wholeTokens(level: number): number {
  return Math.max(0, Math.floor(level + EPSILON));
}

export function retryAfterSeconds(level: number): number {
  return Math.max(1, Math.ceil((1 - level) * REFILL_SECONDS - EPSILON));
}

export interface BucketTake {
  taken: boolean;
  previous: number;
  level: number;
  capacity: number;
  retryAfterSeconds: number | null;
}

interface BucketRow {
  tokens: string | number;
  age: string | number;
}

function asNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

export async function takeToken(playerRowId: string): Promise<BucketTake> {
  return withTransaction(async (client) => {
    const result = await client.query<BucketRow>(
      `SELECT tokens, EXTRACT(EPOCH FROM (now() - updated_at)) AS age
         FROM buckets WHERE player_row_id = $1 FOR UPDATE`,
      [playerRowId],
    );
    const row = result.rows[0];
    const before = row ? levelAfterRefill(asNumber(row.tokens), asNumber(row.age)) : CAPACITY;
    if (before < 1) {
      return {
        taken: false,
        previous: wholeTokens(before),
        level: wholeTokens(before),
        capacity: CAPACITY,
        retryAfterSeconds: retryAfterSeconds(before),
      };
    }
    const after = before - 1;
    await client.query(
      `INSERT INTO buckets (player_row_id, tokens, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (player_row_id) DO UPDATE SET tokens = $2, updated_at = now()`,
      [playerRowId, after],
    );
    return {
      taken: true,
      previous: wholeTokens(before),
      level: wholeTokens(after),
      capacity: CAPACITY,
      retryAfterSeconds: null,
    };
  });
}

export async function readBucket(playerRowId: string): Promise<{
  level: number;
  capacity: number;
  retryAfterSeconds: number | null;
}> {
  const row = await one<BucketRow>(
    `SELECT tokens, EXTRACT(EPOCH FROM (now() - updated_at)) AS age FROM buckets WHERE player_row_id = $1`,
    [playerRowId],
  );
  const level = row ? levelAfterRefill(asNumber(row.tokens), asNumber(row.age)) : CAPACITY;
  const whole = wholeTokens(level);
  return {
    level: whole,
    capacity: CAPACITY,
    retryAfterSeconds: whole >= 1 ? null : retryAfterSeconds(level),
  };
}
