import type { ApiMatch, BracketKind, MatchDispute, MatchReport, MatchState, Slot, Winner } from '../../shared/types';
import { iso } from '../clock';
import type { Db } from '../db';

export interface MatchRow {
  id: string;
  tournament_id: string;
  bracket: BracketKind;
  round: number;
  number: number;
  label: string;
  upper_entrant_id: string | null;
  lower_entrant_id: string | null;
  upper_bye: boolean;
  lower_bye: boolean;
  state: MatchState;
  upper_games: number | null;
  lower_games: number | null;
  winner: Winner;
  report: MatchReport | null;
  dispute: MatchDispute | null;
  called_at: Date | null;
  auto_confirm_at: Date | null;
  paired_at: Date | null;
  overdue: boolean;
  version: number;
  updated_by: string | null;
  upper_name: string | null;
  lower_name: string | null;
}

export interface FeedRow {
  src_match_id: string;
  outcome: 'winner' | 'loser';
  dst_match_id: string;
  slot: 'upper' | 'lower';
}

const SELECT = `
  select m.*, u.name as upper_name, l.name as lower_name
  from matches m
  left join entrants u on u.id = m.upper_entrant_id
  left join entrants l on l.id = m.lower_entrant_id`;

const ORDER = `
  order by case m.bracket when 'winners' then 1 when 'losers' then 2 when 'final' then 3 else 4 end,
           m.round, m.number`;

export const loadMatches = async (db: Db, tournamentId: string): Promise<MatchRow[]> => {
  const { rows } = await db.query<MatchRow>(`${SELECT} where m.tournament_id = $1 ${ORDER}`, [tournamentId]);
  return rows;
};

export const loadMatch = async (db: Db, id: string): Promise<MatchRow | null> => {
  const { rows } = await db.query<MatchRow>(`${SELECT} where m.id = $1`, [id]);
  return rows[0] ?? null;
};

export const loadMatchByLabel = async (db: Db, tournamentId: string, label: string): Promise<MatchRow | null> => {
  const { rows } = await db.query<MatchRow>(`${SELECT} where m.tournament_id = $1 and m.label = $2`, [
    tournamentId,
    label,
  ]);
  return rows[0] ?? null;
};

export const loadFeeds = async (db: Db, tournamentId: string): Promise<FeedRow[]> => {
  const { rows } = await db.query<FeedRow>(
    'select src_match_id, outcome, dst_match_id, slot from match_feeds where tournament_id = $1',
    [tournamentId],
  );
  return rows;
};

export const slotOf = (row: MatchRow, side: 'upper' | 'lower'): Slot => {
  if (side === 'upper') {
    if (row.upper_bye) return { bye: true };
    if (row.upper_entrant_id !== null) return { entrant_id: row.upper_entrant_id, name: row.upper_name ?? '' };
    return null;
  }
  if (row.lower_bye) return { bye: true };
  if (row.lower_entrant_id !== null) return { entrant_id: row.lower_entrant_id, name: row.lower_name ?? '' };
  return null;
};

export const bothSlotsKnown = (row: MatchRow): boolean =>
  (row.upper_bye || row.upper_entrant_id !== null) && (row.lower_bye || row.lower_entrant_id !== null);

export const toApiMatch = (row: MatchRow, asOrganizer: boolean): ApiMatch => {
  const match: ApiMatch = {
    id: row.id,
    tournament_id: row.tournament_id,
    label: row.label,
    bracket: row.bracket,
    round: row.round,
    number: row.number,
    upper: slotOf(row, 'upper'),
    lower: slotOf(row, 'lower'),
    state: row.state,
    upper_games: row.upper_games,
    lower_games: row.lower_games,
    winner: row.winner,
    report: row.report,
    dispute: row.dispute,
    called_at: row.called_at === null ? null : iso(row.called_at.getTime()),
    version: row.version,
  };
  if (asOrganizer) {
    match.overdue = row.overdue;
    match.updated_by = row.updated_by;
  }
  return match;
};

export const winnerEntrantId = (row: MatchRow): string | null => {
  if (row.winner === 'upper') return row.upper_entrant_id;
  if (row.winner === 'lower') return row.lower_entrant_id;
  return null;
};

export const loserEntrantId = (row: MatchRow): string | null => {
  if (row.winner === 'upper') return row.lower_entrant_id;
  if (row.winner === 'lower') return row.upper_entrant_id;
  return null;
};

export const winnerIsBye = (row: MatchRow): boolean =>
  (row.winner === 'upper' && row.upper_bye) || (row.winner === 'lower' && row.lower_bye);

export const loserIsBye = (row: MatchRow): boolean =>
  (row.winner === 'upper' && row.lower_bye) || (row.winner === 'lower' && row.upper_bye);

export const hasResult = (row: MatchRow): boolean => row.state === 'confirmed' || row.state === 'resolved';
