import type { Format } from '../../shared/types';
import { hasResult, loserEntrantId, type MatchRow, winnerEntrantId } from './matches';
import { computeStandings, standingsPlaces } from './standings';
import type { EntrantRow } from './tournaments';

/** The match that decides the champion: the grand final reset when it was played, else the final. */
export const decidingMatch = (format: Format, matches: MatchRow[]): MatchRow | undefined => {
  if (format === 'double_elimination') {
    const reset = matches.find((match) => match.bracket === 'final' && match.round === 2);
    if (reset !== undefined && hasResult(reset)) return reset;
    return matches.find((match) => match.bracket === 'final' && match.round === 1);
  }
  return matches
    .filter((match) => match.bracket === 'main')
    .reduce<MatchRow | undefined>(
      (latest, match) => (latest === undefined || match.round > latest.round ? match : latest),
      undefined,
    );
};

/** The stage at which an entrant left: elimination rounds, then the losers rounds, then the final. */
const knockoutStage = (format: Format, matches: MatchRow[]): Map<string, number> => {
  const stages = new Map<string, number>();
  const losersRounds = matches
    .filter((match) => match.bracket === 'losers')
    .reduce((highest, match) => Math.max(highest, match.round), 0);

  for (const match of matches) {
    if (!hasResult(match)) continue;
    const loser = loserEntrantId(match);
    if (loser === null) continue;
    let stage: number | null = null;
    if (format === 'single_elimination') stage = match.round;
    else if (match.bracket === 'losers') stage = match.round;
    else if (match.bracket === 'final') stage = losersRounds + 1;
    if (stage === null) continue;
    stages.set(loser, Math.max(stages.get(loser) ?? 0, stage));
  }
  return stages;
};

/** The published placement rules: the champion is 1st, and a stage shares 1 plus those out later. */
export const computePlacements = (
  format: Format,
  entrants: EntrantRow[],
  matches: MatchRow[],
): Map<string, number> => {
  if (format === 'round_robin' || format === 'swiss') {
    return standingsPlaces(computeStandings(format, entrants, matches));
  }
  const stages = knockoutStage(format, matches);
  const final = decidingMatch(format, matches);
  if (final !== undefined && hasResult(final)) {
    const champion = winnerEntrantId(final);
    if (champion !== null) stages.delete(champion);
  }
  const places = new Map<string, number>();
  for (const entrant of entrants) {
    const stage = stages.get(entrant.id);
    if (stage === undefined) {
      places.set(entrant.id, 1);
      continue;
    }
    const later = entrants.filter((other) => {
      const otherStage = stages.get(other.id);
      return otherStage === undefined || otherStage > stage;
    }).length;
    places.set(entrant.id, 1 + later);
  }
  return places;
};
