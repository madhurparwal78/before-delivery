// A move's instants: its boarding instant, its notice verdict and its accrued detention, all by the
// server's clock and real elapsed time.
import { noticeCutoff, readPortMinute } from "../../shared/portTime.js";
import type { Move } from "../../shared/types.js";
import type { MoveRecord } from "../store.js";

export function boardingInstant(move: MoveRecord): number {
  const read = readPortMinute(move.boarding_at);
  if (read.kind !== "ok") throw new RangeError(`move ${move.ref} holds an invalid boarding time`);
  return read.instant;
}

/** Late when the server's clock is past the cutoff instant; exactly at the cutoff is on time. */
export function noticeOf(move: MoveRecord, now: number): Move["notice"] {
  const cutoff = noticeCutoff(boardingInstant(move));
  return { state: now > cutoff.instant ? "late" : "on_time", cutoff_at: cutoff.at, cutoff_utc_offset: cutoff.utcOffset };
}

/** Whole seconds of detention accrued at or after the ordered time, summed over every span. */
export function detentionSeconds(move: MoveRecord, now: number): number {
  const ordered = boardingInstant(move);
  const ms = move.detention.reduce((sum, span) => sum + Math.max(0, (span.end ?? now) - Math.max(span.start, ordered)), 0);
  return Math.floor(ms / 1000);
}

export const detained = (move: MoveRecord): boolean => move.detention.some((span) => span.end === null);
