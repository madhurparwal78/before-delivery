import { championOf } from './advance.js';
import { computeStandings } from './standings.js';
import { isDecided, type Draw, type Match, type Slot } from './types.js';

const loserOf = (m: Match): Slot | null => (m.winner === 'upper' ? m.lower : m.winner === 'lower' ? m.upper : null);

// The final place of every entrant. Elimination: entrants knocked out in the same match round share a place equal to
// 1 plus the number knocked out later or never. Round robin and Swiss: the standings place.
export function finalPlacements(draw: Draw): Map<string, number> {
  const places = new Map<string, number>();
  const { format } = draw.tournament;
  if (format === 'round_robin' || format === 'swiss') {
    for (const row of computeStandings(draw)?.rows ?? []) places.set(row.entrant_id, row.place);
    return places;
  }
  // A larger key means knocked out later. Only losers-bracket and final losses knock an entrant out in double
  // elimination; the loser of the last final match is the runner-up.
  const keyed = new Map<number, string[]>();
  const knockOut = (slot: Slot | null, key: number): void => {
    if (slot?.kind === 'entrant') keyed.set(key, [...(keyed.get(key) ?? []), slot.entrantId]);
  };
  const final = draw.matches.filter((m) => m.bracket === 'final' && isDecided(m.state));
  const lastFinal = final.find((m) => m.round === 2) ?? final.find((m) => m.round === 1);
  for (const m of draw.matches) {
    if (!isDecided(m.state) || m.bracket === 'winners' && format === 'double_elimination') continue;
    if (m.bracket === 'final') {
      if (m === lastFinal) knockOut(loserOf(m), Number.MAX_SAFE_INTEGER);
    } else {
      knockOut(loserOf(m), m.round);
    }
  }
  let ahead = 1;
  const champion = championOf(draw);
  if (champion?.kind === 'entrant') places.set(champion.entrantId, 1);
  for (const key of [...keyed.keys()].sort((a, b) => b - a)) {
    const group = keyed.get(key) as string[];
    for (const id of group) places.set(id, 1 + ahead);
    ahead += group.length;
  }
  return places;
}
