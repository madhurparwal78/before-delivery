/** Grading routes: they exist only behind GRADING_KEY, and create state only through the same paths play uses. */
import { MODES, TIERS, type Currency, type Mode } from '../shared/domain';
import type { Group, Phase, Rack, Seat, ShotOutcome } from '../shared/rules';
import { insertPlayer } from './auth';
import { config } from './config';
import { transaction, type Db } from './db';
import { notFound, validationFailed } from './errors';
import { openRoute, type GuestContext, type Json } from './http';
import { SYSTEM, balance, lockPlayer, wallet, writePair } from './ledger';
import { notifyPlayer } from './realtime';
import { openRoom, seatFor } from './tables';

function guard({ headers }: GuestContext): void {
  if (config.gradingKey === null || headers['x-grading-key'] !== config.gradingKey) throw notFound();
}

async function openingLine(client: Db, playerId: string, amount: number, currency: Currency): Promise<void> {
  if (amount > 0) await writePair(client, { from: SYSTEM, to: wallet(playerId), amount, currency, kind: 'opening_balance', refId: playerId });
}

async function adjust(client: Db, playerId: string, target: number, currency: Currency): Promise<void> {
  const difference = target - (await balance(client, playerId, currency));
  if (difference > 0) await writePair(client, { from: SYSTEM, to: wallet(playerId), amount: difference, currency, kind: 'grading_adjustment', refId: playerId });
  if (difference < 0) await writePair(client, { from: wallet(playerId), to: SYSTEM, amount: -difference, currency, kind: 'grading_adjustment', refId: playerId });
}

interface TablePlan {
  mode: Mode;
  tier: number;
  players: string[];
  activeSeat: Seat;
  phase: Phase;
  groups: Record<string, Group> | null;
  balls: number[];
  script: ShotOutcome[];
}

function isTablePlan(body: Json): body is Json & TablePlan {
  return MODES.includes(body.mode as Mode)
    && TIERS.some(({ tier }) => tier === body.tier)
    && Array.isArray(body.players) && body.players.length === 2
    && (body.activeSeat === 1 || body.activeSeat === 2)
    && ['break', 'open', 'groups'].includes(body.phase as Phase)
    && Array.isArray(body.balls) && body.balls.every(Number.isInteger)
    && Array.isArray(body.script);
}

function tableRack(plan: TablePlan): Rack {
  return {
    mode: plan.mode,
    phase: plan.phase,
    groups: { 1: plan.groups?.['1'] ?? null, 2: plan.groups?.['2'] ?? null },
    balls: plan.balls,
    activeSeat: plan.activeSeat,
    ballInHand: false,
    behindHeadString: false,
  };
}

export function registerGradingRoutes(): void {
  openRoute('POST', '/api/grading/players', async (context) => {
    guard(context);
    const { body } = context;
    const id = await transaction(async (client) => {
      const playerId = await insertPlayer(client, {
        email: String(body.email),
        password: String(body.password),
        displayName: String(body.displayName),
        birthYear: Number(body.birthYear),
        level: Number(body.level ?? 1),
        xp: Number(body.xp ?? 0),
        emailVerified: body.emailVerified === true,
      });
      await openingLine(client, playerId, Number(body.coins ?? 0), 'coins');
      await openingLine(client, playerId, Number(body.cash ?? 0), 'cash');
      const weeklyWins = Number(body.weeklyWins ?? 0);
      if (weeklyWins > 0) {
        await client.query(
          `INSERT INTO weekly_wins (player_id, week_start, wins, last_win_at) VALUES ($1, date_trunc('week', now() AT TIME ZONE 'UTC')::date, $2, now())`,
          [playerId, weeklyWins],
        );
      }
      return playerId;
    });
    return { status: 201, body: { id } };
  }, { body: true });

  openRoute('PATCH', '/api/grading/players/{id}', async (context) => {
    guard(context);
    const { body, params } = context;
    const balances = await transaction(async (client) => {
      const found = await client.query('SELECT 1 FROM players WHERE id::text = $1', [params.id]);
      if (found.rows.length === 0) throw notFound();
      await lockPlayer(client, params.id);
      if (typeof body.coins === 'number') await adjust(client, params.id, body.coins, 'coins');
      if (typeof body.cash === 'number') await adjust(client, params.id, body.cash, 'cash');
      return { coins: await balance(client, params.id, 'coins'), cash: await balance(client, params.id, 'cash') };
    });
    notifyPlayer(params.id);
    return { status: 200, body: balances };
  }, { body: true });

  openRoute('POST', '/api/grading/tables', async (context) => {
    guard(context);
    const { body } = context;
    if (!isTablePlan(body)) throw validationFailed({ table: 'Send a mode, tier, two players, phase, balls and script.' });
    const { players, mode, tier, script } = body;
    const room = await transaction(async (client) => {
      const seats = [await seatFor(client, players[0], null), await seatFor(client, players[1], null)];
      return openRoom(client, { kind: 'stake', mode, tier, seats, rack: tableRack(body), script });
    });
    players.forEach(notifyPlayer);
    return { status: 201, body: { tableId: room.id, tableUrl: `/table/${room.id}` } };
  }, { body: true });
}
