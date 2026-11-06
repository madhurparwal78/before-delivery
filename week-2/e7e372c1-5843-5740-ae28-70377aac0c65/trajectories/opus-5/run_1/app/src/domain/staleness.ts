/** ETH staleness. A gap of exactly the threshold still counts as live. */
export function isEthStale(
  lastEthTickMs: number | null,
  marketClockMs: number,
  thresholdSeconds: number,
): boolean {
  if (lastEthTickMs === null) return true;
  return marketClockMs - lastEthTickMs > thresholdSeconds * 1000;
}
