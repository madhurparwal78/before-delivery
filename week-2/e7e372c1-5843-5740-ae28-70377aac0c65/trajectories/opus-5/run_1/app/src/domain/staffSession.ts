/**
 * Staff session expiry. Measured on real time, never on the market clock. A
 * request exactly at the limit still counts.
 */
export function isStaffSessionExpired(
  lastRequestRealMs: number,
  nowRealMs: number,
  idleSeconds: number,
): boolean {
  return nowRealMs - lastRequestRealMs > idleSeconds * 1000;
}
