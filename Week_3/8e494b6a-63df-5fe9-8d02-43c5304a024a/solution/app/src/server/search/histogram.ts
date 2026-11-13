// Histogram intervals, bucket edges and labels (Business rules G), aligned in the viewer's zone.
import { formatIso } from "../../shared/time";
import { addLocalDays, formatOffset, localWeekday, offsetMinutesAt, sameLocalDay, startOfLocalDay, wallTimeAt } from "../../shared/zone";

const MAX_BUCKETS = 60;
const FIXED: Array<{ name: string; ms: number }> = [
  { name: "1s", ms: 1000 }, { name: "5s", ms: 5000 }, { name: "10s", ms: 10_000 }, { name: "30s", ms: 30_000 },
  { name: "1m", ms: 60_000 }, { name: "5m", ms: 300_000 }, { name: "10m", ms: 600_000 }, { name: "30m", ms: 1_800_000 },
  { name: "1h", ms: 3_600_000 }, { name: "3h", ms: 10_800_000 }, { name: "12h", ms: 43_200_000 },
];

interface Bucket {
  start: number;
  end: number;
}

interface LabelledBucket {
  start: string;
  end: string;
  count: number;
  label: string;
}

function calendarEdges(from: number, to: number, zone: string, weekly: boolean): number[] {
  const midnight = startOfLocalDay(zone, from);
  let edge = weekly ? addLocalDays(zone, midnight, -localWeekday(zone, midnight)) : midnight;
  const edges = [edge];
  while (edge < to && edges.length <= MAX_BUCKETS + 1) {
    edge = addLocalDays(zone, edge, weekly ? 7 : 1);
    edges.push(edge);
  }
  return edges;
}

function fixedEdges(from: number, to: number, zone: string, ms: number): number[] {
  const midnight = startOfLocalDay(zone, from);
  const first = midnight + Math.floor((from - midnight) / ms) * ms;
  const count = Math.ceil((to - first) / ms);
  return count > MAX_BUCKETS ? [] : Array.from({ length: count + 1 }, (_, k) => first + k * ms);
}

/** The smallest published interval for which at most 60 buckets touch the range, with the clipped buckets. */
function histogramBuckets(from: number, to: number, zone: string): { interval: string; buckets: Bucket[] } {
  if (to <= from) return { interval: "1s", buckets: [] };
  let found: { interval: string; edges: number[] } | null = null;
  for (const { name, ms } of FIXED) {
    const edges = fixedEdges(from, to, zone, ms);
    if (edges.length > 0) {
      found = { interval: name, edges };
      break;
    }
  }
  if (!found) {
    const days = calendarEdges(from, to, zone, false);
    found = days.length - 1 <= MAX_BUCKETS ? { interval: "1d", edges: days } : { interval: "1w", edges: calendarEdges(from, to, zone, true) };
  }
  const buckets: Bucket[] = [];
  for (let k = 0; k + 1 < found.edges.length; k++) {
    const start = Math.max(found.edges[k] as number, from);
    const end = Math.min(found.edges[k + 1] as number, to);
    if (start < end) buckets.push({ start, end });
  }
  return { interval: found.interval, buckets };
}

const pad = (value: number): string => String(value).padStart(2, "0");

function labelOf(start: number, zone: string, dated: boolean, seconds: boolean): string {
  const wall = wallTimeAt(zone, start);
  const date = dated ? `${String(wall.year).padStart(4, "0")}-${pad(wall.month)}-${pad(wall.day)} ` : "";
  const clock = `${pad(wall.hour)}:${pad(wall.minute)}${seconds ? `:${pad(wall.second)}` : ""}`;
  return `${date}${clock} ${formatOffset(offsetMinutesAt(zone, start))}`;
}

export function labelledBuckets(timestamps: number[], from: number, to: number, zone: string): { interval: string; buckets: LabelledBucket[] } {
  const { interval, buckets } = histogramBuckets(from, to, zone);
  const dated = !sameLocalDay(zone, from, to - 1);
  const seconds = interval.endsWith("s");
  const counts = new Array<number>(buckets.length).fill(0);
  for (const ts of timestamps) {
    let low = 0;
    let high = buckets.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const bucket = buckets[mid] as Bucket;
      if (ts < bucket.start) high = mid - 1;
      else if (ts >= bucket.end) low = mid + 1;
      else {
        counts[mid] = (counts[mid] as number) + 1;
        break;
      }
    }
  }
  return {
    interval,
    buckets: buckets.map((bucket, k) => ({
      start: formatIso(bucket.start),
      end: formatIso(bucket.end),
      count: counts[k] as number,
      label: labelOf(bucket.start, zone, dated, seconds),
    })),
  };
}
