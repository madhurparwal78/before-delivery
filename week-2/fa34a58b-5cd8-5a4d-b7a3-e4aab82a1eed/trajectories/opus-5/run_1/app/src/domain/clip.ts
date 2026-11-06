/** The clip confirmation rule is decided here and nowhere else. */

import type { ClipState } from '../shared/types';
import type { HouseholdDay } from './time';

export const MIN_CLIP_BYTES = 1;
export const MAX_CLIP_BYTES = 20_000_000;

export function clipObjectKey(cameraId: string, day: HouseholdDay, clipId: string): string {
  return `clips/${cameraId}/${day}/${clipId}.mp4`;
}

export function isDeclaredSizeValid(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_CLIP_BYTES &&
    value <= MAX_CLIP_BYTES
  );
}

export function clipAcceptsBytes(state: ClipState): boolean {
  return state === 'announced' || state === 'storing';
}

export type ClipConfirmation =
  | { state: 'stored'; stored_size: number }
  | { state: 'size_mismatch'; stored_size: number };

/**
 * A clip is stored only when object storage reports the object at exactly the
 * declared size; any other size is a mismatch and the object is dropped.
 */
export function confirmClip(declaredSize: number, reportedSize: number): ClipConfirmation {
  if (reportedSize === declaredSize) return { state: 'stored', stored_size: reportedSize };
  return { state: 'size_mismatch', stored_size: reportedSize };
}
