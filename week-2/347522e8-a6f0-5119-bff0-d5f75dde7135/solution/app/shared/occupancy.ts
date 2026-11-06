// Station occupancy and the conflict answer, defined once. Positions are any consistent number
// line: the server uses instants, the board uses wall-clock minutes of the shown day.

export interface OccupiedRange {
  kind: "booking" | "maintenance";
  /** A booking's own start and end; a maintenance block's start and end. */
  start: number;
  end: number;
  /** The end of the occupied range: a booking's end plus its buffer, a block's end. */
  occupiedEnd: number;
}

type BlockedBy = "booking" | "buffer" | "maintenance";

/** A booking is 15 minutes to six hours long. */
export const MAX_BOOKING_MINUTES = 360;

interface Collision {
  blockedBy: BlockedBy;
  range: OccupiedRange;
}

/** Ranges that only touch end-to-start do not overlap. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** The first range (by start) that the occupied span [from, to) collides with, or null. */
export function firstCollision(ranges: readonly OccupiedRange[], from: number, to: number): Collision | null {
  const hit = ranges
    .filter((range) => overlaps(from, to, range.start, range.occupiedEnd))
    .sort((a, b) => a.start - b.start)[0];
  if (!hit) return null;
  if (hit.kind === "maintenance") return { blockedBy: "maintenance", range: hit };
  return { blockedBy: overlaps(from, to, hit.start, hit.end) ? "booking" : "buffer", range: hit };
}

export interface EndCandidate<T> {
  /** What the caller reports for this end (an `HH:MM`, a minute count). */
  end: T;
  /** Where the occupied span of a booking ending here stops (its end plus its buffer). */
  occupiedEnd: number;
}

/**
 * The latest candidate end whose occupied span from `from` collides with nothing, or null.
 * Candidates are the 15-minute ends after the start, in increasing order.
 */
export function latestLegalEnd<T>(ranges: readonly OccupiedRange[], from: number, candidates: readonly EndCandidate<T>[]): T | null {
  let legal: T | null = null;
  for (const candidate of candidates) {
    if (firstCollision(ranges, from, candidate.occupiedEnd)) break;
    legal = candidate.end;
  }
  return legal;
}
