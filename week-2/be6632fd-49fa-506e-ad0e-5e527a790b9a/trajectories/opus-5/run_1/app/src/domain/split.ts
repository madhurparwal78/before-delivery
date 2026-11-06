export interface SplitRequest {
  /** Identifies the requesting allocation; carried through to the result. */
  key: string;
  requestedQuantity: number;
  /** Ties on the fractional remainder go to the earliest request. */
  requestedAtMs: number;
}

export interface SplitShare {
  key: string;
  allocatedQuantity: number;
}

/**
 * The largest-remainder split of one style's wholesale edition across stockist requests.
 *
 * Within the edition every stockist gets exactly what it requested. Above it each gets its
 * proportional share rounded down, and the leftover pieces go one each by largest fractional
 * remainder, with ties to the earliest request.
 */
export function splitEdition(edition: number, requests: readonly SplitRequest[]): SplitShare[] {
  const totalRequested = requests.reduce((sum, request) => sum + request.requestedQuantity, 0);
  if (totalRequested <= edition) {
    return requests.map((request) => ({ key: request.key, allocatedQuantity: request.requestedQuantity }));
  }

  const scaled = requests.map((request, index) => {
    const numerator = edition * request.requestedQuantity;
    return {
      key: request.key,
      index,
      requestedAtMs: request.requestedAtMs,
      floor: Math.floor(numerator / totalRequested),
      remainder: numerator % totalRequested,
    };
  });

  let leftover = edition - scaled.reduce((sum, share) => sum + share.floor, 0);
  const byRemainder = [...scaled].sort(
    (a, b) => b.remainder - a.remainder || a.requestedAtMs - b.requestedAtMs || a.index - b.index,
  );
  const extra = new Set<string>();
  for (const share of byRemainder) {
    if (leftover <= 0) break;
    extra.add(share.key);
    leftover -= 1;
  }

  return scaled.map((share) => ({
    key: share.key,
    allocatedQuantity: share.floor + (extra.has(share.key) ? 1 : 0),
  }));
}
