import type { Queryable } from '../db.js';
import type { League, ResourceAmounts } from '../../shared/types.js';
import { localDayStart, localWeekStart, nextLocalDayStart, nextLocalWeekStart } from './localtime.js';

export type RewardKind = 'daily' | 'weekly';

export const DAILY_CHESTS: readonly ResourceAmounts[] = [
  { brine: 300, peat: 300, copper: 0 },
  { brine: 400, peat: 400, copper: 0 },
  { brine: 500, peat: 500, copper: 20 },
  { brine: 600, peat: 600, copper: 30 },
  { brine: 700, peat: 700, copper: 40 },
  { brine: 800, peat: 800, copper: 50 },
  { brine: 1000, peat: 1000, copper: 100 }
];

export const LEAGUE_BONUSES: Record<League, ResourceAmounts> = {
  Mudflat: { brine: 1000, peat: 1000, copper: 0 },
  Shingle: { brine: 2000, peat: 2000, copper: 50 },
  Saltmarsh: { brine: 3000, peat: 3000, copper: 100 },
  Tidewall: { brine: 5000, peat: 5000, copper: 300 }
};

const DAILY_MINIMUM_GAP_MS = 20 * 3_600_000;
const WEEKLY_MINIMUM_GAP_MS = 144 * 3_600_000;

export type RewardClaim = {
  claimedAt: Date;
  timeZone: string;
  periodStart: Date;
  periodEnd: Date;
  step: number | null;
  league: League | null;
};

export async function lastClaim(
  client: Queryable,
  accountId: number,
  kind: RewardKind
): Promise<RewardClaim | null> {
  const { rows } = await client.query<{
    claimed_at: Date;
    time_zone: string;
    period_start: Date;
    period_end: Date;
    step: number | null;
    league: string | null;
  }>(
    `SELECT claimed_at, time_zone, period_start, period_end, step, league
       FROM reward_claims
      WHERE account_id = $1 AND kind = $2
      ORDER BY claimed_at DESC, id DESC
      LIMIT 1`,
    [accountId, kind]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    claimedAt: row.claimed_at,
    timeZone: row.time_zone,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    step: row.step,
    league: row.league as League | null
  };
}

export function nextClaimAt(kind: RewardKind, claim: RewardClaim, savedZone: string): Date {
  if (claim.timeZone === savedZone) return claim.periodEnd;
  if (kind === 'daily') {
    const firstDayStart = nextLocalDayStart(savedZone, claim.claimedAt);
    return new Date(
      Math.max(firstDayStart.getTime(), claim.claimedAt.getTime() + DAILY_MINIMUM_GAP_MS)
    );
  }
  const firstWeekStart = nextLocalWeekStart(savedZone, claim.claimedAt);
  return new Date(
    Math.max(firstWeekStart.getTime(), claim.claimedAt.getTime() + WEEKLY_MINIMUM_GAP_MS)
  );
}

export function streakDeadline(savedZone: string, opensAt: Date): Date {
  return nextLocalDayStart(savedZone, opensAt);
}

export function stepAfter(claim: RewardClaim | null, savedZone: string, at: Date): number {
  if (claim === null || claim.step === null) return 1;
  const deadline = streakDeadline(savedZone, nextClaimAt('daily', claim, savedZone));
  if (at.getTime() >= deadline.getTime()) return 1;
  return (claim.step % 7) + 1;
}

export function chestFor(step: number): ResourceAmounts {
  return DAILY_CHESTS[step - 1] ?? DAILY_CHESTS[0] ?? { brine: 0, peat: 0, copper: 0 };
}

export function dailyPeriod(zone: string, at: Date): { start: Date; end: Date } {
  return { start: localDayStart(zone, at), end: nextLocalDayStart(zone, at) };
}

export function weeklyPeriod(zone: string, at: Date): { start: Date; end: Date } {
  return { start: localWeekStart(zone, at), end: nextLocalWeekStart(zone, at) };
}

export async function recordClaim(
  client: Queryable,
  accountId: number,
  kind: RewardKind,
  claim: { at: Date; zone: string; period: { start: Date; end: Date }; step: number | null; league: League | null }
): Promise<void> {
  await client.query(
    `INSERT INTO reward_claims
       (account_id, kind, claimed_at, time_zone, period_start, period_end, step, league)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      accountId,
      kind,
      claim.at.toISOString(),
      claim.zone,
      claim.period.start.toISOString(),
      claim.period.end.toISOString(),
      claim.step,
      claim.league
    ]
  );
}
