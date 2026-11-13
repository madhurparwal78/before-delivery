import type { Db, PoolClient } from './db.js';
import type { Ctx } from './http.js';
import { sendJson } from './http.js';
import { ApiError, errors } from './errors.js';
import { copy } from './copy.js';
import { hashPassword } from './password.js';
import { id as newId, friendCode, randomToken } from './util.js';
import { writePair, walletBalance } from './ledger.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';
import type { Mode, PocketName } from '../shared/types.js';
import { tierById } from '../shared/game.js';
import { MatchService } from './matches.js';
import { rackFor } from './rules/rack.js';
import type { Ball } from './rules/physics.js';
import { refreshCachedBalances } from './auth.js';

export interface GradingDeps {
  db: Db;
  matches: MatchService;
  onMeChange: (playerId: string) => void;
}

interface ScriptEntry {
  firstContact: number | null;
  pocketed: { ball: number; pocket: PocketName }[];
  cushion: boolean;
  scratch: boolean;
  offTable: number[];
}

async function refreshCachedBalancesTx(client: PoolClient, playerId: string): Promise<void> {
  const coins = await walletBalance(client, playerId, 'coins');
  const cash = await walletBalance(client, playerId, 'cash');
  await client.query(`UPDATE players SET coins = $2, cash = $3 WHERE id = $1`, [playerId, coins, cash]);
}

export function requireGradingKey(ctx: Ctx, gradingKey: string | null): boolean {
  return gradingKey !== null && ctx.req.headers['x-grading-key'] === gradingKey;
}

export async function createGradingPlayer(deps: GradingDeps, ctx: Ctx): Promise<void> {
  const body = ctx.body as {
    email?: string; password?: string; displayName?: string; birthYear?: number;
    level?: number; xp?: number; coins?: number; cash?: number; emailVerified?: boolean; weeklyWins?: number;
  };
  const email = body.email ?? '';
  const password = body.password ?? '';
  const displayName = body.displayName ?? '';
  const birthYear = body.birthYear ?? 1990;
  const level = body.level ?? 1;
  const xp = body.xp ?? 0;
  const coins = body.coins ?? 1000;
  const cash = body.cash ?? 0;
  const verified = body.emailVerified ?? true;
  const weeklyWins = body.weeklyWins ?? 0;

  const playerId = newId('player');
  await deps.db.tx(async (client) => {
    const existing = await client.query(`SELECT id FROM players WHERE email = $1 AND deleted_at IS NULL`, [email]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw new ApiError(409, 'email_taken', copy.emailTaken);
    }
    await client.query(
      `INSERT INTO players (id, email, password_hash, display_name, birth_year, minor, email_verified, level, xp,
         coins, cash, weekly_wins, friend_code, settings, verify_token)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,NULL)`,
      [playerId, email, hashPassword(password), displayName, birthYear, verified, level, xp, coins, cash, weeklyWins, friendCode(), JSON.stringify(DEFAULT_SETTINGS)]
    );
    await client.query(`INSERT INTO item_owners (player_id, item_id) VALUES ($1,'cue-starter'), ($1,'cloth-hall-blue') ON CONFLICT DO NOTHING`, [playerId]);
    await client.query(`UPDATE players SET equipped_cue_id = 'cue-starter', equipped_cloth_id = 'cloth-hall-blue' WHERE id = $1`, [playerId]);
    await writePair(client, {
      kind: 'opening_balance',
      refId: playerId,
      currency: 'coins',
      lines: [
        { playerId: null, currency: 'coins', account: 'system', amount: -coins },
        { playerId, currency: 'coins', account: 'wallet', amount: coins },
      ],
    });
    if (cash > 0) {
      await writePair(client, {
        kind: 'opening_balance',
        refId: playerId,
        currency: 'cash',
        lines: [
          { playerId: null, currency: 'cash', account: 'system', amount: -cash },
          { playerId, currency: 'cash', account: 'wallet', amount: cash },
        ],
      });
    }
  });
  await refreshCachedBalances(deps.db, playerId);
  sendJson(ctx, 201, { id: playerId });
}

