import { halfNumber, signed } from '../../shared/cards';
import {
  ROUND_ROBIN_COLUMNS,
  SWISS_COLUMNS,
  type Format,
  type Standings,
  type StandingsRow,
  type StandingsRowRoundRobin,
  type StandingsRowSwiss,
} from '../../shared/types';
import type { MatchRow } from './matches';
import type { EntrantRow } from './tournaments';

const RR_TIEBREAKS = ['Match points', 'Head-to-head', 'Game difference', 'Games won', 'Seed'];
const SWISS_TIEBREAKS = ['Match points', 'Buchholz cut 1', 'Buchholz', 'Sonneborn-Berger', 'Seed'];

const WIN = 3;
const DRAW = 1;

interface Played {
  opponentId: string | null;
  outcome: 'win' | 'draw' | 'loss';
  gamesFor: number;
  gamesAgainst: number;
}

const playedRounds = (entrants: EntrantRow[], matches: MatchRow[], format: Format): Map<string, Played[]> => {
  const byEntrant = new Map<string, Played[]>();
  for (const entrant of entrants) byEntrant.set(entrant.id, []);

  for (const match of matches) {
    if (match.state === 'bye') {
      if (format !== 'swiss') continue;
      const entrantId = match.upper_entrant_id ?? match.lower_entrant_id;
      if (entrantId === null) continue;
      byEntrant.get(entrantId)?.push({ opponentId: null, outcome: 'win', gamesFor: 2, gamesAgainst: 0 });
      continue;
    }
    if (match.state !== 'confirmed' && match.state !== 'resolved') continue;
    const upper = match.upper_entrant_id;
    const lower = match.lower_entrant_id;
    if (upper === null || lower === null) continue;
    const upperGames = match.upper_games ?? 0;
    const lowerGames = match.lower_games ?? 0;
    const upperOutcome: Played['outcome'] =
      match.winner === 'draw' ? 'draw' : match.winner === 'upper' ? 'win' : 'loss';
    const lowerOutcome: Played['outcome'] =
      match.winner === 'draw' ? 'draw' : match.winner === 'lower' ? 'win' : 'loss';
    byEntrant
      .get(upper)
      ?.push({ opponentId: lower, outcome: upperOutcome, gamesFor: upperGames, gamesAgainst: lowerGames });
    byEntrant
      .get(lower)
      ?.push({ opponentId: upper, outcome: lowerOutcome, gamesFor: lowerGames, gamesAgainst: upperGames });
  }
  return byEntrant;
};

const matchPointsOf = (played: Played[]): number =>
  played.reduce((total, round) => total + (round.outcome === 'win' ? WIN : round.outcome === 'draw' ? DRAW : 0), 0);

const decideBy = (rows: { values: (number | string)[] }[], tiebreaks: string[]): string[] => {
  const firstDifference = (a: number, b: number): string => {
    for (let index = 0; index < tiebreaks.length; index += 1) {
      if (rows[a]?.values[index] !== rows[b]?.values[index]) return tiebreaks[index] as string;
    }
    return tiebreaks[tiebreaks.length - 1] as string;
  };
  return rows.map((_row, index) => {
    const neighbours: string[] = [];
    if (index > 0) neighbours.push(firstDifference(index - 1, index));
    if (index < rows.length - 1) neighbours.push(firstDifference(index, index + 1));
    if (neighbours.length === 0) return tiebreaks[0] as string;
    return neighbours.reduce((later, column) =>
      tiebreaks.indexOf(column) > tiebreaks.indexOf(later) ? column : later,
    );
  });
};

