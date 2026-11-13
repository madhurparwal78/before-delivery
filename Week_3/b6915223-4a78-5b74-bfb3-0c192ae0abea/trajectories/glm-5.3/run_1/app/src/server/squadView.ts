import * as pg from 'pg';
import {
  CAPTAIN_MULTIPLIER,
  TRIPLE_CAPTAIN_MULTIPLIER,
  type ChipCode,
  type ChipState,
  type GameweekStatus,
  type Position,
} from '../shared/domain';
import { sellingPriceTenths, seasonHalfOf, chipStateFor, eventPoints } from './rules';
import {
  fetchCurrentGameweek as fetchCurrentGameweekFromPool,
  fetchEventsForGameweek,
  fetchPlayedChips,
  fetchSquadPlayers,
  fetchPick,
  fetchMeta,
  fetchActiveChip,
  type EventRowData,
  type GameweekRow,
} from './store';
import type { SquadView, SquadPlayerView } from '../shared/views';

export interface RawPointsMap {
  perPlayer: Map<string, number>;
  played: Set<string>;
}

type RawEvent = Pick<EventRowData, 'player_id' | 'type' | 'value' | 'voided' | 'fixture_id'>;

export function rawPointsFromEvents(
  events: RawEvent[],
  players: Map<string, { position: Position }>,
): RawPointsMap {
  const perPlayer = new Map<string, number>();
  const minutesByPlayerFixture = new Map<string, number>();
  const appearancePoints = new Map<string, number>();
  const played = new Set<string>();
  for (const event of events) {
    const position = players.get(event.player_id)?.position;
    if (position === undefined) continue;
    if (event.type === 'minutes') {
      const key = `${event.player_id}:${event.fixture_id}`;
      const previousBest = appearancePoints.get(key) ?? 0;
      const appearance = eventPoints('minutes', position, event.value);
      const previousMinutes = minutesByPlayerFixture.get(key) ?? 0;
      const delta = appearance - previousBest;
      perPlayer.set(event.player_id, (perPlayer.get(event.player_id) ?? 0) + delta);
      minutesByPlayerFixture.set(key, Math.max(previousMinutes, event.value ?? 0));
      appearancePoints.set(key, Math.max(previousBest, appearance));
      if ((event.value ?? 0) >= 1) played.add(event.player_id);
      continue;
    }
    const points = eventPoints(event.type as 'goal', position, event.value);
    perPlayer.set(event.player_id, (perPlayer.get(event.player_id) ?? 0) + points);
  }
  return { perPlayer, played };
}

export async function currentGameweekContext(pool: pg.Pool): Promise<{
  gameweek: number;
  status: GameweekStatus;
  deadline: Date | null;
} | null> {
  const current = await fetchCurrentGameweekFromPool(pool);
  if (current === null) return null;
  return { gameweek: current.number, status: current.status, deadline: current.deadline };
}

export async function buildSquadView(pool: pg.Pool, managerId: string): Promise<SquadView | null> {
  const client = await pool.connect();
  try {
    return await buildSquadViewWithClient(client, managerId);
  } finally {
    client.release();
  }
}

