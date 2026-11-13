import { localParts, zoneOffsetMs, offsetLabel, localMidnightOf } from "./tz";

/** Histogram intervals from rule G, smallest first. */
export const INTERVALS: [name: string, ms: number][] = [
  ["1s", 1000],
  ["5s", 5000],
  ["10s", 10000],
  ["30s", 30000],
  ["1m", 60000],
  ["5m", 300000],
  ["10m", 600000],
  ["30m", 1800000],
  ["1h", 3600000],
  ["3h", 10800000],
  ["12h", 43200000],
  ["1d", 86400000],
  ["1w", 604800000],
];

export interface Bucket {
  start: number;
  end: number;
  count: number;
  label: string;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

export function bucketLabel(zone: string, start: number, end: number, intervalMs: number): string {
  const p = localParts(zone, start);
  const offset = zoneOffsetMs(zone, start);
  const off = offsetLabel(offset);
  const date = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  const withinOneDay =
    localParts(zone, start).day === localParts(zone, Math.max(end - 1, start)).day &&
    localParts(zone, start).year === localParts(zone, Math.max(end - 1, start)).year &&
    localParts(zone, start).month === localParts(zone, Math.max(end - 1, start)).month;
  const time = intervalMs < 60000
    ? `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)} ${off}`
    : `${pad2(p.hour)}:${pad2(p.minute)} ${off}`;
  if (withinOneDay) return time;
  return `${date} ${time}`;
}

/** Choose the interval: the smallest with at most 60 buckets touching the range. */
export function chooseInterval(rangeMs: number): [string, number] {
  for (const [name, ms] of INTERVALS) {
    if (rangeMs <= 60 * ms) return [name, ms];
  }
  return INTERVALS[INTERVALS.length - 1];
}

/**
 * Bucket boundaries (rule G). For intervals under 1d: boundaries are the local midnight of the
 * day holding the range start plus whole multiples of the interval in elapsed time. A 1d bucket
 * runs local midnight to local midnight; a 1w bucket from Monday's local midnight.
 */
export function buildBuckets(
  zone: string,
  from: number,
  to: number,
  intervalName: string,
  intervalMs: number,
): Bucket[] {
  const buckets: Bucket[] = [];
  if (intervalMs < 86400000) {
    const anchor = localMidnightOf(zone, from);
    let start = anchor;
    while (start + intervalMs <= from) start += intervalMs;
    let i = 0;
    while (start < to && i < 200) {
      const end = start + intervalMs;
      buckets.push({ start, end, count: 0, label: "" });
      start = end;
      i += 1;
    }
  } else if (intervalMs === 86400000) {
    // local midnight to local midnight
    let start = localMidnightOf(zone, from);
    while (start + 86400000 <= from) {
      // advance to next local midnight respecting DST
      const next = nextLocalMidnight(zone, start);
      if (next > from) break;
      start = next;
    }
    let i =  0;
    while (start < to && i < 200) {
      const end = nextLocalMidnight(zone, start);
      buckets.push({ start, end, count: 0, label: "" });
      start = end;
      i += 1;
    }
  } else {
    // 1w: Monday's local midnight
    let start = localMidnightOf(zone, from);
    // walk back to Monday
    for (let k = 0; k < 8; k++) {
      const p = localParts(zone, start);
      const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
      if (dow === 1) break;
      start = localMidnightOf(zone, start - 86400000);
    }
    while (start + intervalMs <= from) start = nextLocalMidnight(zone, start);
    let i = 0;
    while (start < to && i < 200) {
      const end = nextLocalMidnight(zone, start) + 6 * 86400000;
      // align to next Monday midnight
      let e = start;
      for (let k = 0; k < 7; k++) e = nextLocalMidnight(zone, e);
      buckets.push({ start, end: e, count: 0, label: "" });
      start = e;
      i += 1;
    }
  }
  for (const b of buckets) b.label = bucketLabel(zone, b.start, b.end, intervalMs);
  return buckets;
}

function nextLocalMidnight(zone: string, from: number): number {
  const guess = from + 24 * 3600000;
  const base = localMidnightOf(zone, guess);
  if (base > from) return base;
  return localMidnightOf(zone, guess + 3600000);
}
