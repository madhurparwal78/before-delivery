/**
 * Ranking and scoring rules (DP-17, DP-18). The priority formula, fit
 * aggregation, rounding and tie-breaks live here and nowhere else.
 */

export interface ObjectiveWeight {
  id: string;
  weight: number;
}

/** Round half away from zero to two decimals. */
export function round2(value: number): number {
  if (value >= 0) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
  return -Math.round((-value + Number.EPSILON) * 100) / 100;
}

/**
 * objectiveFit = Σ(weight × fit) ÷ (3 × Σ weights); 0 when Σ weights is 0.
 */
export function computeObjectiveFit(
  fits: Record<string, number>,
  objectives: ObjectiveWeight[],
): number {
  const totalWeight = objectives.reduce((sum, o) => sum + o.weight, 0);
  if (totalWeight === 0) return 0;
  let acc = 0;
  for (const o of objectives) {
    const fit = fits[o.id] ?? 0;
    acc += o.weight * fit;
  }
  return acc / (3 * totalWeight);
}

/** priority = 100 × objectiveFit × impact × (confidence ÷ 100) ÷ effort. */
export function computePriority(
  objectiveFit: number,
  impact: number,
  confidence: number,
  effort: number,
): number {
  return (100 * objectiveFit * impact * (confidence / 100)) / effort;
}

export interface RankInput {
  id: string;
  name: string;
  priority: number;
  impact: number;
}

export interface Ranked<T extends RankInput> {
  feature: T;
  rank: number;
}

/**
 * Rank by priority high first, then impact high first, then name A–Z ignoring
 * case. Feature names are unique per workspace ignoring case, so no further
 * tie-break is needed.
 */
export function rankFeatures<T extends RankInput>(features: T[]): Array<Ranked<T>> {
  const sorted = [...features].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.impact !== b.impact) return b.impact - a.impact;
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    return aName < bName ? -1 : 1;
  });
  return sorted.map((feature, index) => ({ feature, rank: index + 1 }));
}
