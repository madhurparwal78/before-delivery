/** mulberry32, exactly as published. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The first `count` sample coordinates of one light node for one block (with replacement). */
export function sampleSequence(
  sampleSeed: number,
  height: number,
  nodeNumber: number,
  k: number,
  count: number,
): Array<{ row: number; col: number }> {
  const rng = mulberry32((sampleSeed + 7919 * height + 104729 * nodeNumber) % 2 ** 32);
  const out: Array<{ row: number; col: number }> = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(rng() * 2 * k);
    const col = Math.floor(rng() * 2 * k);
    out.push({ row, col });
  }
  return out;
}

/** Chance that one uniform sample hits a withheld share: p = (k+1)^2 / (2k)^2, as numerator and denominator. */
function hitChance(k: number): [bigint, bigint] {
  return [BigInt((k + 1) ** 2), BigInt((2 * k) ** 2)];
}

/** Confidence after s samples, 1 - (1 - p)^s, as a percentage with 4 decimals (half up, from exact fractions). */
export function confidence(k: number, samples: number): string {
  const [hit, total] = hitChance(k);
  const miss = (total - hit) ** BigInt(samples);
  const all = total ** BigInt(samples);
  const scaled = ((all - miss) * 1_000_000n * 2n + all) / (all * 2n);
  return `${scaled / 10_000n}.${String(scaled % 10_000n).padStart(4, "0")}`;
}

/** Confidence has reached the 99% threshold (exact: (1 - p)^s <= 1/100). */
export function reachesThreshold(k: number, samples: number): boolean {
  const [hit, total] = hitChance(k);
  return (total - hit) ** BigInt(samples) * 100n <= total ** BigInt(samples);
}