const roundRobinStandings = (entrants: EntrantRow[], matches: MatchRow[]): Standings => {
  const played = playedRounds(entrants, matches, 'round_robin');
  const base = entrants.map((entrant) => {
    const rounds = played.get(entrant.id) ?? [];
    const gamesWon = rounds.reduce((total, round) => total + round.gamesFor, 0);
    const gamesLost = rounds.reduce((total, round) => total + round.gamesAgainst, 0);
    return {
      entrant,
      played: rounds.length,
      matchPoints: matchPointsOf(rounds),
      gamesWon,
      gameDifference: gamesWon - gamesLost,
      rounds,
    };
  });

  const groups = new Map<number, string[]>();
  for (const row of base) {
    const group = groups.get(row.matchPoints) ?? [];
    group.push(row.entrant.id);
    groups.set(row.matchPoints, group);
  }
  const headToHead = new Map<string, number>();
  for (const row of base) {
    const group = groups.get(row.matchPoints) ?? [];
    if (group.length < 2) {
      headToHead.set(row.entrant.id, 0);
      continue;
    }
    const points = row.rounds
      .filter((round) => round.opponentId !== null && group.includes(round.opponentId))
      .reduce((total, round) => total + (round.outcome === 'win' ? WIN : round.outcome === 'draw' ? DRAW : 0), 0);
    headToHead.set(row.entrant.id, points);
  }

  const sorted = [...base].sort(
    (a, b) =>
      b.matchPoints - a.matchPoints ||
      (headToHead.get(b.entrant.id) ?? 0) - (headToHead.get(a.entrant.id) ?? 0) ||
      b.gameDifference - a.gameDifference ||
      b.gamesWon - a.gamesWon ||
      a.entrant.seed - b.entrant.seed,
  );

  const decided = decideBy(
    sorted.map((row) => ({
      values: [
        row.matchPoints,
        headToHead.get(row.entrant.id) ?? 0,
        row.gameDifference,
        row.gamesWon,
        row.entrant.seed,
      ],
    })),
    RR_TIEBREAKS,
  );

  const rows: StandingsRowRoundRobin[] = sorted.map((row, index) => ({
    place: index + 1,
    entrant_id: row.entrant.id,
    name: row.entrant.name,
    played: row.played,
    match_points: row.matchPoints,
    head_to_head: headToHead.get(row.entrant.id) ?? 0,
    game_difference: signed(row.gameDifference),
    games_won: row.gamesWon,
    seed: row.entrant.seed,
    decided_by: decided[index] as string,
  }));
  return { columns: ROUND_ROBIN_COLUMNS, rows };
};

const swissStandings = (entrants: EntrantRow[], matches: MatchRow[]): Standings => {
  const played = playedRounds(entrants, matches, 'swiss');
  const matchPoints = new Map<string, number>();
  for (const entrant of entrants) matchPoints.set(entrant.id, matchPointsOf(played.get(entrant.id) ?? []));

  const base = entrants.map((entrant) => {
    const rounds = played.get(entrant.id) ?? [];
    const opponentScores = rounds.map((round) =>
      round.opponentId === null ? 0 : matchPoints.get(round.opponentId) ?? 0,
    );
    const buchholz = opponentScores.reduce((total, score) => total + score, 0);
    const lowest = opponentScores.length === 0 ? 0 : Math.min(...opponentScores);
    const sonneborn = rounds.reduce((total, round, index) => {
      const score = opponentScores[index] ?? 0;
      if (round.outcome === 'win') return total + score;
      if (round.outcome === 'draw') return total + score / 2;
      return total;
    }, 0);
    return {
      entrant,
      played: rounds.length,
      matchPoints: matchPoints.get(entrant.id) ?? 0,
      buchholz,
      buchholzCut1: buchholz - lowest,
      sonneborn,
    };
  });

  const sorted = [...base].sort(
    (a, b) =>
      b.matchPoints - a.matchPoints ||
      b.buchholzCut1 - a.buchholzCut1 ||
      b.buchholz - a.buchholz ||
      b.sonneborn - a.sonneborn ||
      a.entrant.seed - b.entrant.seed,
  );

  const decided = decideBy(
    sorted.map((row) => ({
      values: [row.matchPoints, row.buchholzCut1, row.buchholz, row.sonneborn, row.entrant.seed],
    })),
    SWISS_TIEBREAKS,
  );

  const rows: StandingsRowSwiss[] = sorted.map((row, index) => ({
    place: index + 1,
    entrant_id: row.entrant.id,
    name: row.entrant.name,
    played: row.played,
    match_points: row.matchPoints,
    buchholz_cut_1: halfNumber(row.buchholzCut1),
    buchholz: halfNumber(row.buchholz),
    sonneborn_berger: halfNumber(row.sonneborn),
    seed: row.entrant.seed,
    decided_by: decided[index] as string,
  }));
  return { columns: SWISS_COLUMNS, rows };
};

export const computeStandings = (format: Format, entrants: EntrantRow[], matches: MatchRow[]): Standings =>
  format === 'swiss' ? swissStandings(entrants, matches) : roundRobinStandings(entrants, matches);

/** Match points per entrant, the first key of both tiebreak orders and of the Swiss pairing rank. */
export const matchPointsByEntrant = (
  format: Format,
  entrants: EntrantRow[],
  matches: MatchRow[],
): Map<string, number> => {
  const played = playedRounds(entrants, matches, format);
  const points = new Map<string, number>();
  for (const entrant of entrants) points.set(entrant.id, matchPointsOf(played.get(entrant.id) ?? []));
  return points;
};

export const standingsPlaces = (standings: Standings): Map<string, number> => {
  const places = new Map<string, number>();
  for (const row of standings.rows as StandingsRow[]) places.set(row.entrant_id, row.place);
  return places;
};
