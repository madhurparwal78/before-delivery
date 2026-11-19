export const LOCK_LEASE_SECONDS = 30;
export const LOCK_LEASE_MS = LOCK_LEASE_SECONDS * 1000;
export const HEARTBEAT_SECONDS = 10;
export const PRESENCE_TTL_SECONDS = 30;
const PRESENCE_COLOURS = ["blue", "green", "yellow", "violet", "orange", "red"] as const;

export const leaseExpiry = (leaseMs: number, now = Date.now()): string => new Date(now + leaseMs).toISOString();

export function colourFor(joinIndex: number): string {
  return PRESENCE_COLOURS[joinIndex % PRESENCE_COLOURS.length] ?? "blue";
}
