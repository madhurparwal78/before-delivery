import { LOYALTY_WINDOW_DAYS, REVIEW_HALF_LIFE_DAYS } from './config';
import { query } from './db';
import { TierName } from '../shared/types';

export interface Tier {
  name: TierName;
  pct: number;
  perks: string[];
}

export function tierOf(completedStays: number): Tier {
  if (completedStays >= 5) return { name: 'Kestrel', pct: 10, perks: ['perk.late', 'perk.drink'] };
  if (completedStays >= 2) return { name: 'Heron', pct: 5, perks: ['perk.late'] };
  return { name: 'Wren', pct: 0, perks: [] };
}

export function tierPct(name: TierName): number {
  if (name === 'Kestrel') return 10;
  if (name === 'Heron') return 5;
  return 0;
}

/** Completed stays of a user in the rolling 730 days up to the server clock. */
export async function completedStays(username: string | null, nowMs: number): Promise<number> {
  if (!username) return 0;
  const from = new Date(nowMs - LOYALTY_WINDOW_DAYS * 86400000).toISOString();
  const to = new Date(nowMs).toISOString();
  const rows = await query<{ n: string }>(
    `select count(distinct r.code) as n
     from booking_rooms r join bookings b on b.code = r.code
     where b.username = $1 and r.state = 'completed'
       and r.completed_at >= $2 and r.completed_at <= $3`,
    [username, from, to],
  );
  return Number(rows[0]?.n ?? 0);
}

/** The weighted property score; 6.0 with no published reviews. */
export async function propertyScore(property: string, nowMs: number): Promise<number> {
  const rows = await query<{ scores: number[]; created_at: string }>(
    `select scores, created_at from reviews where property = $1 and state = 'published'`,
    [property],
  );
  if (rows.length === 0) return 6.0;
  let weighted = 0;
  let weights = 0;
  for (const row of rows) {
    const value = row.scores.reduce((sum, s) => sum + s, 0) / row.scores.length;
    const ageDays = Math.floor((nowMs - new Date(row.created_at).getTime()) / 86400000);
    const weight = Math.pow(0.5, ageDays / REVIEW_HALF_LIFE_DAYS);
    weighted += weight * value;
    weights += weight;
  }
  const x = weighted / weights;
  return Math.floor(x * 10 + 0.5 + 1e-9) / 10;
}

export async function propertyScores(codes: string[], nowMs: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const code of codes) out.set(code, await propertyScore(code, nowMs));
  return out;
}
