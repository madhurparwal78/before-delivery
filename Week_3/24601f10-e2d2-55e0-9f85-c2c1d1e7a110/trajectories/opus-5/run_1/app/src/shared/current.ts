import type { ApiMatch, BracketKind, CurrentRound, Format } from './types';

/** An open match: pending, called, reported or disputed with both entrants known. */
export const isOpenMatch = (match: ApiMatch): boolean => {
  if (!['pending', 'called', 'reported', 'disputed'].includes(match.state)) return false;
  const upperKnown = match.upper !== null && 'entrant_id' in match.upper;
  const lowerKnown = match.lower !== null && 'entrant_id' in match.lower;
  return upperKnown && lowerKnown;
};

export const roundsOf = (matches: ApiMatch[], bracket: BracketKind): number[] => {
  const rounds = new Set<number>();
  for (const match of matches) {
    if (match.bracket === bracket) rounds.add(match.round);
  }
  return [...rounds].sort((a, b) => a - b);
};

/** The lowest-numbered round with an open match, or the last round. */
export const regionCurrentRound = (matches: ApiMatch[], bracket: BracketKind): number => {
  const rounds = roundsOf(matches, bracket);
  if (rounds.length === 0) return 1;
  for (const round of rounds) {
    if (matches.some((match) => match.bracket === bracket && match.round === round && isOpenMatch(match))) {
      return round;
    }
  }
  return rounds[rounds.length - 1] as number;
};

export const regionsOf = (format: Format): BracketKind[] =>
  format === 'double_elimination' ? ['winners', 'losers', 'final'] : ['main'];

export const overallCurrentRound = (matches: ApiMatch[], format: Format): CurrentRound | null => {
  if (matches.length === 0) return null;
  const regions = regionsOf(format).filter((bracket) => roundsOf(matches, bracket).length > 0);
  if (regions.length === 0) return null;
  for (const bracket of regions) {
    if (matches.some((match) => match.bracket === bracket && isOpenMatch(match))) {
      return { bracket, round: regionCurrentRound(matches, bracket) };
    }
  }
  const last = regions[regions.length - 1] as BracketKind;
  return { bracket: last, round: regionCurrentRound(matches, last) };
};
