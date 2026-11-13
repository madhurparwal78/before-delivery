const epochAnchorMs = Date.now();
const monotonicAnchorMs = performance.now();

/** Epoch milliseconds measured off the process monotonic clock. */
export function serverNow(): number {
  return Math.round(epochAnchorMs + (performance.now() - monotonicAnchorMs));
}
