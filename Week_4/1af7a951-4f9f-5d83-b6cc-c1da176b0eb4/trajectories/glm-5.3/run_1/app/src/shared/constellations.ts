import type { SignCategory, Tallies } from './domain.js';
import { SIGN_CATEGORIES } from './domain.js';

// Derived dreamscape values, decided here and reused by the dreamscape
// endpoint, the roster and the digest.

export function emptyTallies(): Tallies {
  return { inner_awareness: 0, action: 0, form: 0, context: 0 };
}

export function tallySigns(signs: readonly { category: SignCategory }[]): Tallies {
  const tallies = emptyTallies();
  for (const s of signs) tallies[s.category] += 1;
  return tallies;
}

export function haloRadius(taggedNights: number): number {
  // 12 plus 36 * min(nights, 28) / 28, rounded to the nearest whole number
  // with halves rounding up.
  const base = 12 + (36 * Math.min(taggedNights, 28)) / 28;
  return Math.floor(base + 0.5 + 1e-9);
}

// The drill target: most stars, ties to the earlier category in the
// published order.
export function targetCategory(tallies: Tallies): SignCategory | null {
  let best: SignCategory | null = null;
  let bestCount = 0;
  for (const cat of SIGN_CATEGORIES) {
    const n = tallies[cat];
    if (n > bestCount) {
      best = cat;
      bestCount = n;
    }
  }
  return best;
}