export async function patchGradingPlayer(deps: GradingDeps, ctx: Ctx, playerId: string): Promise<void> {
  const body = ctx.body as { coins?: number; cash?: number };
  await deps.db.tx(async (client) => {
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    const player = (await client.query<{ coins: string; cash: string }>(`SELECT coins, cash FROM players WHERE id = $1`, [playerId])).rows[0];
    if (!player) throw errors.notFound();
    const targetCoins = body.coins !== undefined ? body.coins : Number(player.coins);
    const targetCash = body.cash !== undefined ? body.cash : Number(player.cash);
    const coinsNow = await walletBalance(client, playerId, 'coins');
    const cashNow = await walletBalance(client, playerId, 'cash');
    if (targetCoins !== coinsNow) {
      const delta = targetCoins - coinsNow;
      const source = delta > 0 ? 'system' : 'wallet';
      const dest = delta > 0 ? 'wallet' : 'system';
      await writePair(client, {
        kind: 'grading_adjustment',
        refId: playerId,
        currency: 'coins',
        lines: [
          { playerId: delta > 0 ? null : playerId, currency: 'coins', account: source, amount: -Math.abs(delta) },
          { playerId: delta > 0 ? playerId : null, currency: 'coins', account: dest, amount: Math.abs(delta) },
        ],
      });
    }
    if (targetCash !== cashNow) {
      const delta = targetCash - cashNow;
      const source = delta > 0 ? 'system' : 'wallet';
      const dest = delta > 0 ? 'wallet' : 'system';
      await writePair(client, {
        kind: 'grading_adjustment',
        refId: playerId,
        currency: 'cash',
        lines: [
          { playerId: delta > 0 ? null : playerId, currency: 'cash', account: source, amount: -Math.abs(delta) },
          { playerId: delta > 0 ? playerId : null, currency: 'cash', account: dest, amount: Math.abs(delta) },
        ],
      });
    }
    await refreshCachedBalancesTx(client, playerId);
  });
  const coins = await walletBalance(deps.db, playerId, 'coins');
  const cash = await walletBalance(deps.db, playerId, 'cash');
  deps.onMeChange(playerId);
  sendJson(ctx, 200, { coins, cash });
}

export async function createGradingTable(deps: GradingDeps, ctx: Ctx): Promise<void> {
  const body = ctx.body as {
    mode?: Mode; tier?: number; players?: string[]; activeSeat?: number;
    phase?: 'break' | 'open' | 'groups'; groups?: { 1?: string; 2?: string } | null;
    balls?: number[]; script?: ScriptEntry[];
  };
  const mode: Mode = body.mode ?? 'eight-ball';
  const tier = body.tier ?? 1;
  const players = body.players ?? [];
  const activeSeat = (body.activeSeat === 2 ? 2 : 1) as 1 | 2;
  const phase = body.phase ?? 'break';
  const groups = body.groups ?? null;
  const ballsList = body.balls ?? [];
  const script = body.script ?? null;

  const tierInfo = tierById(tier);

  const tableId = await deps.db.tx(async (client) => {
    for (const playerId of players) {
      const coins = await walletBalance(client, playerId, 'coins');
      if (coins < tierInfo.entry) {
        throw new ApiError(409, 'insufficient_coins', copy.refusedCoins);
      }
    }
    const id = newId('table');
    for (const playerId of players) {
      await writePair(client, {
        kind: 'match_entry',
        refId: id,
        currency: 'coins',
        lines: [
          { playerId, currency: 'coins', account: 'wallet', amount: -tierInfo.entry },
          { playerId, currency: 'coins', account: 'escrow', amount: tierInfo.entry },
        ],
      });
    }
    const cueBall = { number: 0, across: 50, along: 88 };
    const balls: Ball[] = [cueBall, ...ballsList.map((n) => ({ number: n, across: 50, along: 12 }))];
    if (ballsList.length === 0) {
      balls.length = 0;
      balls.push(...rackFor(mode));
    }
    const g1 = groups?.[1] === 'solids' || groups?.[1] === 'stripes' ? groups[1] : null;
    const g2 = groups?.[2] === 'solids' || groups?.[2] === 'stripes' ? groups[2] : null;
    await client.query(
      `INSERT INTO matches (id, mode, tier, kind, status, seat1_player, seat2_player, seat1_session, seat2_session,
         active_seat, phase, group_seat1, group_seat2, balls, cue_ball_across, cue_ball_along,
         shot_clock_seconds, entry, pot, script)
       VALUES ($1,$2,$3,'grading','in_play',$4,$5,NULL,NULL,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16::jsonb)`,
      [id, mode, tier, players[0] ?? null, players[1] ?? null, activeSeat, phase, g1, g2,
        JSON.stringify(balls), 50, 88, Number(process.env.SHOT_CLOCK_SECONDS ?? 30), tierInfo.entry, tierInfo.pot,
        script ? JSON.stringify(script) : null]
    );
    return id;
  });
  for (const playerId of players) {
    await refreshCachedBalances(deps.db, playerId);
    deps.onMeChange(playerId);
  }
  sendJson(ctx, 201, { tableId, tableUrl: `/table/${tableId}` });
}
