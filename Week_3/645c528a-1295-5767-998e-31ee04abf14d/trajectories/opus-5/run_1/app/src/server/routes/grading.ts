import { randomUUID } from 'node:crypto';
import { STARTER_CLOTH_ID, STARTER_CUE_ID, tierOf } from '../../shared/catalog.js';
import { requiresCalledPocket } from '../../shared/referee.js';
import type { Group, MatchState, Mode, Phase, Seat, ShotOutcome } from '../../shared/types.js';
import { config } from '../config.js';
import { query, queryOne, transaction } from '../db.js';
import { ApiError } from '../errors.js';
import { objectBody, type Ctx, type Router } from '../http.js';
import { credit, writePair } from '../ledger.js';
import { hashPassword, newFriendCode, weekStart } from '../players.js';
import { createMatchRow, escrowEntries, publishPlayer, scriptedPositions } from '../tables.js';

function assertGradingKey(ctx: Ctx): void {
  if (!config.gradingKey) throw ApiError.notFound();
  const header = ctx.req.headers['x-grading-key'];
  if (header !== config.gradingKey) throw ApiError.notFound();
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function registerGradingRoutes(router: Router): void {
  router.post('/api/grading/players', async (ctx: Ctx) => {
    assertGradingKey(ctx);
    const body = objectBody(ctx);
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const displayName = String(body.displayName ?? '').trim();
    const birthYear = numberOr(body.birthYear, 1990);
    const level = numberOr(body.level, 1);
    const xp = numberOr(body.xp, 0);
    const coins = numberOr(body.coins, 0);
    const cash = numberOr(body.cash, 0);
    const weeklyWins = numberOr(body.weeklyWins, 0);
    const emailVerified = body.emailVerified === true;
    const minor = new Date().getUTCFullYear() - birthYear < 18;
    const id = randomUUID();
    const passwordHash = await hashPassword(password);

    await transaction(async (client) => {
      const friendCode = await newFriendCode(client);
      await client.query(
        `INSERT INTO players (id, email, password_hash, display_name, birth_year, level, xp, coins, cash, email_verified,
            minor, weekly_wins, week_start, equipped_cue_id, equipped_cloth_id, friend_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,$8,$9,$10,$11::date,$12,$13,$14)`,
        [
          id,
          email,
          passwordHash,
          displayName,
          birthYear,
          level,
          xp,
          emailVerified,
          minor,
          weeklyWins,
          weekStart(),
          STARTER_CUE_ID,
          STARTER_CLOTH_ID,
          friendCode,
        ],
      );
      await client.query(`INSERT INTO player_items (player_id, item_id) VALUES ($1,$2), ($1,$3)`, [id, STARTER_CUE_ID, STARTER_CLOTH_ID]);
      if (coins > 0) await credit(client, id, 'coins', coins, 'opening_balance', null);
      if (cash > 0) await credit(client, id, 'cash', cash, 'opening_balance', null);
    });
    return { status: 201, body: { id } };
  });

  router.patch('/api/grading/players/:id', async (ctx: Ctx) => {
    assertGradingKey(ctx);
    const id = ctx.params.id as string;
    const body = objectBody(ctx);
    const balances = await transaction(async (client) => {
      const current = await client.query<{ coins: string; cash: string }>(`SELECT coins, cash FROM players WHERE id = $1 FOR UPDATE`, [id]);
      const row = current.rows[0];
      if (!row) return null;
      for (const currency of ['coins', 'cash'] as const) {
        const wanted = body[currency];
        if (typeof wanted !== 'number') continue;
        const held = Number(currency === 'coins' ? row.coins : row.cash);
        const difference = wanted - held;
        if (difference === 0) continue;
        await writePair(client, {
          currency,
          kind: 'grading_adjustment',
          amount: Math.abs(difference),
          negative: difference > 0 ? { account: 'system', playerId: null } : { account: 'wallet', playerId: id },
          positive: difference > 0 ? { account: 'wallet', playerId: id } : { account: 'system', playerId: null },
          refId: null,
        });
      }
      const after = await client.query<{ coins: string; cash: string }>(`SELECT coins, cash FROM players WHERE id = $1`, [id]);
      const updated = after.rows[0];
      return updated ? { coins: Number(updated.coins), cash: Number(updated.cash) } : null;
    });
    if (!balances) throw ApiError.notFound('No such player.');
    publishPlayer(id);
    return { status: 200, body: balances };
  });

  router.post('/api/grading/tables', async (ctx: Ctx) => {
    assertGradingKey(ctx);
    const body = objectBody(ctx);
    const mode = (typeof body.mode === 'string' ? body.mode : 'eight-ball') as Mode;
    const tierNumber = numberOr(body.tier, 1);
    const tier = tierOf(tierNumber);
    const players = Array.isArray(body.players) ? body.players.map((value) => String(value)) : [];
    if (players.length !== 2) throw ApiError.validation({ players: 'Send two player ids.' });
    const activeSeat = (numberOr(body.activeSeat, 1) === 2 ? 2 : 1) as Seat;
    const phase = (typeof body.phase === 'string' ? body.phase : 'break') as Phase;
    const groupsInput = body.groups as Record<string, string> | null | undefined;
    const groups: { 1: Group; 2: Group } =
      phase === 'groups' && groupsInput
        ? { 1: (groupsInput['1'] as Group) ?? null, 2: (groupsInput['2'] as Group) ?? null }
        : { 1: null, 2: null };
    const balls = Array.isArray(body.balls) ? body.balls.map((value) => Number(value)) : [];
    const script = Array.isArray(body.script) ? (body.script as ShotOutcome[]) : [];

    const positions = scriptedPositions(balls, script[0]?.firstContact ?? null);
    const state: MatchState = {
      mode,
      phase,
      groups,
      balls,
      activeSeat,
      ballInHand: false,
      behindHeadString: false,
      calledPocketRequired: false,
      positions,
      over: false,
    };
    state.calledPocketRequired = requiresCalledPocket(state, activeSeat);

    for (const playerId of players) {
      const wallet = await queryOne<{ coins: string }>(`SELECT coins FROM players WHERE id = $1`, [playerId]);
      if (!wallet) throw ApiError.notFound('No such player.');
      if (Number(wallet.coins) < tier.entry) {
        throw new ApiError(409, 'insufficient_coins', 'Not enough Coins for this table.');
      }
    }

    const match = await transaction(async (client) => {
      const created = await createMatchRow({
        mode,
        tier: tier.tier,
        kind: 'stake',
        seat1: players[0] ?? null,
        seat2: players[1] ?? null,
        status: 'in_play',
        entry: tier.entry,
        pot: tier.pot,
        script,
        state,
        client,
      });
      await escrowEntries(client, created.id, players, tier.entry, 'match_entry');
      return created;
    });
    for (const playerId of players) publishPlayer(playerId);
    await query(`UPDATE queue_tickets SET status = 'cancelled' WHERE player_id = ANY($1::uuid[]) AND status = 'queued'`, [players]);
    return { status: 201, body: { tableId: match.id, tableUrl: `/table/${match.id}` } };
  });
}
