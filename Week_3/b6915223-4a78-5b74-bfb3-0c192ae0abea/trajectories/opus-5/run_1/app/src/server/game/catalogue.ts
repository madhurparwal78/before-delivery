import { pool, query } from '../db.ts';
import type { Club, PlayerRow, Position, SortOrder } from '../../shared/types.ts';
import { rawPoints, type ScoredEvent } from '../domain/scoring.ts';
import { SEED_CLUBS } from '../domain/seed.ts';

export interface PlayerRecord {
  id: string;
  name: string;
  club: string;
  position: Position;
  price_tenths: number;
}

export const CLUB_CODES: string[] = SEED_CLUBS.map((club) => club.code);
export const CLUB_NAMES: Map<string, string> = new Map(
  SEED_CLUBS.map((club) => [club.code, club.name]),
);

export const allClubs = async (): Promise<Club[]> =>
  query<Club>(pool, 'select code, name from clubs order by sort_index');

export const allPlayers = async (): Promise<PlayerRecord[]> =>
  query<PlayerRecord>(pool, 'select id, name, club, position, price_tenths from players order by id');

export const playerMap = async (): Promise<Map<string, PlayerRecord>> =>
  new Map((await allPlayers()).map((player) => [player.id, player]));

interface EventRecord {
  player_id: string;
  gameweek: number;
  fixture_id: string;
  type: ScoredEvent['type'];
  value: number | null;
  voided: boolean;
}

export const rawPointsByPlayer = async (
  gameweeks: number[],
  players: Map<string, PlayerRecord>,
): Promise<Map<string, number>> => {
  const totals = new Map<string, number>();
  if (gameweeks.length === 0) return totals;
  const events = await query<EventRecord>(
    pool,
    `select player_id, gameweek, fixture_id, type, value, voided
       from match_events where gameweek = any($1::int[])`,
    [gameweeks],
  );
  const byPlayer = new Map<string, EventRecord[]>();
  for (const event of events) {
    const list = byPlayer.get(event.player_id) ?? [];
    list.push(event);
    byPlayer.set(event.player_id, list);
  }
  for (const [playerId, list] of byPlayer) {
    const position = players.get(playerId)?.position;
    if (position === undefined) continue;
    const perGameweek = new Map<number, EventRecord[]>();
    for (const event of list) {
      const bucket = perGameweek.get(event.gameweek) ?? [];
      bucket.push(event);
      perGameweek.set(event.gameweek, bucket);
    }
    let total = 0;
    for (const bucket of perGameweek.values()) total += rawPoints(bucket, position);
    totals.set(playerId, total);
  }
  return totals;
};

export interface PlayerFilters {
  position: Position | null;
  club: string | null;
  maxPriceTenths: number | null;
  sort: SortOrder;
}

const compareNames = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const sortPlayerRows = (rows: PlayerRow[], sort: SortOrder): PlayerRow[] => {
  const tiebreak = (a: PlayerRow, b: PlayerRow): number =>
    compareNames(a.name, b.name) || compareNames(a.id, b.id);
  const comparators: Record<SortOrder, (a: PlayerRow, b: PlayerRow) => number> = {
    price_desc: (a, b) => b.price_tenths - a.price_tenths || tiebreak(a, b),
    price_asc: (a, b) => a.price_tenths - b.price_tenths || tiebreak(a, b),
    points_desc: (a, b) => b.total_points - a.total_points || tiebreak(a, b),
    name_asc: tiebreak,
  };
  return [...rows].sort(comparators[sort]);
};
