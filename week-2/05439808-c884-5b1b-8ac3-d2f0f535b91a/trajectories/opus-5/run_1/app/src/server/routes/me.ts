import type { Queryable } from '../db.js';
import { takeLock } from '../db.js';
import { fail, notFound } from '../http/errors.js';
import { checkFields, FieldErrors, readDisplayName, readTimeZone } from '../http/validate.js';
import { sessionRoute, type Route } from '../http/route.js';
import { leagueFor } from '../../shared/types.js';
import { findAccountById, normaliseEmail, villageIdOf } from '../domain/accounts.js';
import { pendingInvitationsFor } from '../domain/clans.js';
import { meView } from '../domain/presenters.js';
import { applyLapsedRaids, starBonusUsed, STAR_BONUS_CAP } from '../domain/raids.js';
import {
  chestFor,
  dailyPeriod,
  lastClaim,
  LEAGUE_BONUSES,
  nextClaimAt,
  recordClaim,
  stepAfter,
  streakDeadline,
  weeklyPeriod
} from '../domain/rewards.js';
import { creditCapped, loadIsland, type Island } from '../domain/village.js';

async function ownIsland(client: Queryable, accountId: number, at: Date): Promise<Island> {
  const villageId = await villageIdOf(client, accountId);
  if (villageId === null) notFound();
  await takeLock(client, 'village', villageId);
  await applyLapsedRaids(client, at);
  const island = await loadIsland(client, villageId, at);
  if (island === null) notFound();
  return island;
}

export const meRoutes: Route[] = [
  sessionRoute('GET', '/api/me', async (ctx, client) => ({
    status: 200,
    body: await meView(client, ctx.account)
  })),

  sessionRoute('PATCH', '/api/me', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, ['displayName', 'timeZone'], [], errors);
    const displayName =
      ctx.body.displayName === undefined ? null : readDisplayName(ctx.body, errors);
    const timeZone = ctx.body.timeZone === undefined ? null : readTimeZone(ctx.body, errors);
    errors.throwIfAny();
    await client.query(
      `UPDATE accounts
          SET display_name = COALESCE($2, display_name),
              time_zone = COALESCE($3, time_zone)
        WHERE id = $1`,
      [ctx.account.id, displayName, timeZone]
    );
    const updated = await findAccountById(client, ctx.account.id);
    if (updated === null) notFound();
    return { status: 200, body: await meView(client, updated) };
  }),

  sessionRoute('GET', '/api/me/invitations', async (ctx, client) => {
    if (!ctx.account.verified) return { status: 200, body: { invitations: [] } };
    const invitations = await pendingInvitationsFor(
      client,
      normaliseEmail(ctx.account.email)
    );
    return {
      status: 200,
      body: {
        invitations: invitations.map((invitation) => ({
          id: invitation.id,
          clan: { id: invitation.clanId, name: invitation.clanName },
          invitedBy: { displayName: invitation.inviterName }
        }))
      }
    };
  }),

  sessionRoute('GET', '/api/me/rewards', async (ctx, client) => {
    const zone = ctx.account.timeZone;
    const daily = await lastClaim(client, ctx.account.id, 'daily');
    const weekly = await lastClaim(client, ctx.account.id, 'weekly');
    const dayPeriod = dailyPeriod(zone, ctx.now);
    const weekPeriod = weeklyPeriod(zone, ctx.now);
    const dailyNext = daily === null ? null : nextClaimAt('daily', daily, zone);
    const weeklyNext = weekly === null ? null : nextClaimAt('weekly', weekly, zone);
    const dailyClaimed = dailyNext !== null && ctx.now.getTime() < dailyNext.getTime();
    const weeklyClaimed = weeklyNext !== null && ctx.now.getTime() < weeklyNext.getTime();
    const deadline = dailyNext === null ? null : streakDeadline(zone, dailyNext);
    const streak =
      daily !== null && deadline !== null && ctx.now.getTime() < deadline.getTime()
        ? (daily.step ?? 0)
        : 0;
    const league = leagueFor(ctx.account.trophies);
    const villageId = await villageIdOf(client, ctx.account.id);
    const used =
      villageId === null ? 0 : await starBonusUsed(client, villageId, zone, ctx.now);
    return {
      status: 200,
      body: {
        serverTime: ctx.now.toISOString(),
        timeZone: zone,
        daily: {
          periodStart: dayPeriod.start.toISOString(),
          periodEnd: dayPeriod.end.toISOString(),
          claimed: dailyClaimed,
          nextClaimAt: dailyClaimed && dailyNext !== null ? dailyNext.toISOString() : null,
          streak,
          streakEndsAt: streak === 0 || deadline === null ? null : deadline.toISOString(),
          chest: chestFor(streak === 0 ? 1 : (streak % 7) + 1)
        },
        weekly: {
          periodStart: weekPeriod.start.toISOString(),
          periodEnd: weekPeriod.end.toISOString(),
          claimed: weeklyClaimed,
          nextClaimAt: weeklyClaimed && weeklyNext !== null ? weeklyNext.toISOString() : null,
          league,
          bonus: LEAGUE_BONUSES[league]
        },
        starBonus: { used, cap: STAR_BONUS_CAP, periodEnd: dayPeriod.end.toISOString() }
      }
    };
  }),

  sessionRoute('POST', '/api/me/rewards/daily', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    await takeLock(client, 'account', ctx.account.id);
    const zone = ctx.account.timeZone;
    const claim = await lastClaim(client, ctx.account.id, 'daily');
    if (claim !== null) {
      const opensAt = nextClaimAt('daily', claim, zone);
      if (ctx.now.getTime() < opensAt.getTime()) {
        fail('already_claimed', { nextClaimAt: opensAt.toISOString() });
      }
    }
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    const step = stepAfter(claim, zone, ctx.now);
    const split = await creditCapped(client, island, chestFor(step), 'daily_chest', ctx.now);
    const period = dailyPeriod(zone, ctx.now);
    await recordClaim(client, ctx.account.id, 'daily', {
      at: ctx.now,
      zone,
      period,
      step,
      league: null
    });
    return {
      status: 200,
      body: {
        credited: split.credited,
        lost: split.lost,
        streak: step,
        nextClaimAt: period.end.toISOString()
      }
    };
  }),

  sessionRoute('POST', '/api/me/rewards/weekly', async (ctx, client) => {
    const errors = new FieldErrors();
    checkFields(ctx.body, [], [], errors);
    errors.throwIfAny();
    await takeLock(client, 'account', ctx.account.id);
    const zone = ctx.account.timeZone;
    const claim = await lastClaim(client, ctx.account.id, 'weekly');
    if (claim !== null) {
      const opensAt = nextClaimAt('weekly', claim, zone);
      if (ctx.now.getTime() < opensAt.getTime()) {
        fail('already_claimed', { nextClaimAt: opensAt.toISOString() });
      }
    }
    const island = await ownIsland(client, ctx.account.id, ctx.now);
    const league = leagueFor(ctx.account.trophies);
    const split = await creditCapped(
      client,
      island,
      LEAGUE_BONUSES[league],
      'league_bonus',
      ctx.now
    );
    const period = weeklyPeriod(zone, ctx.now);
    await recordClaim(client, ctx.account.id, 'weekly', {
      at: ctx.now,
      zone,
      period,
      step: null,
      league
    });
    return {
      status: 200,
      body: {
        credited: split.credited,
        lost: split.lost,
        league,
        nextClaimAt: period.end.toISOString()
      }
    };
  })
];
