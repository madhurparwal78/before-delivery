import { isCancelled } from "../shared/status.js";
import { type BookingData, holdsSeat } from "./bookings.js";
import { config } from "./config.js";

export const UPLOAD_LIMIT_BYTES = 10_000_000;
export const MAX_FILES_PER_BOOKING = 10;

/**
 * Whether the interpreter may still get prep links and fetch files: they hold a seat, the booking is not cancelled,
 * and the grace period after the assignment's end (its completion once completed) has not run out.
 */
export function prepAccessOpen(data: BookingData, interpreterId: string, nowMs: number): boolean {
  const { row } = data;
  if (isCancelled(row.phase)) return false;
  if (!holdsSeat(data, interpreterId)) return false;
  const endedAt = (row.completed_at ?? row.end_at).getTime();
  return nowMs < endedAt + config.prepAccessGraceMinutes * 60_000;
}
