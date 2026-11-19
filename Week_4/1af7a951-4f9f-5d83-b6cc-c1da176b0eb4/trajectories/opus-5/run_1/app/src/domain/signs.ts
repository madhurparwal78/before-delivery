export const SIGN_CATEGORIES = ['inner_awareness', 'action', 'form', 'context'] as const;

export type SignCategory = (typeof SIGN_CATEGORIES)[number];

export type Tallies = Record<SignCategory, number>;

export interface ConstellationCounts {
  readonly category: SignCategory;
  readonly stars: number;
  readonly taggedNights: number;
}

export interface Constellation extends ConstellationCounts {
  readonly halo_px: number;
}

export function emptyTallies(): Tallies {
  return { inner_awareness: 0, action: 0, form: 0, context: 0 };
}

export function haloPx(taggedNights: number): number {
  return Math.round(12 + (36 * Math.min(taggedNights, 28)) / 28);
}

export function targetCategory(counts: readonly ConstellationCounts[]): SignCategory | null {
  let best: ConstellationCounts | null = null;
  for (const category of SIGN_CATEGORIES) {
    const found = counts.find((candidate) => candidate.category === category);
    if (found === undefined || found.stars === 0) continue;
    if (best === null || found.stars > best.stars) best = found;
  }
  return best === null ? null : best.category;
}

export function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}
