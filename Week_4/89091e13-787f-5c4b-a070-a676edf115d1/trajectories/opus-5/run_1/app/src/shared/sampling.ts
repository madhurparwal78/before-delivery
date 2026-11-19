/** The published seeded generator. Each call advances the 32-bit state. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleSeed(baseSeed: number, height: number, nodeNumber: number): number {
  return Number((BigInt(baseSeed) + 7919n * BigInt(height) + 104729n * BigInt(nodeNumber)) % 4294967296n);
}

export interface SampleCoordinate {
  row: number;
  col: number;
}

/** The first `count` samples of a node's sequence for one block. */
export function sampleSequence(
  baseSeed: number,
  height: number,
  nodeNumber: number,
  k: number,
  count: number,
): SampleCoordinate[] {
  const rng = mulberry32(sampleSeed(baseSeed, height, nodeNumber));
  const width = 2 * k;
  const out: SampleCoordinate[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(rng() * width);
    const col = Math.floor(rng() * width);
    out.push({ row, col });
  }
  return out;
}

const PERCENT_DECIMALS = 4n;
const PERCENT_SCALE = 10n ** PERCENT_DECIMALS;

function confidenceFraction(k: number, samples: number): { numerator: bigint; denominator: bigint } {
  const total = BigInt(2 * k) ** 2n;
  const withheld = BigInt(k + 1) ** 2n;
  const served = total - withheld;
  const s = BigInt(samples);
  return { numerator: total ** s - served ** s, denominator: total ** s };
}

/** Confidence after s samples as a percentage with 4 decimals. */
export function confidencePercent(k: number, samples: number): string {
  if (samples === 0) return '0.0000';
  const { numerator, denominator } = confidenceFraction(k, samples);
  const scaled = numerator * 100n * PERCENT_SCALE;
  const rounded = (2n * scaled + denominator) / (2n * denominator);
  const whole = rounded / PERCENT_SCALE;
  const fraction = rounded % PERCENT_SCALE;
  return `${whole}.${fraction.toString().padStart(Number(PERCENT_DECIMALS), '0')}`;
}

/** A node marks a block Available once confidence is at least 99%. */
export function isConfident(k: number, samples: number): boolean {
  if (samples === 0) return false;
  const { numerator, denominator } = confidenceFraction(k, samples);
  return numerator * 100n >= denominator * 99n;
}
