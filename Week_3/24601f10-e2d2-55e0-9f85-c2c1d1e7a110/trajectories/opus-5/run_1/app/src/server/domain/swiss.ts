import type { MatchRow } from './matches';
import { matchPointsByEntrant } from './standings';
import type { EntrantRow } from './tournaments';

export interface SwissPairing {
  pairs: { upper: string; lower: string }[];
  byeEntrantId: string | null;
}

const playedPairs = (matches: MatchRow[]): Set<string> => {
  const pairs = new Set<string>();
  for (const match of matches) {
    const upper = match.upper_entrant_id;
    const lower = match.lower_entrant_id;
    if (upper === null || lower === null) continue;
    pairs.add(`${upper}|${lower}`);
    pairs.add(`${lower}|${upper}`);
  }
  return pairs;
};

const hadBye = (matches: MatchRow[]): Set<string> => {
  const byes = new Set<string>();
  for (const match of matches) {
    if (match.state !== 'bye') continue;
    const entrantId = match.upper_entrant_id ?? match.lower_entrant_id;
    if (entrantId !== null) byes.add(entrantId);
  }
  return byes;
};

/** Pairing rank is match points, then seed. */
const rankEntrants = (entrants: EntrantRow[], matches: MatchRow[]): EntrantRow[] => {
  const points = matchPointsByEntrant('swiss', entrants, matches);
  return [...entrants].sort(
    (a, b) => (points.get(b.id) ?? 0) - (points.get(a.id) ?? 0) || a.seed - b.seed,
  );
};

const pairFirstRound = (ranked: EntrantRow[]): { upper: string; lower: string }[] => {
  const bySeed = [...ranked].sort((a, b) => a.seed - b.seed);
  const half = bySeed.length / 2;
  const pairs: { upper: string; lower: string }[] = [];
  for (let i = 0; i < half; i += 1) {
    pairs.push({ upper: (bySeed[i] as EntrantRow).id, lower: (bySeed[i + half] as EntrantRow).id });
  }
  return pairs;
};

const pairLaterRound = (
  ranked: EntrantRow[],
  played: Set<string>,
): { upper: string; lower: string }[] | null => {
  const walk = (unpaired: EntrantRow[]): { upper: string; lower: string }[] | null => {
    if (unpaired.length === 0) return [];
    const [top, ...rest] = unpaired as [EntrantRow, ...EntrantRow[]];
    for (const candidate of rest) {
      if (played.has(`${top.id}|${candidate.id}`)) continue;
      const tail = walk(rest.filter((entrant) => entrant.id !== candidate.id));
      if (tail !== null) return [{ upper: top.id, lower: candidate.id }, ...tail];
    }
    return null;
  };
  return walk(ranked);
};

/** The published Swiss pairing rule. Returns null when no pairing without a rematch exists. */
export const pairSwissRound = (
  entrants: EntrantRow[],
  matches: MatchRow[],
  round: number,
): SwissPairing | null => {
  const ranked = rankEntrants(entrants, matches);
  let byeEntrantId: string | null = null;
  let pool = ranked;

  if (ranked.length % 2 === 1) {
    const byes = hadBye(matches);
    const reversed = [...ranked].reverse();
    const chosen = reversed.find((entrant) => !byes.has(entrant.id)) ?? reversed[0];
    byeEntrantId = (chosen as EntrantRow).id;
    pool = ranked.filter((entrant) => entrant.id !== byeEntrantId);
  }

  const pairs = round === 1 ? pairFirstRound(pool) : pairLaterRound(pool, playedPairs(matches));
  if (pairs === null) return null;
  return { pairs, byeEntrantId };
};
