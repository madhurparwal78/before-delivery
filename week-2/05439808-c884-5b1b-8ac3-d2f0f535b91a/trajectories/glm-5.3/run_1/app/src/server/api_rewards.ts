// Rewards: the daily chest with its streak and the weekly tide-league bonus, claimed once per
// local day or local week in the islander's saved time zone.
import type { PoolClient } from 'pg';
import { errors } from './errors.ts';
import { route, type Ctx } from './http.ts';
import { getApp, withTransaction } from './runtime.ts';
import { lockVillage, loadIsland, type IslandState } from './island.ts';
import { creditCapped } from './ledger.ts';
import { DAILY_CHESTS, leagueBonus, leagueFor } from '../domain/catalog.ts';
import { dayStart, nextDayStart, nextWeekStart, weekStart } from '../domain/localtime.ts';

interface LastClaim {
  at: number;
  zone: string;
  step: number | null;
}

async function lastClaim(client: PoolClient, accountId: number, kind: 'daily' | 'weekly'): Promise<LastClaim | null> {
  const result = await client.query<{ at: string; zone: string; step: number | null }>(
    'SELECT at, zone, step FROM reward_claims WHERE account_id = $1 AND kind = $2 ORDER BY at DESC, id DESC LIMIT 1',
    [accountId, kind]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { at: Number(row.at), zone: row.zone, step: row.step === null ? null : Number(row.step) };
}

// The instant the next claim opens. When the saved zone has changed since the last claim, it is
// the later of the first local day (or Monday) start in the new zone strictly after the last
// claim, and 20 hours (or 6 days) after the last claim.
function dailyOpensAt(claim: LastClaim, currentZone: string): number {
  if (claim.zone === currentZone) return nextDayStart(claim.at, claim.zone);
  return Math.max(nextDayStart(claim.at, currentZone), claim.at + 20 * 3600 * 1000);
}

function weeklyOpensAt(claim: LastClaim, currentZone: string): number {
  if (claim.zone === currentZone) return nextWeekStart(claim.at, claim.zone);
  return Math.max(nextWeekStart(claim.at, currentZone), claim.at + 144 * 3600 * 1000);
}

async function claimFor(ctx: Ctx, kind: 'daily' | 'weekly'): Promise<unknown> {
  const app = getApp();
  const account = ctx.account!;
  const zone = account.timeZone;
  const lockVillageId = async (client: PoolClient): Promise<{ villageId: number; state: IslandState } | null> => {
    if (account.villageId === null) return null;
    const village = await lockVillage(client, account.villageId);
    if (!village) return null;
    const state = await loadIsland(client, account.villageId, ctx.now);
    return { villageId: account.villageId, state };
  };

  const outcome = await withTransaction(async (client) => {
    await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [account.id]);
    const claim = await lastClaim(client, account.id, kind);
    const opens = claim === null ? 0 : kind === 'daily' ? dailyOpensAt(claim, zone) : weeklyOpensAt(claim, zone);
    if (claim !== null && ctx.now < opens) {
      throw errors.conflict('already_claimed', kind === 'daily' ? 'Next chest at that time.' : 'Next league bonus at that time.', {
        nextClaimAt: new Date(opens).toISOString(),
      });
    }
    const island = await lockVillageId(client);
    if (!island) throw errors.notFound();

    let credited;
    let lost;
    let step: number | null = null;
    let bonusLeague: string | null = null;
    if (kind === 'daily') {
      // The streak deadline is the end of the local day that contains the instant the next claim opens.
      const deadline = claim === null ? 0 : nextDayStart(opens, zone);
      step = claim !== null && ctx.now < deadline ? (claim.step! % 7) + 1 : 1;
      const chest = DAILY_CHESTS[step - 1];
      ({ credited, lost } = await creditCapped(client, island.villageId, 'daily_chest', chest, island.state.balances, island.state.caps, ctx.now));
    } else {
      const league = leagueFor(island.state.village.trophies);
      bonusLeague = league;
      const bonus = leagueBonus(league);
      ({ credited, lost } = await creditCapped(client, island.villageId, 'league_bonus', bonus, island.state.balances, island.state.caps, ctx.now));
    }
    await client.query('INSERT INTO reward_claims (account_id, kind, at, zone, step) VALUES ($1, $2, $3, $4, $5)', [
      account.id, kind, ctx.now, zone, step,
    ]);
    const nextOpens = kind === 'daily' ? nextDayStart(ctx.now, zone) : nextWeekStart(ctx.now, zone);
    return { credited, lost, step, league: bonusLeague, nextClaimAt: new Date(nextOpens).toISOString() };
  });

  if (kind === 'daily') {
    return { credited: (outcome as { credited: unknown }).credited, lost: (outcome as { lost: unknown }).lost, streak: (outcome as { step: number }).step, nextClaimAt: (outcome as { nextClaimAt: string }).nextClaimAt };
  }
  return { credited: (outcome as { credited: unknown }).credited, lost: (outcome as { lost: unknown }).lost, league: (outcome as { league: string }).league, nextClaimAt: (outcome as { nextClaimAt: string }).nextClaimAt };
}

