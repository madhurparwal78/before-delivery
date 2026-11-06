// The daily chest with its 7-step streak, the weekly tide-league bonus and the star-bonus readout.
import type { Amounts, League } from '../shared/catalog';
import { leagueFor } from './accounts';
import { iso, now } from './clock';
import { tx, type Db } from './db';
import { fail } from './errors';
import { sessionRoute, type Account } from './http';
import { creditCapped, type Island } from './island';
import { STAR_BONUS_CAP, starredRaidsToday } from './raids';
import { Fields } from './validate';
import { ownIsland } from './village';
import { localDay, localWeek, nextDayStart, nextWeekStart } from './zones';

const HOUR = 3600000;
const DAILY_REOPEN_MIN = 20 * HOUR;
const WEEKLY_REOPEN_MIN = 144 * HOUR;

const CHEST: Record<number, Amounts> = {
  1: { brine: 300, peat: 300, copper: 0 },
  2: { brine: 400, peat: 400, copper: 0 },
  3: { brine: 500, peat: 500, copper: 20 },
  4: { brine: 600, peat: 600, copper: 30 },
  5: { brine: 700, peat: 700, copper: 40 },
  6: { brine: 800, peat: 800, copper: 50 },
  7: { brine: 1000, peat: 1000, copper: 100 },
};

const LEAGUE_BONUS: Record<League, Amounts> = {
  Mudflat: { brine: 1000, peat: 1000, copper: 0 },
  Shingle: { brine: 2000, peat: 2000, copper: 50 },
  Saltmarsh: { brine: 3000, peat: 3000, copper: 100 },
  Tidewall: { brine: 5000, peat: 5000, copper: 300 },
};

interface Claim {
  claimed_at: number;
  time_zone: string;
  step: number | null;
}

/** When the next daily claim opens after `last`, for an islander now saved in `zone`. */
function nextDailyAt(last: Claim, zone: string): number {
  if (zone === last.time_zone) return localDay(last.claimed_at, last.time_zone).end;
  return Math.max(nextDayStart(last.claimed_at, zone), last.claimed_at + DAILY_REOPEN_MIN);
}

/** When the next league claim opens after `last`, for an islander now saved in `zone`. */
function nextWeeklyAt(last: Claim, zone: string): number {
  if (zone === last.time_zone) return localWeek(last.claimed_at, last.time_zone).end;
  return Math.max(nextWeekStart(last.claimed_at, zone), last.claimed_at + WEEKLY_REOPEN_MIN);
}

/** The streak deadline: the end of the local day (saved zone) containing the next-claim instant. */
function streakDeadline(last: Claim, zone: string): number {
  return localDay(nextDailyAt(last, zone), zone).end;
}

/** The step a claim at `at` reaches. */
function streakStep(last: Claim | null, zone: string, at: number): number {
  if (last === null || at >= streakDeadline(last, zone)) return 1;
  return ((last.step as number) % 7) + 1;
}

async function lastClaim(db: Db, accountId: number, kind: 'daily' | 'weekly'): Promise<Claim | null> {
  const { rows } = await db.query<Claim>(
    'SELECT claimed_at, time_zone, step FROM reward_claims WHERE account_id = $1 AND kind = $2 ORDER BY claimed_at DESC, id DESC LIMIT 1',
    [accountId, kind],
  );
  return rows[0] ?? null;
}

