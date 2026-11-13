import { addMatch, BYE, entrantSlot } from './draw.js';
import { pairingRank } from './standings.js';
import type { Draw, Entrant } from './types.js';

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

// The Swiss pairing rule, decided here and nowhere else. Returns null when no rematch-free pairing exists.
function pairing(draw: Draw, round: number): { pairs: Array<[Entrant, Entrant]>; bye: Entrant | null } | null {
  const bySeed = (id: string): Entrant => draw.entrantById.get(id) as Entrant;
  const ranked = (round === 1 ? [...draw.entrants].sort((a, b) => a.seed - b.seed) : pairingRank(draw).map(bySeed));
  const played = new Set<string>();
  const hadBye = new Set<string>();
  for (const m of draw.matches) {
    if (m.upper.kind === 'entrant' && m.lower.kind === 'entrant') played.add(pairKey(m.upper.entrantId, m.lower.entrantId));
    if (m.state === 'bye' && m.upper.kind === 'entrant') hadBye.add(m.upper.entrantId);
  }
  let bye: Entrant | null = null;
  let field = ranked;
  if (ranked.length % 2 === 1) {
    bye = [...ranked].reverse().find((e) => !hadBye.has(e.id)) ?? (ranked[ranked.length - 1] as Entrant);
    field = ranked.filter((e) => e !== bye);
  }
  if (round === 1) {
    const half = field.length / 2;
    return { pairs: field.slice(0, half).map((upper, i) => [upper, field[i + half] as Entrant]), bye };
  }
  const pairAll = (list: Entrant[]): Array<[Entrant, Entrant]> | null => {
    const [first, ...rest] = list;
    if (!first) return [];
    for (const [i, candidate] of rest.entries()) {
      if (played.has(pairKey(first.id, candidate.id))) continue;
      const tail = pairAll(rest.filter((_, j) => j !== i));
      if (tail) return [[first, candidate], ...tail];
    }
    return null;
  };
  const pairs = pairAll(field);
  return pairs ? { pairs, bye } : null;
}

// Adds the cards of one Swiss round to the draw (pairs in paired order, the bye last). False when no pairing exists.
export function pairRound(draw: Draw, round: number): boolean {
  const result = pairing(draw, round);
  if (!result) return false;
  const cards = result.pairs.map(([upper, lower]) => ({ upper: entrantSlot(upper.id), lower: entrantSlot(lower.id) }));
  cards.forEach((card, index) => {
    const match = addMatch(draw, { bracket: 'main', round, number: index + 1, label: `Round ${round}, match ${index + 1}`, ...card });
    match.pairedAt = draw.now;
  });
  if (result.bye) {
    const match = addMatch(draw, { bracket: 'main', round, number: cards.length + 1,
      label: `Round ${round}, match ${cards.length + 1}`, upper: entrantSlot(result.bye.id), lower: BYE, state: 'bye' });
    match.winner = 'upper';
    match.upperGames = 2;
    match.lowerGames = 0;
    match.pairedAt = draw.now;
  }
  return true;
}

export const swissRoundCount = (fieldSize: number): number => Math.ceil(Math.log2(fieldSize));
