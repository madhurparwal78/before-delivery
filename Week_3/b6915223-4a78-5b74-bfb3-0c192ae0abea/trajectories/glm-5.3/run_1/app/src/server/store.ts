import * as pg from 'pg';
import { randomId } from './util';

export interface GameweekRow {
  number: number;
  status: 'upcoming' | 'open' | 'locked' | 'live' | 'closed';
  deadline: Date | null;
}

export async function fetchGameweeks(client: pg.PoolClient | pg.Pool): Promise<GameweekRow[]> {
  const { rows } = await client.query<{ number: number; status: GameweekRow['status']; deadline: Date | null }>(
    'SELECT number, status, deadline FROM gameweeks ORDER BY number',
  );
  return rows;
}

export async function fetchCurrentGameweek(pool: pg.Pool): Promise<GameweekRow | null> {
  const { rows } = await pool.query<{ number: number; status: GameweekRow['status']; deadline: Date | null }>(
    `SELECT number, status, deadline FROM gameweeks
      WHERE status IN ('open', 'locked', 'live')
      ORDER BY number
      LIMIT 1`,
  );
  if (rows.length > 0) return rows[0];
  const closed = await pool.query<{ number: number; status: GameweekRow['status']; deadline: Date | null }>(
    `SELECT number, status, deadline FROM gameweeks
      WHERE status = 'closed'
      ORDER BY number DESC
      LIMIT 1`,
  );
  return closed.rows[0] ?? null;
}

export async function fetchGameweek(pool: pg.Pool, number: number): Promise<GameweekRow | null> {
  const { rows } = await pool.query<{ number: number; status: GameweekRow['status']; deadline: Date | null }>(
    'SELECT number, status, deadline FROM gameweeks WHERE number = $1',
    [number],
  );
  return rows[0] ?? null;
}

export async function fetchFixtureRow(pool: pg.Pool, gameweek: number): Promise<{ id: string; home: string; away: string; kickoff: Date }[]> {
  const { rows } = await pool.query<{ id: string; home: string; away: string; kickoff: Date }>(
    'SELECT id, home, away, kickoff FROM fixtures WHERE gameweek = $1 ORDER BY kickoff, id',
    [gameweek],
  );
  return rows;
}

export interface PlayerRowData {
  id: string;
  name: string;
  club: string;
  position: PositionName;
  price_tenths: number;
}

type PositionName = 'GK' | 'DEF' | 'MID' | 'FWD';

export async function fetchPlayers(pool: pg.Pool): Promise<PlayerRowData[]> {
  const { rows } = await pool.query<PlayerRowData>(
    'SELECT id, name, club, position, price_tenths FROM players ORDER BY id',
  );
  return rows;
}

export async function fetchPlayerMap(pool: pg.Pool): Promise<Map<string, PlayerRowData>> {
  const players = await fetchPlayers(pool);
  return new Map(players.map((player) => [player.id, player]));
}

export interface SquadPlayerRow {
  player_id: string;
  purchase_price_tenths: number;
}

export async function fetchSquadPlayers(client: pg.PoolClient, managerId: string): Promise<SquadPlayerRow[]> {
  const { rows } = await client.query<SquadPlayerRow>(
    'SELECT player_id, purchase_price_tenths FROM squad_players WHERE manager_id = $1 ORDER BY player_id',
    [managerId],
  );
  return rows;
}

export interface PickRow {
  starting: string[];
  bench: string[];
  captain: string | null;
  vice_captain: string | null;
}

export async function fetchPick(client: pg.PoolClient, managerId: string, gameweek: number): Promise<PickRow | null> {
  const { rows } = await client.query<PickRow>(
    'SELECT starting, bench, captain, vice_captain FROM picks WHERE manager_id = $1 AND gameweek = $2',
    [managerId, gameweek],
  );
  return rows[0] ?? null;
}

export interface MetaRow {
  bank_tenths: number;
  free_transfers: number;
  transfers_made: number;
}

export async function fetchMeta(client: pg.PoolClient, managerId: string): Promise<MetaRow | null> {
  const { rows } = await client.query<MetaRow>(
    'SELECT bank_tenths, free_transfers, transfers_made FROM squad_meta WHERE manager_id = $1',
    [managerId],
  );
  return rows[0] ?? null;
}

export async function fetchActiveChip(
  pool: pg.Pool | pg.PoolClient,
  managerId: string,
  gameweek: number,
): Promise<'wildcard' | 'free_hit' | 'bench_boost' | 'triple_captain' | null> {
  const { rows } = await pool.query<{ chip: string }>(
    'SELECT chip FROM chips WHERE manager_id = $1 AND gameweek = $2 AND cancelled = false',
    [managerId, gameweek],
  );
  return (rows[0]?.chip as 'wildcard' | 'free_hit' | 'bench_boost' | 'triple_captain' | undefined) ?? null;
}

export async function fetchPlayedChips(
  pool: pg.Pool | pg.PoolClient,
  managerId: string,
): Promise<{ gameweek: number; chip: string; cancelled: boolean }[]> {
  const { rows } = await pool.query<{ gameweek: number; chip: string; cancelled: boolean }>(
    'SELECT gameweek, chip, cancelled FROM chips WHERE manager_id = $1 ORDER BY gameweek',
    [managerId],
  );
  return rows;
}

export async function fetchEventsForGameweek(
  pool: pg.Pool | pg.PoolClient,
  gameweek: number,
  voided: boolean | null = false,
): Promise<EventRowData[]> {
  const { rows } = await pool.query<EventRowData>(
    voided === null
      ? 'SELECT * FROM events WHERE gameweek = $1 ORDER BY recorded_at, event_id'
      : 'SELECT * FROM events WHERE gameweek = $1 AND voided = $2 ORDER BY recorded_at, event_id',
    voided === null ? [gameweek] : [gameweek, voided],
  );
  return rows;
}

export interface EventRowData {
  event_id: string;
  gameweek: number;
  fixture_id: string;
  player_id: string;
  type: string;
  value: number | null;
  points_delta: number;
  voided: boolean;
  recorded_at: Date;
}

export async function insertLedgerEntry(
  client: pg.PoolClient,
  entry: {
    manager_id: string;
    kind: 'opening_budget' | 'purchase' | 'sale' | 'reversal';
    amount_tenths: number;
    player_id: string | null;
    transfer_id: string | null;
    reverses: string | null;
    gameweek: number;
  },
): Promise<string> {
  const id = `l_${randomId(16)}`;
  await client.query(
    `INSERT INTO ledger_entries (id, manager_id, kind, amount_tenths, player_id, transfer_id, reverses, gameweek)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, entry.manager_id, entry.kind, entry.amount_tenths, entry.player_id, entry.transfer_id, entry.reverses, entry.gameweek],
  );
  return id;
}

export async function bankFromLedger(client: pg.PoolClient, managerId: string): Promise<number> {
  const { rows } = await client.query<{ total: number }>(
    'SELECT COALESCE(SUM(amount_tenths), 0)::int AS total FROM ledger_entries WHERE manager_id = $1',
    [managerId],
  );
  return rows[0].total;
}
