import type { StandingRow, StandingsView } from '../../shared/api.js';
import { isDecided, type Draw } from './types.js';

const ROUND_ROBIN_COLUMNS = ['Place', 'Entrant', 'Played', 'Match points', 'Head-to-head', 'Game difference',
  'Games won', 'Seed', 'Decided by'];
const SWISS_COLUMNS = ['Place', 'Entrant', 'Played', 'Match points', 'Buchholz cut 1', 'Buchholz',
  'Sonneborn-Berger', 'Seed', 'Decided by'];

const WIN = 3;
const DRAW = 1;

type Result = 'win' | 'draw' | 'loss';
interface Opponent { opponentId: string | null; result: Result }

interface Tally {
  entrantId: string;
  played: number;
  matchPoints: number;
  gamesWon: number;
  gamesLost: number;
  opponents: Opponent[];
}

const points = (result: Result): number => (result === 'win' ? WIN : result === 'draw' ? DRAW : 0);

// Match points, games and opponents of every entrant from the decided matches (and the Swiss bye, a 2-0 win).
function tally(draw: Draw): Map<string, Tally> {
  const table = new Map<string, Tally>();
  for (const entrant of draw.entrants) {
    table.set(entrant.id, { entrantId: entrant.id, played: 0, matchPoints: 0, gamesWon: 0, gamesLost: 0, opponents: [] });
  }
  const credit = (id: string, opponentId: string | null, result: Result, won: number, lost: number): void => {
    const row = table.get(id);
    if (!row) return;
    row.played += 1;
    row.matchPoints += points(result);
    row.gamesWon += won;
    row.gamesLost += lost;
    row.opponents.push({ opponentId, result });
  };
  for (const m of draw.matches) {
    if (m.upper.kind === 'entrant' && m.lower.kind === 'entrant' && isDecided(m.state)) {
      const upper = m.upperGames ?? 0;
      const lower = m.lowerGames ?? 0;
      const upperResult: Result = m.winner === 'upper' ? 'win' : m.winner === 'lower' ? 'loss' : 'draw';
      const lowerResult: Result = m.winner === 'lower' ? 'win' : m.winner === 'upper' ? 'loss' : 'draw';
      credit(m.upper.entrantId, m.lower.entrantId, upperResult, upper, lower);
      credit(m.lower.entrantId, m.upper.entrantId, lowerResult, lower, upper);
    } else if (draw.tournament.format === 'swiss' && m.state === 'bye' && m.upper.kind === 'entrant') {
      credit(m.upper.entrantId, null, 'win', m.upperGames ?? 0, m.lowerGames ?? 0);
    }
  }
  return table;
}

interface Ranked {
  entrantId: string;
  name: string;
  seed: number;
  played: number;
  // Tiebreak values in column order, higher is better; the last is the seed, negated.
  keys: number[];
  shown: Pick<StandingRow, 'match_points' | 'head_to_head' | 'game_difference' | 'games_won' | 'buchholz_cut_1'
    | 'buchholz' | 'sonneborn_berger'>;
}

// Head-to-head: match points earned against the entrants level on match points, computed once per level group.
function headToHead(table: Map<string, Tally>): Map<string, number> {
  const groups = new Map<number, Tally[]>();
  for (const row of table.values()) groups.set(row.matchPoints, [...(groups.get(row.matchPoints) ?? []), row]);
  const result = new Map<string, number>();
  for (const group of groups.values()) {
    const ids = new Set(group.map((row) => row.entrantId));
    for (const row of group) {
      const earned = group.length === 1 ? 0 : row.opponents
        .filter((o) => o.opponentId !== null && ids.has(o.opponentId))
        .reduce((sum, o) => sum + points(o.result), 0);
      result.set(row.entrantId, earned);
    }
  }
  return result;
}

function swissFigures(row: Tally, table: Map<string, Tally>): { buchholz: number; cut: number; berger: number } {
  const scores = row.opponents.map((o) => (o.opponentId === null ? 0 : table.get(o.opponentId)?.matchPoints ?? 0));
  const buchholz = scores.reduce((sum, s) => sum + s, 0);
  const lowest = scores.length ? Math.min(...scores) : 0;
  const berger = row.opponents.reduce((sum, o, i) => {
    const score = scores[i] ?? 0;
    return sum + (o.result === 'win' ? score : o.result === 'draw' ? score / 2 : 0);
  }, 0);
  return { buchholz, cut: buchholz - lowest, berger };
}

export function computeStandings(draw: Draw): StandingsView | null {
  const format = draw.tournament.format;
  if (format !== 'round_robin' && format !== 'swiss') return null;
  const table = tally(draw);
  const h2h = headToHead(table);
  const ranked: Ranked[] = draw.entrants.map((entrant) => {
    const row = table.get(entrant.id) as Tally;
    const base = { entrantId: entrant.id, name: entrant.name, seed: entrant.seed, played: row.played };
    if (format === 'round_robin') {
      const difference = row.gamesWon - row.gamesLost;
      const head = h2h.get(entrant.id) ?? 0;
      return { ...base, keys: [row.matchPoints, head, difference, row.gamesWon, -entrant.seed],
        shown: { match_points: row.matchPoints, head_to_head: head, game_difference: difference, games_won: row.gamesWon } };
    }
    const { buchholz, cut, berger } = swissFigures(row, table);
    return { ...base, keys: [row.matchPoints, cut, buchholz, berger, -entrant.seed],
      shown: { match_points: row.matchPoints, buchholz_cut_1: cut, buchholz, sonneborn_berger: berger } };
  });
  ranked.sort((a, b) => {
    for (let i = 0; i < a.keys.length; i++) {
      const delta = (b.keys[i] ?? 0) - (a.keys[i] ?? 0);
      if (delta !== 0) return delta;
    }
    return 0;
  });
  const columns = format === 'round_robin' ? ROUND_ROBIN_COLUMNS : SWISS_COLUMNS;
  // The tiebreak columns in the order that ranks them: the table columns between Played and Decided by, then Seed.
  const names = [...columns.slice(3, 7), 'Seed'];
  // A row's deciding column is the later of the first columns that separate it from its neighbours above and below.
  const separating = (a: Ranked, b: Ranked): number => a.keys.findIndex((value, i) => value !== b.keys[i]);
  const rows: StandingRow[] = ranked.map((row, index) => {
    const above = ranked[index - 1];
    const below = ranked[index + 1];
    const decisive = Math.max(above ? separating(above, row) : 0, below ? separating(row, below) : 0);
    return { place: index + 1, entrant_id: row.entrantId, name: row.name, played: row.played, ...row.shown,
      seed: row.seed, decided_by: names[decisive] ?? 'Seed' };
  });
  return { columns, rows };
}

// Pairing rank for Swiss: match points, then seed.
export function pairingRank(draw: Draw): string[] {
  const table = tally(draw);
  const seedOf = new Map(draw.entrants.map((e) => [e.id, e.seed]));
  return [...table.values()]
    .sort((a, b) => b.matchPoints - a.matchPoints || (seedOf.get(a.entrantId) ?? 0) - (seedOf.get(b.entrantId) ?? 0))
    .map((row) => row.entrantId);
}
