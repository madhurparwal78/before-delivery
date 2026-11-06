/** The pickup window: the one place packing time is judged. */

export const PICKUP_LEAD_MS = 12 * 60 * 60 * 1000;
export const MAX_PICKUP_LENGTH_MS = 12 * 60 * 60 * 1000;

export function withinPickupWindow(nowMs: number, startMs: number, endMs: number): boolean {
  return nowMs >= startMs - PICKUP_LEAD_MS && nowMs <= endMs;
}

export function pickupLengthAllowed(startMs: number, endMs: number): boolean {
  return endMs - startMs <= MAX_PICKUP_LENGTH_MS;
}
