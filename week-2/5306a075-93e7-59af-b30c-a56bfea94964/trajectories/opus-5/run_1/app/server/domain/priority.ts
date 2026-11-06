/** The one definition of objective fit, priority, rounding and rank order. */

export const IMPORTANCE_POINTS = { nice_to_have: 1, important: 3, critical: 5 } as const;

export interface ObjectiveWeight {
  id: string;
  weight: number;
}

/** Rounds a non-negative rational to two decimals, half away from zero. */
function roundRational(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.floor((200 * numerator + denominator) / (2 * denominator)) / 100;
}

function fitNumerator(objectives: readonly ObjectiveWeight[], fits: Record<string, number>): number {
  let total = 0;
  for (const objective of objectives) total += objective.weight * (fits[objective.id] ?? 0);
  return total;
}

function weightSum(objectives: readonly ObjectiveWeight[]): number {
  let total = 0;
  for (const objective of objectives) total += objective.weight;
  return total;
}

export function objectiveFit(objectives: readonly ObjectiveWeight[], fits: Record<string, number>): number {
  return roundRational(fitNumerator(objectives, fits), 3 * weightSum(objectives));
}

export interface PriorityInput {
  fits: Record<string, number>;
  impact: number;
  confidence: number;
  effort: number;
}

export function priorityScore(objectives: readonly ObjectiveWeight[], input: PriorityInput): number {
  const numerator = fitNumerator(objectives, input.fits) * input.impact * input.confidence;
  const denominator = 3 * weightSum(objectives) * input.effort;
  return roundRational(numerator, denominator);
}

export interface RankableFeature {
  id: string;
  name: string;
  priority: number;
  impact: number;
}

export function compareForRank(a: RankableFeature, b: RankableFeature): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.impact !== b.impact) return b.impact - a.impact;
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return a.id < b.id ? -1 : 1;
}

/** Ranks the workspace's non-archived top-level features, 1-based. */
export function rankFeatures<T extends RankableFeature>(features: readonly T[]): Map<string, number> {
  const ordered = [...features].sort(compareForRank);
  const ranks = new Map<string, number>();
  ordered.forEach((feature, index) => ranks.set(feature.id, index + 1));
  return ranks;
}

export function formatTwoDecimals(value: number): string {
  return value.toFixed(2);
}