export async function buildSquadViewWithClient(client: pg.PoolClient, managerId: string): Promise<SquadView | null> {
  const { rows: currentRows } = await client.query<{ number: number; status: GameweekRow['status']; deadline: Date | null }>(
    `SELECT number, status, deadline FROM gameweeks
      WHERE status IN ('open', 'locked', 'live')
      ORDER BY number
      LIMIT 1`,
  );
  let current: GameweekRow | null = currentRows[0] ?? null;
  if (current === null) {
    const { rows } = await client.query<{ number: number; status: GameweekRow['status']; deadline: Date | null }>(
      `SELECT number, status, deadline FROM gameweeks WHERE status = 'closed' ORDER BY number DESC LIMIT 1`,
    );
    current = rows[0] ?? null;
  }
  if (current === null) return null;
  const meta = await fetchMeta(client, managerId);
  if (meta === null) return null;
  const squadPlayers = await fetchSquadPlayers(client, managerId);
  const playerRows = await client.query<{ id: string; name: string; club: string; position: Position; price_tenths: number }>(
    'SELECT id, name, club, position, price_tenths FROM players ORDER BY id',
  );
  const playerMap = new Map(playerRows.rows.map((row) => [row.id, row]));
  const pick = await fetchPick(client, managerId, current.number);
  const chip = await fetchActiveChip(client, managerId, current.number);
  const playedChips = await fetchPlayedChips(client, managerId);
  const events = await fetchEventsForGameweek(client, current.number);
  const raw = rawPointsFromEvents(events, playerMap);

  const starting = pick?.starting ?? [];
  const bench = pick?.bench ?? [];
  const captain = pick?.captain ?? null;
  const tripleCaptain = chip === 'triple_captain';
  const multiplier = tripleCaptain ? TRIPLE_CAPTAIN_MULTIPLIER : CAPTAIN_MULTIPLIER;

  const players: SquadPlayerView[] = squadPlayers.map((row) => {
    const info = playerMap.get(row.player_id);
    const isStarting = starting.includes(row.player_id);
    const benchIndex = bench.indexOf(row.player_id);
    const rawPoints = raw.perPlayer.get(row.player_id) ?? 0;
    const isCaptain = captain === row.player_id;
    const benchBoostCounts = chip === 'bench_boost';
    const counts = isStarting || benchBoostCounts;
    const teamPoints = counts ? rawPoints * (isCaptain ? multiplier : 1) : 0;
    return {
      id: row.player_id,
      name: info?.name ?? row.player_id,
      club: info?.club ?? '',
      position: (info?.position ?? 'GK') as Position,
      purchase_price_tenths: row.purchase_price_tenths,
      price_tenths: info?.price_tenths ?? row.purchase_price_tenths,
      selling_price_tenths: sellingPriceTenths(row.purchase_price_tenths, info?.price_tenths ?? row.purchase_price_tenths),
      slot: isStarting ? ('starting' as const) : ('bench' as const),
      bench_order: isStarting ? null : benchIndex + 1,
      captain: isCaptain,
      vice_captain: (pick?.vice_captain ?? null) === row.player_id,
      raw_points: rawPoints,
      team_points: teamPoints,
    };
  });

  const squadValue = players.reduce((sum, player) => sum + player.selling_price_tenths, 0);
  const gameweekTotal = players.reduce((sum, player) => sum + player.team_points, 0);
  const hitPoints = await fetchHit(client, managerId, current.number);

  const half = seasonHalfOf(current.number);
  const usedThisHalf = new Map<ChipCode, number>();
  for (const entry of playedChips) {
    if (entry.cancelled) continue;
    const playedHalf = seasonHalfOf(entry.gameweek);
    if (playedHalf === half && !usedThisHalf.has(entry.chip as ChipCode)) {
      usedThisHalf.set(entry.chip as ChipCode, playedHalf);
    }
  }
  const chips: Record<ChipCode, ChipState> = {
    wildcard: chipStateFor('wildcard', current.number, chip, usedThisHalf),
    free_hit: chipStateFor('free_hit', current.number, chip, usedThisHalf),
    bench_boost: chipStateFor('bench_boost', current.number, chip, usedThisHalf),
    triple_captain: chipStateFor('triple_captain', current.number, chip, usedThisHalf),
  };

  return {
    gameweek: current.number,
    gameweek_status: current.status,
    editable: current.status === 'open',
    players,
    bank_tenths: meta.bank_tenths,
    squad_value_tenths: squadValue,
    free_transfers: meta.free_transfers,
    transfers_made: meta.transfers_made,
    hit_points: hitPoints,
    chip,
    chips,
    gameweek_total: gameweekTotal - hitPoints,
  };
}

async function fetchHit(client: pg.PoolClient, managerId: string, gameweek: number): Promise<number> {
  const { rows } = await client.query<{ hit_points: number }>(
    'SELECT hit_points FROM hits WHERE manager_id = $1 AND gameweek = $2',
    [managerId, gameweek],
  );
  return rows[0]?.hit_points ?? 0;
}