async function freshAccount(db: Db, accountId: number): Promise<{ timeZone: string; trophies: number }> {
  const { rows } = await db.query<{ time_zone: string; trophies: number }>('SELECT time_zone, trophies FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
  const row = rows[0] as { time_zone: string; trophies: number };
  return { timeZone: row.time_zone, trophies: row.trophies };
}

async function rewardsView(db: Db, account: Account, island: Island, at: number): Promise<Record<string, unknown>> {
  const { timeZone: zone, trophies } = await freshAccount(db, account.id);
  const daily = await lastClaim(db, account.id, 'daily');
  const weekly = await lastClaim(db, account.id, 'weekly');
  const dailyNext = daily === null ? null : nextDailyAt(daily, zone);
  const weeklyNext = weekly === null ? null : nextWeeklyAt(weekly, zone);
  const deadline = daily === null ? null : streakDeadline(daily, zone);
  const streak = daily !== null && deadline !== null && at < deadline ? (daily.step as number) : 0;
  const dailyClaimed = dailyNext !== null && at < dailyNext;
  const weeklyClaimed = weeklyNext !== null && at < weeklyNext;
  const day = localDay(at, zone);
  const week = localWeek(at, zone);
  const league = leagueFor(trophies);
  return {
    serverTime: iso(at),
    timeZone: zone,
    daily: {
      periodStart: iso(day.start),
      periodEnd: iso(day.end),
      claimed: dailyClaimed,
      nextClaimAt: dailyClaimed ? iso(dailyNext as number) : null,
      streak,
      streakEndsAt: streak > 0 ? iso(deadline as number) : null,
      chest: CHEST[(streak % 7) + 1],
    },
    weekly: {
      periodStart: iso(week.start),
      periodEnd: iso(week.end),
      claimed: weeklyClaimed,
      nextClaimAt: weeklyClaimed ? iso(weeklyNext as number) : null,
      league,
      bonus: LEAGUE_BONUS[league],
    },
    starBonus: {
      used: Math.min(STAR_BONUS_CAP, await starredRaidsToday(db, island.villageId, zone, at)),
      cap: STAR_BONUS_CAP,
      periodEnd: iso(day.end),
    },
  };
}

export async function readRewards(db: Db, account: Account): Promise<Record<string, unknown>> {
  const at = now();
  return rewardsView(db, account, await ownIsland(db, account, at), at);
}

sessionRoute('GET', '/api/me/rewards', async (ctx) => ({ status: 200, body: await tx((db) => readRewards(db, ctx.account)) }));

sessionRoute('POST', '/api/me/rewards/daily', async (ctx) => {
  const body = await tx(async (db) => {
    const at = now();
    const island = await ownIsland(db, ctx.account, at);
    new Fields(ctx.body, []).done();
    const { timeZone: zone } = await freshAccount(db, ctx.account.id);
    const last = await lastClaim(db, ctx.account.id, 'daily');
    if (last !== null && at < nextDailyAt(last, zone)) fail('already_claimed', { nextClaimAt: iso(nextDailyAt(last, zone)) });
    const step = streakStep(last, zone, at);
    const { credited, lost } = await creditCapped(db, island, CHEST[step] as Amounts, 'daily_chest', at);
    await db.query("INSERT INTO reward_claims (account_id, kind, claimed_at, time_zone, step) VALUES ($1, 'daily', $2, $3, $4)", [ctx.account.id, at, zone, step]);
    return { credited, lost, streak: step, nextClaimAt: iso(nextDailyAt({ claimed_at: at, time_zone: zone, step }, zone)) };
  });
  return { status: 200, body };
});

sessionRoute('POST', '/api/me/rewards/weekly', async (ctx) => {
  const body = await tx(async (db) => {
    const at = now();
    const island = await ownIsland(db, ctx.account, at);
    new Fields(ctx.body, []).done();
    const { timeZone: zone, trophies } = await freshAccount(db, ctx.account.id);
    const last = await lastClaim(db, ctx.account.id, 'weekly');
    if (last !== null && at < nextWeeklyAt(last, zone)) fail('already_claimed', { nextClaimAt: iso(nextWeeklyAt(last, zone)) });
    const league = leagueFor(trophies);
    const { credited, lost } = await creditCapped(db, island, LEAGUE_BONUS[league], 'league_bonus', at);
    await db.query("INSERT INTO reward_claims (account_id, kind, claimed_at, time_zone, league) VALUES ($1, 'weekly', $2, $3, $4)", [ctx.account.id, at, zone, league]);
    return { credited, lost, league, nextClaimAt: iso(nextWeeklyAt({ claimed_at: at, time_zone: zone, step: null }, zone)) };
  });
  return { status: 200, body };
});
