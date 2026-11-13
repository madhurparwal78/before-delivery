import { roundsOf } from '../shared/current';
import type { ApiMatch, BracketKind, Format } from '../shared/types';

const inRegion = (matches: ApiMatch[], bracket: BracketKind): ApiMatch[] =>
  matches.filter((match) => match.bracket === bracket);

const at = (matches: ApiMatch[], bracket: BracketKind, round: number, number: number): ApiMatch | null =>
  matches.find((match) => match.bracket === bracket && match.round === round && match.number === number) ?? null;

const lastNumber = (matches: ApiMatch[], bracket: BracketKind, round: number): number =>
  inRegion(matches, bracket)
    .filter((match) => match.round === round)
    .reduce((highest, match) => Math.max(highest, match.number), 0);

/** A drop-in round is a losers round with an even number, 2 or more. */
const isDropIn = (bracket: BracketKind, round: number): boolean =>
  bracket === 'losers' && round >= 2 && round % 2 === 0;

const isRotation = (format: Format): boolean => format === 'round_robin' || format === 'swiss';

export const arrowTarget = (
  matches: ApiMatch[],
  current: ApiMatch,
  key: string,
  format: Format,
): ApiMatch | null => {
  const bracket = current.bracket;
  const rounds = roundsOf(matches, bracket);
  const { round, number } = current;

  if (key === 'ArrowRight') {
    if (bracket === 'final') return round === 1 ? at(matches, 'final', 2, 1) : null;
    if (!rounds.includes(round + 1)) return null;
    if (isRotation(format)) {
      return at(matches, bracket, round + 1, Math.min(number, lastNumber(matches, bracket, round + 1)));
    }
    if (isDropIn(bracket, round + 1)) return at(matches, bracket, round + 1, number);
    return at(matches, bracket, round + 1, Math.ceil(number / 2));
  }

  if (key === 'ArrowLeft') {
    if (bracket === 'final') return round === 2 ? at(matches, 'final', 1, 1) : null;
    if (!rounds.includes(round - 1)) return null;
    if (isRotation(format)) {
      return at(matches, bracket, round - 1, Math.min(number, lastNumber(matches, bracket, round - 1)));
    }
    if (isDropIn(bracket, round)) return at(matches, bracket, round - 1, number);
    return at(matches, bracket, round - 1, 2 * number - 1);
  }

  if (key === 'ArrowUp') {
    if (bracket === 'final') return null;
    return at(matches, bracket, round, number - 1);
  }

  if (key === 'ArrowDown') {
    if (bracket === 'final') return null;
    return at(matches, bracket, round, number + 1);
  }

  if (key === 'Home') {
    const first = rounds[0];
    return first === undefined ? null : at(matches, bracket, first, 1);
  }

  if (key === 'End') {
    const last = rounds[rounds.length - 1];
    return last === undefined ? null : at(matches, bracket, last, 1);
  }

  return null;
};
