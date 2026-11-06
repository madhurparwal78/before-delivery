/**
 * Station occupancy and the conflict answer. A hold or a confirmed, checked-in
 * or completed booking occupies its station from its start to its end plus its
 * own sanitation buffer; a maintenance block occupies its own range only.
 */

import {
  MINUTE_MS,
  SLOT_MS,
  endOfKitchenDay,
  kitchenHhmm,
} from '../../shared/kitchenTime.js';
import { MAX_BOOKING_MINUTES } from '../../shared/pricing.js';

export interface OccupiedRange {
  kind: 'booking' | 'maintenance';
  /** Start of the occupied range. */
  startMs: number;
  /** End of the range's own time, before any buffer. */
  ownEndMs: number;
  /** End of the occupied range, buffer included. */
  endMs: number;
}

export interface ConflictDetails {
  blocked_by: 'booking' | 'buffer' | 'maintenance';
  blocked_at: string;
  legal_end: string | null;
}

export function occupiedEnd(endMs: number, bufferMinutes: number): number {
  return endMs + bufferMinutes * MINUTE_MS;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** The ranges a requested booking would collide with, earliest first. */
function collisions(
  startMs: number,
  endMs: number,
  bufferMinutes: number,
  ranges: readonly OccupiedRange[],
): OccupiedRange[] {
  const ourEnd = occupiedEnd(endMs, bufferMinutes);
  return ranges
    .filter((range) => overlaps(startMs, ourEnd, range.startMs, range.endMs))
    .sort((a, b) => a.startMs - b.startMs);
}

export function hasCollision(
  startMs: number,
  endMs: number,
  bufferMinutes: number,
  ranges: readonly OccupiedRange[],
): boolean {
  return collisions(startMs, endMs, bufferMinutes, ranges).length > 0;
}

/**
 * The latest 15-minute end after `startMs` whose occupied range collides with
 * nothing, or `null` when no such end exists. The search is bounded by the six
 * hour maximum and the end of the kitchen day.
 */
export function latestLegalEnd(
  date: string,
  startMs: number,
  bufferMinutes: number,
  ranges: readonly OccupiedRange[],
): string | null {
  const dayEnd = endOfKitchenDay(date);
  const limit = Math.min(startMs + MAX_BOOKING_MINUTES * MINUTE_MS, dayEnd);
  let legal: number | null = null;
  for (let end = startMs + SLOT_MS; end <= limit; end += SLOT_MS) {
    if (hasCollision(startMs, end, bufferMinutes, ranges)) break;
    legal = end;
  }
  if (legal === null) return null;
  return legal === dayEnd ? '24:00' : kitchenHhmm(legal);
}

/** The `slot_conflict` detail for a requested range that collides. */
export function describeConflict(
  date: string,
  startMs: number,
  endMs: number,
  bufferMinutes: number,
  ranges: readonly OccupiedRange[],
): ConflictDetails | null {
  const colliding = collisions(startMs, endMs, bufferMinutes, ranges);
  const first = colliding[0];
  if (!first) return null;
  const ourEnd = occupiedEnd(endMs, bufferMinutes);
  const blockedBy: ConflictDetails['blocked_by'] =
    first.kind === 'maintenance'
      ? 'maintenance'
      : overlaps(startMs, ourEnd, first.startMs, first.ownEndMs)
        ? 'booking'
        : 'buffer';
  return {
    blocked_by: blockedBy,
    blocked_at: kitchenHhmm(first.startMs),
    legal_end: latestLegalEnd(date, startMs, bufferMinutes, ranges),
  };
}
