import { CLEANING_BUFFER_MINUTES } from './constants.js';

const BUFFER_MS = CLEANING_BUFFER_MINUTES * 60_000;

export interface OccupiedSpan {
  tenantId: string;
  startAt: Date;
  endAt: Date;
}

export interface RequestedSpan {
  date: string;
  startAt: Date;
  endAt: Date;
}

/**
 * A span is free when it overlaps nothing on the station and keeps the cleaning buffer
 * away from every block of a different tenant. One tenant's own blocks may touch.
 */
function spanIsFree(
  span: RequestedSpan,
  tenantId: string,
  occupied: readonly OccupiedSpan[],
): boolean {
  const start = span.startAt.getTime();
  const end = span.endAt.getTime();
  for (const block of occupied) {
    const blockStart = block.startAt.getTime();
    const blockEnd = block.endAt.getTime();
    const gap = block.tenantId === tenantId ? 0 : BUFFER_MS;
    if (blockEnd + gap > start && blockStart - gap < end) return false;
  }
  return true;
}

export function conflictingDates(
  spans: readonly RequestedSpan[],
  tenantId: string,
  occupied: readonly OccupiedSpan[],
): string[] {
  return spans.filter((span) => !spanIsFree(span, tenantId, occupied)).map((span) => span.date);
}

export interface DayBlock {
  tenantId: string;
  startMinute: number;
  endMinute: number;
}

/** The 30 minutes after each run of one tenant's touching blocks, cut off at midnight. */
export function cleaningSpans(blocks: readonly DayBlock[]): { startMinute: number; endMinute: number }[] {
  const sorted = [...blocks].sort((a, b) => a.startMinute - b.startMinute);
  const spans: { startMinute: number; endMinute: number }[] = [];
  let index = 0;
  while (index < sorted.length) {
    const run = sorted[index]!;
    let end = run.endMinute;
    let next = index + 1;
    while (next < sorted.length) {
      const candidate = sorted[next]!;
      if (candidate.tenantId !== run.tenantId || candidate.startMinute > end) break;
      end = Math.max(end, candidate.endMinute);
      next += 1;
    }
    if (end < 1440) {
      spans.push({ startMinute: end, endMinute: Math.min(end + CLEANING_BUFFER_MINUTES, 1440) });
    }
    index = next;
  }
  return spans;
}
