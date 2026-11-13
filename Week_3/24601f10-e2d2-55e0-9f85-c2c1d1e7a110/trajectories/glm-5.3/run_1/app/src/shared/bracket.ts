import type { TournamentFormat } from "./types.js";

/**
 * Elimination slot order, built recursively: start from 1, 2, and to double the
 * size replace each seed s by the pair s, size+1-s.
 */
export function slotOrder(size: number): number[] {
  let slots = [1, 2];
  while (slots.length < size) {
    const doubled: number[] = [];
    for (const s of slots) {
      doubled.push(s, slots.length * 2 + 1 - s);
    }
    slots = doubled;
  }
  return slots;
}

export function bracketSize(field: number): number {
  let n = 2;
  while (n < field) n *= 2;
  return n;
}

export interface PreviewMatch {
  number: number;
  upper: number | null;
  lower: number | null;
}

/** Round 1 pairing for a field of seeds 1..fieldSize: match m pairs slots 2m-1 and 2m. */
export function round1Pairings(fieldSize: number): PreviewMatch[] {
  const size = bracketSize(fieldSize);
  const slots = slotOrder(size);
  const matches: PreviewMatch[] = [];
  for (let m = 0; m < size / 2; m++) {
    const u = slots[2 * m] ?? null;
    const l = slots[2 * m + 1] ?? null;
    matches.push({
      number: m + 1,
      upper: u !== null && u <= fieldSize ? u : null,
      lower: l !== null && l <= fieldSize ? l : null,
    });
  }
  return matches;
}

export function formatName(format: TournamentFormat): string {
  return { single_elimination: "Single elimination", double_elimination: "Double elimination", round_robin: "Round robin", swiss: "Swiss" }[format];
}
