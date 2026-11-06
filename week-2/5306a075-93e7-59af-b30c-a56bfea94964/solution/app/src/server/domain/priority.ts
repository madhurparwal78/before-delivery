// Objective fit, priority and rank (brief: Business rules › Objective fit, priority and rank). The only copy.
//   objectiveFit = Σ(weight × fit) ÷ (3 × Σ weights)          (0 when Σ weights is 0)
//   priority     = 100 × objectiveFit × impact × (confidence ÷ 100) ÷ effort
// Both are exact rationals rounded half away from zero to hundredths; values are never negative.

export interface ScoreInputs {
  weights: readonly { id: string; weight: number }[];
  fits: Readonly<Record<string, number>>;
  impact: number;
  confidence: number;
  effort: number;
}

export interface Scores { objectiveFitCents: number; priorityCents: number }

function roundHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((2n * numerator + denominator) / (2n * denominator));
}

export function score(inputs: ScoreInputs): Scores {
  const totalWeight = BigInt(inputs.weights.reduce((sum, o) => sum + o.weight, 0));
  if (totalWeight === 0n) return { objectiveFitCents: 0, priorityCents: 0 };
  const weighted = BigInt(inputs.weights.reduce((sum, o) => sum + o.weight * (inputs.fits[o.id] ?? 0), 0));
  return {
    objectiveFitCents: roundHalfUp(100n * weighted, 3n * totalWeight),
    priorityCents: roundHalfUp(
      100n * weighted * BigInt(inputs.impact) * BigInt(inputs.confidence),
      3n * totalWeight * BigInt(inputs.effort),
    ),
  };
}

/** Hundredths as the API's two-decimal number. */
export const asNumber = (cents: number): number => cents / 100;

/** Hundredths as text with both decimals kept ("33.60"). */
export const asText = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export interface Rankable { priorityCents: number; impact: number; name: string }

/** Rank order: priority high first, then impact high first, then current name A–Z ignoring case. */
export function compareRank(a: Rankable, b: Rankable): number {
  if (a.priorityCents !== b.priorityCents) return b.priorityCents - a.priorityCents;
  if (a.impact !== b.impact) return b.impact - a.impact;
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
