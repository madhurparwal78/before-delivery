import { COPENHAGEN_ZONE } from './markets.ts';
import { pseudoToWall, resolveWall, wallToPseudo, type Wall } from './time.ts';

const WEEK_MS = 7 * 86_400_000;

/**
 * The weekly restock series: the same Copenhagen weekday and wall-clock time every week, with an
 * occurrence in the spring-forward gap shifted forward by one hour and a repeated autumn time
 * taken as its first occurrence.
 */
export function restockOccurrences(first: Wall, fromMs: number, count: number): number[] {
  const instants: number[] = [];
  for (let week = 0; instants.length < count && week < 520; week += 1) {
    const wall = pseudoToWall(wallToPseudo(first) + week * WEEK_MS);
    const instantMs = resolveWall(COPENHAGEN_ZONE, wall).instantMs;
    if (instantMs >= fromMs) instants.push(instantMs);
  }
  return instants;
}
