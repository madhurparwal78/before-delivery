import type { Level } from "./levels";

const BASE_SCORE: Readonly<Record<Level, number>> = { easy: 1500, medium: 3000, hard: 4500, expert: 6000 };
/** The highest score a game can earn: the Expert base. */
export const HIGHEST_SCORE = BASE_SCORE.expert;
const MISTAKE_COST = 150;
const HINT_COST = 300;

/** Whole seconds of an active time in ms (rounded down). */
export const wholeSeconds = (ms: number): number => Math.floor(ms / 1000);

/** Score of a won game: `max(base / 10, base - S - 150 x M - 300 x H)`, S being whole seconds of active time. */
export function score(level: Level, seconds: number, mistakes: number, hints: number): number {
  const base = BASE_SCORE[level];
  return Math.max(base / 10, base - seconds - MISTAKE_COST * mistakes - HINT_COST * hints);
}
