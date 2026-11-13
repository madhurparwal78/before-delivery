import { nextLocalMidnight } from './zones.js';

/** The one place where the effective home zone and a pending change are decided. */

export interface ZoneEntry {
  zone: string;
  effective_from: string;
  effective_from_ms: number;
}

/** The entry with the latest `effective_from` at or before the instant. */
export function effectiveZoneAt(history: ZoneEntry[], instantMs: number): string {
  let effective = history[0]?.zone ?? 'Europe/London';
  for (const entry of history) {
    if (entry.effective_from_ms <= instantMs) effective = entry.zone;
  }
  return effective;
}

export function pendingEntryAt(history: ZoneEntry[], instantMs: number): ZoneEntry | null {
  const future = history
    .filter((entry) => entry.effective_from_ms > instantMs)
    .sort((a, b) => a.effective_from_ms - b.effective_from_ms);
  return future[0] ?? null;
}

export type ZoneChange =
  | { action: 'cancel' }
  | { action: 'replace'; effectiveFromMs: number; zone: string }
  | { action: 'schedule'; effectiveFromMs: number; zone: string };

/**
 * Saving the effective zone cancels any pending change. Saving another zone while one is
 * pending replaces it and keeps its moment. Otherwise the change takes effect at the next
 * true local midnight in the zone effective now.
 */
export function planZoneChange(
  history: ZoneEntry[],
  instantMs: number,
  zone: string,
): ZoneChange {
  const effective = effectiveZoneAt(history, instantMs);
  if (zone === effective) return { action: 'cancel' };
  const pending = pendingEntryAt(history, instantMs);
  if (pending) {
    return { action: 'replace', effectiveFromMs: pending.effective_from_ms, zone };
  }
  return { action: 'schedule', effectiveFromMs: nextLocalMidnight(effective, instantMs), zone };
}
