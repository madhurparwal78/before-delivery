// Copies needed, copies on hand and shortfall (the desk rule).

import type { Copies, SectionKey, StringCount } from "../../shared/api.js";

/** The string sections by the chair key their parts carry. */
export const STRING_SECTIONS: Record<string, SectionKey> = {
  vn1: "violin_1",
  vn2: "violin_2",
  va: "viola",
  vc: "cello",
  cb: "bass",
};

/** One copy per desk of two, plus a spare for a section of 8 or more; every other part needs 1. */
function copiesNeeded(chairKey: string, stringCount: StringCount): number {
  const section = STRING_SECTIONS[chairKey];
  if (section === undefined) return 1;
  const players = stringCount[section];
  return Math.ceil(players / 2) + (players >= 8 ? 1 : 0);
}

export function partCopies(chairKey: string, onHand: number, stringCount: StringCount): Copies {
  const needed = copiesNeeded(chairKey, stringCount);
  return { needed, on_hand: onHand, shortfall: Math.max(needed - onHand, 0) };
}

/** A work's or programme's figures: sums of the part figures (shortfall included). */
export function sumCopies(all: Copies[]): Copies {
  return all.reduce(
    (total, copies) => ({
      needed: total.needed + copies.needed,
      on_hand: total.on_hand + copies.on_hand,
      shortfall: total.shortfall + copies.shortfall,
    }),
    { needed: 0, on_hand: 0, shortfall: 0 },
  );
}
