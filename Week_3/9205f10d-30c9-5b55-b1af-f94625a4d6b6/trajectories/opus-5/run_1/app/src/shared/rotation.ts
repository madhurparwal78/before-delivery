import type { SeatLabel } from './types.js';

export interface RotationSegment {
  index: number;
  start_minute: number;
  end_minute: number;
  active_label: SeatLabel;
  support_label: SeatLabel | null;
}

/**
 * The one rotation rule: a job of length L with interval R has ceil(L / R) segments;
 * segment k runs from k*R to min((k+1)*R, L); seat A is active in even segments and
 * seat B in odd ones. A one-seat job is active on that seat throughout, with no support.
 */
export function rotationSegments(
  durationMinutes: number,
  rotationMinutes: number,
  seatLabels: readonly SeatLabel[],
): RotationSegment[] {
  const count = Math.max(1, Math.ceil(durationMinutes / rotationMinutes));
  const solo = seatLabels.length < 2;
  const segments: RotationSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const activeLabel = solo ? (seatLabels[0] ?? 'A') : index % 2 === 0 ? 'A' : 'B';
    segments.push({
      index,
      start_minute: index * rotationMinutes,
      end_minute: Math.min((index + 1) * rotationMinutes, durationMinutes),
      active_label: activeLabel,
      support_label: solo ? null : activeLabel === 'A' ? 'B' : 'A',
    });
  }
  return segments;
}

/** The segment holding the playhead at minute m. */
export function segmentAtMinute(
  minute: number,
  rotationMinutes: number,
  segmentCount: number,
): number {
  return Math.min(Math.floor(minute / rotationMinutes), segmentCount - 1);
}
