import { bucketLabel, localMidnight, localMondayMidnight } from './tz.js';

export type IntervalName =
  | '1s'
  | '5s'
  | '10s'
  | '30s'
  | '1m'
  | '5m'
  | '10m'
  | '30m'
  | '1h'
  | '3h'
  | '12h'
  | '1d'
  | '1w';

export const INTERVALS: { name: IntervalName; ms: number }[] = [
  { name: '1s', ms: 1000 },
  { name: '5s', ms: 5000 },
  { name: '10s', ms: 10000 },
  { name: '30s', ms: 30000 },
  { name: '1m', ms: 60000 },
  { name: '5m', ms: 300000 },
  { name: '10m', ms: 600000 },
  { name: '30m', ms: 1800000 },
  { name: '1h', ms: 3600000 },
  { name: '3h', ms: 10800000 },
  { name: '12h', ms: 43200000 },
  { name: '1d', ms: 86400000 },
  { name: '1w', ms: 604800000 },
];

export const MAX_BUCKETS = 60;

export type Bucket = { start: number; end: number; count: number; label: string };

function boundaries(zone: string, fromMs: number, toMs: number, interval: IntervalName): number[] {
  const edges: number[] = [];
  if (interval === '1d') {
    let edge = localMidnight(zone, fromMs);
    edges.push(edge);
    for (let guard = 0; guard < 400 && edge < toMs; guard += 1) {
      const next = localMidnight(zone, edge + 36 * 3600000);
      edges.push(next);
      edge = next;
    }
    return edges;
  }
  if (interval === '1w') {
    let edge = localMondayMidnight(zone, fromMs);
    edges.push(edge);
    for (let guard = 0; guard < 400 && edge < toMs; guard += 1) {
      const next = localMondayMidnight(zone, edge + 8 * 86400000);
      edges.push(next);
      edge = next;
    }
    return edges;
  }
  const step = INTERVALS.find((entry) => entry.name === interval)!.ms;
  const anchor = localMidnight(zone, fromMs);
  const firstIndex = Math.floor((fromMs - anchor) / step);
  let edge = anchor + firstIndex * step;
  edges.push(edge);
  for (let guard = 0; guard < 5000 && edge < toMs; guard += 1) {
    edge += step;
    edges.push(edge);
  }
  return edges;
}

function bucketCount(zone: string, fromMs: number, toMs: number, interval: IntervalName): number {
  const edges = boundaries(zone, fromMs, toMs, interval);
  let count = 0;
  for (let index = 0; index + 1 < edges.length; index += 1) {
    if (edges[index + 1] <= fromMs) continue;
    if (edges[index] >= toMs) break;
    count += 1;
  }
  return count;
}

/** Rule G: the smallest interval for which at most 60 buckets touch the range. */
export function chooseInterval(zone: string, fromMs: number, toMs: number): IntervalName {
  for (const entry of INTERVALS) {
    if (bucketCount(zone, fromMs, toMs, entry.name) <= MAX_BUCKETS) return entry.name;
  }
  return '1w';
}

export function buildBuckets(
  zone: string,
  fromMs: number,
  toMs: number,
  interval: IntervalName,
  timestamps: number[],
): Bucket[] {
  const edges = boundaries(zone, fromMs, toMs, interval);
  const startOfDay = localMidnight(zone, fromMs);
  const lastInstant = Math.max(fromMs, toMs - 1);
  const sameDay = localMidnight(zone, lastInstant) === startOfDay;
  const intervalMs = INTERVALS.find((entry) => entry.name === interval)!.ms;
  const buckets: Bucket[] = [];
  for (let index = 0; index + 1 < edges.length; index += 1) {
    const rawStart = edges[index];
    const rawEnd = edges[index + 1];
    if (rawEnd <= fromMs) continue;
    if (rawStart >= toMs) break;
    const start = Math.max(rawStart, fromMs);
    const end = Math.min(rawEnd, toMs);
    buckets.push({
      start,
      end,
      count: 0,
      label: bucketLabel(zone, start, intervalMs, sameDay),
    });
  }
  for (const timestamp of timestamps) {
    for (const bucket of buckets) {
      if (timestamp >= bucket.start && timestamp < bucket.end) {
        bucket.count += 1;
        break;
      }
    }
  }
  return buckets;
}
