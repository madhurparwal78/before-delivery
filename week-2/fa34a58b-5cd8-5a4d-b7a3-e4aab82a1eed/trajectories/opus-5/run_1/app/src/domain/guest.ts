/** The guest scene transition rules are decided here and nowhere else. */

import type { GuestSceneRow } from '../repo';
import type { GuestSceneState } from '../shared/types';

export const MAX_GUEST_DAYS = 14;

export type GuestTransition = 'active' | 'ended' | null;

/** What the hub clock reaching `now` does to a guest scene. Ends are inclusive. */
export function guestTransitionAt(row: GuestSceneRow, now: Date): GuestTransition {
  const time = now.getTime();
  if (row.state === 'scheduled') {
    if (time >= row.ends_at.getTime()) return 'ended';
    if (time >= row.starts_at.getTime()) return 'active';
    return null;
  }
  if (row.state === 'active' && time >= row.ends_at.getTime()) return 'ended';
  return null;
}

export function isGuestClosed(state: GuestSceneState): boolean {
  return state === 'ended' || state === 'cancelled';
}

/** A new guest scene is active from the off when its start is not in the future. */
export function initialGuestState(startsAt: Date, now: Date): GuestSceneState {
  return startsAt.getTime() <= now.getTime() ? 'active' : 'scheduled';
}

/** Two guest scenes in one room clash when their half-open windows overlap. */
export function guestWindowsOverlap(
  a: { starts_at: Date; ends_at: Date },
  b: { starts_at: Date; ends_at: Date },
): boolean {
  return a.starts_at.getTime() < b.ends_at.getTime() && b.starts_at.getTime() < a.ends_at.getTime();
}
