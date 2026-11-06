/**
 * Release state machine, slots and holds — the single decision place.
 */
import { zurichParts } from '../../shared/dates.ts';

export type ReleaseStatus = 'requested' | 'booked' | 'staged' | 'released' | 'cancelled';
export type ReleaseAction = 'request' | 'book' | 'stage' | 'complete' | 'cancel';

export function releaseAllows(
  action: ReleaseAction,
  status: ReleaseStatus,
  byOwner: boolean,
): boolean {
  switch (action) {
    case 'request':
      return false; // handled at creation
    case 'book':
      return status === 'requested';
    case 'stage':
      return status === 'booked';
    case 'complete':
      return status === 'staged';
    case 'cancel':
      if (byOwner) return status === 'requested' || status === 'booked';
      return status === 'requested' || status === 'booked' || status === 'staged';
  }
}

export function isOpenRelease(status: ReleaseStatus): boolean {
  return status === 'requested' || status === 'booked' || status === 'staged';
}

export const SLOT_START_MINUTES = 8 * 60; // 08:00
export const SLOT_END_MINUTES = 17 * 60 + 30; // 17:30
export const SLOT_NOTICE_SECONDS = 48 * 3600;
export const SLOT_GRID_MINUTES = 30;

/** Validate a slot string: half-hour grid, 08:00–17:30, Monday to Saturday. */
export function slotGridProblem(slot: string): 'format' | 'grid' | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(slot);
  if (!match) return 'format';
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const minutes = hour * 60 + minute;
  if (minute % SLOT_GRID_MINUTES !== 0) return 'grid';
  if (minutes < SLOT_START_MINUTES || minutes > SLOT_END_MINUTES) return 'grid';
  const weekday = weekdayOfSlot(slot);
  if (weekday === 0) return 'grid'; // Sunday
  return null;
}

function weekdayOfSlot(slot: string): number {
  const [, y, m, d] = slot.split(/[-T]/);
  const utc = Date.UTC(Number(y), Number(m) - 1, Number(d));
  return new Date(utc).getUTCDay();
}

/** First slot on the grid at least 48 hours ahead, Zurich time. */
export function earliestSlot(nowMs: number): { slot: string; utcMs: number } {
  const target = nowMs + SLOT_NOTICE_SECONDS * 1000;
  let candidate = firstGridAtOrAfter(target);
  for (let i = 0; i < 400; i++) {
    const probe = candidate;
    const problem = slotGridProblem(probe.slot);
    if (!problem) {
      return probe;
    }
    candidate = nextSlotAfter(probe);
  }
  throw new Error('No slot found');
}

function firstGridAtOrAfter(ms: number): { slot: string; utcMs: number } {
  // round up to the next half hour
  const rounded = Math.ceil(ms / (SLOT_GRID_MINUTES * 60_000)) * (SLOT_GRID_MINUTES * 60_000);
  const slot = slotFromUtc(rounded);
  return { slot, utcMs: rounded };
}

function nextSlotAfter(current: { slot: string; utcMs: number }): { slot: string; utcMs: number } {
  const next = current.utcMs + SLOT_GRID_MINUTES * 60_000;
  return { slot: slotFromUtc(next), utcMs: next };
}

export function slotFromUtc(ms: number): string {
  const d = new Date(ms);
  const parts = zurichParts(d);
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  const hour = String(parts.hour).padStart(2, '0');
  const minute = String(parts.minute).padStart(2, '0');
  return `${parts.year}-${month}-${day}T${hour}:${minute}`;
}
