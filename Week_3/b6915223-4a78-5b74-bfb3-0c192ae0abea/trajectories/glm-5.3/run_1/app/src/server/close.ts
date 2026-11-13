import * as pg from 'pg';
import type { BroadcastHub } from './hub';
import { ApiError } from './errors';
import { applyAutosubs, seasonHalfOf } from './rules';
import { rawPointsFromEvents } from './squadView';
import { GAMEWEEK_COUNT, type ChipCode, type Position } from '../shared/domain';
import { queueNotices } from './noticeOutbox';
import { readStatus, openNextGameweek, writeSnapshotsForGameweek } from './gameweeks';
import type { StorageClient } from './storage';

export interface CloseResult {
  number: number;
  status: 'closed';
  next_gameweek: number | null;
}

export async function closeGameweek(
  pool: pg.Pool,
  storage: StorageClient,
  hub: BroadcastHub,
  gameweek: number,
): Promise<CloseResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM gameweeks WHERE number = $1 FOR UPDATE',
      [gameweek],
    );
    if (rows.length === 0 || rows[0].status !== 'live') {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'gameweek_not_live', `Gameweek ${gameweek} is not live.`);
    }

    const events = await client.query<{
      event_id: string;
      player_id: string;
      type: string;
      value: number | null;
      voided: boolean;
      fixture_id: string;
    }>('SELECT event_id, player_id, type, value, voided, fixture_id FROM events WHERE gameweek = $1', [gameweek]);
    const playersRows = await client.query<{ id: string; name: string; club: string; position: Position; price_tenths: number }>(
      'SELECT id, name, club, position, price_tenths FROM players',
    );
    const playerMap = new Map(playersRows.rows.map((row) => [row.id, row]));
    const raw = rawPointsFromEvents(
      events.rows.map((row) => ({
        event_id: row.event_id,
        gameweek,
        fixture_id: row.fixture_id,
        player_id: row.player_id,
        type: row.type,
        value: row.value,
        points_delta: 0,
        voided: row.voided,
        recorded_at: new Date(),
      })),
      playerMap,
    );

    const squads = await client.query<{ manager_id: string; team_name: string; pocketbase_id: string; bank_tenths: number }>(
      `SELECT sm.manager_id, m.team_name, m.pocketbase_id, sm.bank_tenths
         FROM squad_meta sm JOIN managers m ON m.id = sm.manager_id`,
    );

    const notices: Parameters<typeof queueNotices>[1] = [];

    for (const squad of squads.rows) {
      const pick = await client.query<{ starting: string[]; bench: string[]; captain: string | null; vice_captain: string | null }>(
        'SELECT starting, bench, captain, vice_captain FROM picks WHERE manager_id = $1 AND gameweek = $2',
        [squad.manager_id, gameweek],
      );
      if (pick.rows.length === 0) continue;
      const chip = await client.query<{ chip: string }>(
        'SELECT chip FROM chips WHERE manager_id = $1 AND gameweek = $2 AND cancelled = false',
        [squad.manager_id, gameweek],
      );
      const activeChip = (chip.rows[0]?.chip ?? null) as ChipCode | null;

      let starting = pick.rows[0].starting;
      let bench = pick.rows[0].bench;
      const captain = pick.rows[0].captain;
      const viceCaptain = pick.rows[0].vice_captain;

      const auto = applyAutosubs(starting, bench, captain ?? '', viceCaptain ?? '', playerMap, raw.played, activeChip === 'bench_boost');
      const scoredStarters = starting.map((id) => (auto.subs.some((sub) => sub.out === id) ? auto.subs.find((sub) => sub.out === id)!.in : id));

      let multiplierOwner = captain;
      if (auto.captainFallbackTo !== null) multiplierOwner = viceCaptain;

      const rawPointsOf = (id: string) => raw.perPlayer.get(id) ?? 0;
      const multiplier = activeChip === 'triple_captain' ? 3 : 2;
      let teamPoints = 0;
      const scoringIds = activeChip === 'bench_boost' ? [...scoredStarters, ...bench] : scoredStarters;
      for (const id of scoringIds) {
        const isMultiplier = id === multiplierOwner;
        teamPoints += rawPointsOf(id) * (isMultiplier ? multiplier : 1);
      }

      const hitRows = await client.query<{ hit_points: number }>(
        'SELECT hit_points FROM hits WHERE manager_id = $1 AND gameweek = $2',
        [squad.manager_id, gameweek],
      );
      const hit = hitRows.rows[0]?.hit_points ?? 0;
      const net = teamPoints - hit;

      await client.query(
        `INSERT INTO gameweek_scores (manager_id, gameweek, points, hit_points, net_points, captain, vice_captain)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (manager_id, gameweek) DO UPDATE SET points = EXCLUDED.points`,
        [squad.manager_id, gameweek, teamPoints, hit, net, multiplierOwner, viceCaptain],
      );

      for (const sub of auto.subs) {
        notices.push({
          manager_id: squad.manager_id,
          pocketbase_user_id: squad.pocketbase_id,
          kind: 'auto_sub',
          gameweek,
          message: `${playerMap.get(sub.in)?.name ?? sub.in} came on for ${playerMap.get(sub.out)?.name ?? sub.out} in gameweek ${gameweek}.`,
        });
      }
      if (auto.captainFallbackTo !== null) {
        notices.push({
          manager_id: squad.manager_id,
          pocketbase_user_id: squad.pocketbase_id,
          kind: 'auto_sub',
          gameweek,
          message: `${playerMap.get(viceCaptain ?? '')?.name ?? viceCaptain} took the armband in gameweek ${gameweek}.`,
        });
      }

      if (activeChip === 'free_hit') {
        await revertFreeHit(client, squad.manager_id, gameweek);
      }
      void starting;
      void bench;
    }

    await queueNotices(client, notices);
    await client.query(`UPDATE gameweeks SET status = 'closed' WHERE number = $1`, [gameweek]);
    const next = gameweek + 1;
    if (next <= GAMEWEEK_COUNT) {
      await client.query(`UPDATE gameweeks SET status = 'open' WHERE number = $1 AND status = 'upcoming'`, [next]);
    }
    await client.query('COMMIT');
    hub.broadcastToManagers({ gameweekStatus: await readStatus(pool, gameweek), history: { gameweek } });
    return { number: gameweek, status: 'closed', next_gameweek: next <= GAMEWEEK_COUNT ? next : null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function revertFreeHit(client: pg.PoolClient, managerId: string, gameweek: number): Promise<void> {
  const state = await client.query<{ squad: unknown; picks: unknown; bank_tenths: number }>(
    'SELECT squad, picks, bank_tenths FROM free_hit_states WHERE manager_id = $1 AND gameweek = $2',
    [managerId, gameweek],
  );
  if (state.rows.length === 0) return;
  const beforeSquad = state.rows[0].squad as { player_id: string; purchase_price_tenths: number }[];
  const beforePicks = state.rows[0].picks as { starting: string[]; bench: string[]; captain: string | null; vice_captain: string | null };
  const bankBefore = state.rows[0].bank_tenths;

  const transfers = await client.query<{ id: string; out_player: string; in_player: string; sell_price_tenths: number; price_tenths: number }>(
    'SELECT id, out_player, in_player, sell_price_tenths, price_tenths FROM transfers WHERE manager_id = $1 AND gameweek = $2',
    [managerId, gameweek],
  );
  for (const transfer of transfers.rows) {
    await client.query(
      `INSERT INTO ledger_entries (id, manager_id, kind, amount_tenths, player_id, transfer_id, reverses, gameweek)
       VALUES ($1, $2, 'reversal', $3, $4, $5, NULL, $6)`,
      [`l_${randomHex()}`, managerId, -transfer.sell_price_tenths, transfer.out_player, transfer.id, gameweek],
    );
    await client.query(
      `INSERT INTO ledger_entries (id, manager_id, kind, amount_tenths, player_id, transfer_id, reverses, gameweek)
       VALUES ($1, $2, 'reversal', $3, $4, $5, NULL, $6)`,
      [`l_${randomHex()}`, managerId, transfer.price_tenths, transfer.in_player, transfer.id, gameweek],
    );
  }

  await client.query('DELETE FROM squad_players WHERE manager_id = $1', [managerId]);
  for (const entry of beforeSquad) {
    await client.query(
      'INSERT INTO squad_players (manager_id, player_id, purchase_price_tenths) VALUES ($1, $2, $3)',
      [managerId, entry.player_id, entry.purchase_price_tenths],
    );
  }
  await client.query('DELETE FROM squad_meta WHERE manager_id = $1', [managerId]);
  await client.query(
    'INSERT INTO squad_meta (manager_id, bank_tenths, free_transfers, transfers_made) VALUES ($1, $2, $3, $4)',
    [managerId, bankBefore, 1, 0],
  );
  await client.query('DELETE FROM picks WHERE manager_id = $1 AND gameweek = $2', [managerId, gameweek]);
  await client.query(
    'INSERT INTO picks (manager_id, gameweek, starting, bench, captain, vice_captain) VALUES ($1, $2, $3, $4, $5, $6)',
    [managerId, gameweek, beforePicks.starting, beforePicks.bench, beforePicks.captain, beforePicks.vice_captain],
  );
}

function randomHex(): string {
  return Math.random().toString(16).slice(2, 14);
}
