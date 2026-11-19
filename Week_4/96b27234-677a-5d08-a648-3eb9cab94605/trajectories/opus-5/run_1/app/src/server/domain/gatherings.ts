import type { LocalParts } from './zones.js';
import { addDays, formatDisplay, formatLocalStamp, parseLocalStamp, resolveLocal } from './zones.js';

export const RECURRENCES = ['none', 'weekly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export type GatheringStatus = 'upcoming' | 'open' | 'ended';

export const OPEN_LEAD_MINUTES = 15;

export const OCCURRENCE_NOTES = {
  gap: "This time doesn't exist that day, so it moves forward.",
  ambiguous: 'This time happens twice that day. This is the first.'
} as const;

export function isRecurrence(value: unknown): value is Recurrence {
  return typeof value === 'string' && (RECURRENCES as readonly string[]).includes(value);
}

export interface GatheringTiming {
  startsLocal: string;
  durationMinutes: number;
  recurrence: Recurrence;
  zone: string;
}

export interface Occurrence {
  startsAt: Date;
  startsLocal: string;
  note: string | null;
  status: GatheringStatus;
}

export interface OccurrenceView {
  startsAt: string;
  startsLocal: string;
  display: string;
  status: GatheringStatus;
  note: string | null;
}

export function occurrenceStatus(startsAt: Date, durationMinutes: number, now: Date): GatheringStatus {
  const start = startsAt.getTime();
  const end = start + durationMinutes * 60000;
  const nowMs = now.getTime();
  if (nowMs >= end) return 'ended';
  if (nowMs >= start - OPEN_LEAD_MINUTES * 60000) return 'open';
  return 'upcoming';
}

function occurrenceAt(timing: GatheringTiming, base: LocalParts, index: number): Occurrence {
  const resolved = resolveLocal(timing.zone, addDays(base, 7 * index));
  const note =
    resolved.kind === 'gap'
      ? OCCURRENCE_NOTES.gap
      : resolved.kind === 'ambiguous'
        ? OCCURRENCE_NOTES.ambiguous
        : null;
  return {
    startsAt: resolved.instant,
    startsLocal: formatLocalStamp(resolved.parts),
    note,
    status: 'upcoming'
  };
}

export function occurrencesOf(timing: GatheringTiming, now: Date, count = 8): Occurrence[] {
  const base = parseLocalStamp(timing.startsLocal);
  if (base === null) return [];
  const durationMs = timing.durationMinutes * 60000;
  const withStatus = (occurrence: Occurrence): Occurrence => ({
    ...occurrence,
    status: occurrenceStatus(occurrence.startsAt, timing.durationMinutes, now)
  });
  const first = occurrenceAt(timing, base, 0);
  if (timing.recurrence === 'none') return [withStatus(first)];

  const weekMs = 7 * 86400000;
  let index = 0;
  const elapsed = now.getTime() - first.startsAt.getTime() - durationMs;
  if (elapsed > 0) index = Math.max(0, Math.floor(elapsed / weekMs));
  for (;;) {
    const candidate = occurrenceAt(timing, base, index);
    if (candidate.startsAt.getTime() + durationMs > now.getTime()) break;
    index += 1;
  }
  const list: Occurrence[] = [];
  for (let step = 0; step < count; step += 1) list.push(withStatus(occurrenceAt(timing, base, index + step)));
  return list;
}

export function viewOccurrence(occurrence: Occurrence, viewerZone: string): OccurrenceView {
  return {
    startsAt: occurrence.startsAt.toISOString(),
    startsLocal: occurrence.startsLocal,
    display: formatDisplay(viewerZone, occurrence.startsAt),
    status: occurrence.status,
    note: occurrence.note
  };
}
