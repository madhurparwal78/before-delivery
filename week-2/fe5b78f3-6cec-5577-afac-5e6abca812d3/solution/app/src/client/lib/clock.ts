// The business clock as the server publishes it: read once from GET /api/clock, then advanced with a monotonic
// timer at `rate` business seconds per real second. The device date is never read.
import type { ClockBody } from "../../shared/api";
import { api } from "./api";

export { istTimestamp } from "../../shared/format";

export interface ServerClock {
  /** Business time now, epoch milliseconds. */
  now(): number;
}

export async function readClock(): Promise<ServerClock> {
  const body = await api<ClockBody>("/api/clock");
  const base = Date.parse(body.now);
  const startedAt = performance.now();
  return { now: () => base + (performance.now() - startedAt) * body.rate };
}

export function parseTimestamp(timestamp: string): number {
  return Date.parse(timestamp);
}
