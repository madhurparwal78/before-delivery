import type { Copies, StringCount } from '../../shared/api.js';
import { stringSectionByChairKey } from './sections.js';

/**
 * One copy per desk of two players, plus one spare copy once a section has eight or more
 * players. Every part that is not a string part needs one copy.
 */
export function copiesNeededForPart(chairKey: string, stringCount: StringCount): number {
  const section = stringSectionByChairKey(chairKey);
  if (!section) return 1;
  const players = stringCount[section.countKey];
  return Math.ceil(players / 2) + (players >= 8 ? 1 : 0);
}

export function copiesOf(needed: number, onHand: number): Copies {
  return { needed, on_hand: onHand, shortfall: Math.max(0, needed - onHand) };
}

/** A work's or programme's figures: the sums over its parts, shortfall summed too. */
export function sumCopies(parts: readonly Copies[]): Copies {
  return parts.reduce<Copies>(
    (total, part) => ({
      needed: total.needed + part.needed,
      on_hand: total.on_hand + part.on_hand,
      shortfall: total.shortfall + part.shortfall,
    }),
    { needed: 0, on_hand: 0, shortfall: 0 },
  );
}