route('GET', '/api/me/rewards', 'session', async (ctx) => {
  const app = getApp();
  const account = ctx.account!;
  const zone = account.timeZone;
  const info = await withTransaction(async (client) => {
    const daily = await lastClaim(client, account.id, 'daily');
    const weekly = await lastClaim(client, account.id, 'weekly');
    const dailyOpens = daily === null ? 0 : dailyOpensAt(daily, zone);
    const weeklyOpens = weekly === null ? 0 : weeklyOpensAt(weekly, zone);
    const dailyDeadline = daily === null ? null : nextDayStart(dailyOpens, zone);
    const streak = daily !== null && dailyDeadline !== null && ctx.now < dailyDeadline ? daily.step! : 0;

    const villageId = account.villageId;
    let league: string = leagueFor(0);
    let starUsed = 0;
    if (villageId !== null) {
      const state = await loadIsland(client, villageId, ctx.now);
      league = leagueFor(state.village.trophies);
      const dayLo = dayStart(ctx.now, zone);
      const dayHi = nextDayStart(ctx.now, zone);
      const used = await client.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM raids WHERE attacker_village_id = $1 AND stars >= 1 AND resolved_at >= $2 AND resolved_at < $3`,
        [villageId, dayLo, dayHi]
      );
      starUsed = Number(used.rows[0].count);
    }
    return { daily, weekly, dailyOpens, weeklyOpens, dailyDeadline, streak, league, starUsed };
  });

  const chestStep = info.streak === 0 ? 1 : (info.streak % 7) + 1;
  return {
    status: 200,
    body: {
      serverTime: new Date(ctx.now).toISOString(),
      timeZone: zone,
      daily: {
        periodStart: new Date(dayStart(ctx.now, zone)).toISOString(),
        periodEnd: new Date(nextDayStart(ctx.now, zone)).toISOString(),
        claimed: info.daily !== null && ctx.now < info.dailyOpens,
        nextClaimAt: info.daily !== null && ctx.now < info.dailyOpens ? new Date(info.dailyOpens).toISOString() : null,
        streak: info.streak,
        streakEndsAt: info.streak > 0 && info.dailyDeadline !== null ? new Date(info.dailyDeadline).toISOString() : null,
        chest: DAILY_CHESTS[chestStep - 1],
      },
      weekly: {
        periodStart: new Date(weekStart(ctx.now, zone)).toISOString(),
        periodEnd: new Date(nextWeekStart(ctx.now, zone)).toISOString(),
        claimed: info.weekly !== null && ctx.now < info.weeklyOpens,
        nextClaimAt: info.weekly !== null && ctx.now < info.weeklyOpens ? new Date(info.weeklyOpens).toISOString() : null,
        league: info.league,
        bonus: leagueBonus(info.league as 'Mudflat' | 'Shingle' | 'Saltmarsh' | 'Tidewall'),
      },
      starBonus: {
        used: info.starUsed,
        cap: 5,
        periodEnd: new Date(nextDayStart(ctx.now, zone)).toISOString(),
      },
    },
  };
});

route('POST', '/api/me/rewards/daily', 'session', async (ctx) => {
  const body = ctx.body as Record<string, unknown>;
  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    const { exactFields, throwIfErrors } = await import('./validate.ts');
    throwIfErrors(exactFields(body, []));
  }
  return { status: 200, body: await claimFor(ctx, 'daily') };
});

route('POST', '/api/me/rewards/weekly', 'session', async (ctx) => {
  const body = ctx.body as Record<string, unknown>;
  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    const { exactFields, throwIfErrors } = await import('./validate.ts');
    throwIfErrors(exactFields(body, []));
  }
  return { status: 200, body: await claimFor(ctx, 'weekly') };
});

route('GET', '/api/me/invitations', 'session', async (ctx) => {
  const account = ctx.account!;
  if (!account.verified) return { status: 200, body: { invitations: [] } };
  const rows = await withTransaction((client) =>
    client.query(
      `SELECT i.id, c.id AS clan_id, c.name AS clan_name, a.display_name AS inviter_name
       FROM invitations i
       JOIN clans c ON c.id = i.clan_id
       JOIN accounts a ON a.id = i.invited_by
       WHERE i.email_lc = $1 AND i.status = 'pending' AND c.dissolved_at IS NULL
       ORDER BY i.id`,
      [account.email.toLowerCase()]
    )
  );
  return {
    status: 200,
    body: {
      invitations: rows.rows.map((r) => ({
        id: Number(r.id),
        clan: { id: Number(r.clan_id), name: r.clan_name },
        invitedBy: { displayName: r.inviter_name },
      })),
    },
  };
});
