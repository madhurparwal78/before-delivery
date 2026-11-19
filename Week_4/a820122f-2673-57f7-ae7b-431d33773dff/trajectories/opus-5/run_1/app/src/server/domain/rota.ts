import {
  HALF_HOUR_MS,
  HOUR_MS,
  MINUTE_MS,
  addShipDays,
  formatClockTime,
  formatInstant,
  parseClockTime,
  shipDateRange,
} from './time.js';
import {
  instantOfShipClockTime,
  offsetAt,
  shipDayBounds,
  type VesselClock,
} from './ship-time.js';
import { buildTimeline, judgeWindow, type RestRule } from './rest-rules.js';
import { ruleSetAt, type RuleSetPeriod } from './rule-sets.js';

export type RotaWatchDefinition = {
  label: string;
  startTime: string;
  endTime: string;
  fromDate: string;
  toDate: string;
};

export type PlannedWatch = {
  label: string;
  start_ship_time: string;
  end_ship_time: string;
  start_utc: string;
  end_utc: string;
  elapsed_hours: number;
};

export type PlannedDay = {
  ship_date: string;
  cell_count: number;
  day_hours: number;
  watches: PlannedWatch[];
  planned_rest_hours: number;
};

export type PlannedBreach = {
  rule: RestRule;
  window_hours: 24 | 168;
  window_start_utc: string;
  window_end_utc: string;
};

export type RotaPlan = {
  days: PlannedDay[];
  plan: { verdict: 'pass' | 'breach'; breaches: PlannedBreach[] };
};

type WatchInstance = { label: string; startMs: number; endMs: number; shipDate: string };

function watchInstance(
  clock: VesselClock,
  watch: RotaWatchDefinition,
  shipDate: string,
): WatchInstance {
  const startMinutes = parseClockTime(watch.startTime) as number;
  const endMinutes = parseClockTime(watch.endTime) as number;
  const startMs = instantOfShipClockTime(clock, shipDate, startMinutes, 'first');
  const endDate = endMinutes <= startMinutes ? addShipDays(shipDate, 1) : shipDate;
  const endMs = instantOfShipClockTime(clock, endDate, endMinutes, 'last');
  return { label: watch.label, startMs, endMs, shipDate };
}

function unionHours(intervals: readonly { startMs: number; endMs: number }[]): number {
  const ordered = [...intervals].sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const interval of ordered) {
    const start = Math.max(interval.startMs, cursor);
    if (interval.endMs > start) {
      total += interval.endMs - start;
      cursor = interval.endMs;
    }
  }
  return total / HOUR_MS;
}

/** Builds the planned days and the verdict for a rota over a range of ship's dates. */
export function planRota(
  clock: VesselClock,
  watches: readonly RotaWatchDefinition[],
  fromDate: string,
  toDate: string,
  ruleSets: readonly RuleSetPeriod[],
): RotaPlan {
  const dates = shipDateRange(fromDate, toDate);
  const generationDates = shipDateRange(addShipDays(fromDate, -1), toDate);
  const instances: WatchInstance[] = [];
  for (const watch of watches) {
    for (const shipDate of generationDates) {
      if (shipDate < watch.fromDate || shipDate > watch.toDate) continue;
      instances.push(watchInstance(clock, watch, shipDate));
    }
  }

  const rangeStartMs = shipDayBounds(clock, fromDate).startMs;
  const rangeEndMs = shipDayBounds(clock, toDate).endMs;

  const days: PlannedDay[] = dates.map((shipDate) => {
    const bounds = shipDayBounds(clock, shipDate);
    const inDay = instances
      .map((instance) => ({
        ...instance,
        startMs: Math.max(instance.startMs, bounds.startMs),
        endMs: Math.min(instance.endMs, bounds.endMs),
      }))
      .filter((instance) => instance.endMs > instance.startMs);
    const startingHere = instances
      .filter((instance) => instance.shipDate === shipDate)
      .sort((a, b) => a.startMs - b.startMs);
    return {
      ship_date: shipDate,
      cell_count: bounds.cellCount,
      day_hours: bounds.dayHours,
      watches: startingHere.map((instance) => ({
        label: instance.label,
        start_ship_time: clockReading(clock, instance.startMs),
        end_ship_time: clockReading(clock, instance.endMs),
        start_utc: formatInstant(instance.startMs),
        end_utc: formatInstant(instance.endMs),
        elapsed_hours: (instance.endMs - instance.startMs) / HOUR_MS,
      })),
      planned_rest_hours: bounds.dayHours - unionHours(inDay),
    };
  });

  const timeline = buildTimeline(
    [
      { startMs: rangeStartMs, endMs: rangeEndMs, kind: 'rest' as const, late: false },
      ...instances
        .map((instance) => ({
          startMs: Math.max(instance.startMs, rangeStartMs),
          endMs: Math.min(instance.endMs, rangeEndMs),
          kind: 'work' as const,
          late: false,
        }))
        .filter((instance) => instance.endMs > instance.startMs),
    ],
    rangeStartMs,
    rangeEndMs,
  );

  const breaches: PlannedBreach[] = [];
  for (const hours of [24, 168] as const) {
    const span = hours * HOUR_MS;
    for (let startMs = rangeStartMs; startMs + span <= rangeEndMs; startMs += HALF_HOUR_MS) {
      const endMs = startMs + span;
      const judgement = judgeWindow(timeline, startMs, hours, ruleSetAt([...ruleSets], endMs));
      if (judgement.verdict !== 'breach') continue;
      for (const rule of judgement.rulesFailed) {
        breaches.push({
          rule,
          window_hours: hours,
          window_start_utc: formatInstant(startMs),
          window_end_utc: formatInstant(endMs),
        });
      }
    }
  }

  return { days, plan: { verdict: breaches.length > 0 ? 'breach' : 'pass', breaches } };
}

function clockReading(clock: VesselClock, ms: number): string {
  const localMs = ms + offsetAt(clock, ms) * MINUTE_MS;
  const reading = new Date(localMs);
  return formatClockTime(reading.getUTCHours() * 60 + reading.getUTCMinutes());
}
