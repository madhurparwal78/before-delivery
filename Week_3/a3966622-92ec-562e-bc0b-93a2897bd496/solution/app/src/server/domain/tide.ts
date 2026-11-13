// Tide height by cosine interpolation between published high and low waters, over real elapsed time.
import { addDays, instantOfLocal, minuteOfDay, MINUTE_MS } from "../../shared/portTime.js";
import type { Store, TideEvent } from "../store.js";
import { STANDARD_DAY } from "./route.js";

/** The published events of a port-local date: its revision, or the seeded standard day. */
export function tideEventsOf(store: Store, date: string): readonly TideEvent[] {
  return store.tideRevisions.get(date)?.events ?? STANDARD_DAY;
}

interface TidePoint {
  instant: number;
  height_mm: number;
}

/**
 * A height function valid for instants within a day of `date`. Interpolation crosses midnight into
 * the neighbouring dates' events, which is why two dates either side are read.
 */
export function tideCurve(store: Store, date: string): (instant: number) => number {
  const points: TidePoint[] = [];
  for (let shift = -2; shift <= 2; shift += 1) {
    const day = addDays(date, shift);
    for (const event of tideEventsOf(store, day)) {
      const instant = instantOfLocal(day, minuteOfDay(event.at) ?? 0);
      if (instant !== null) points.push({ instant, height_mm: event.height_mm });
    }
  }
  points.sort((a, b) => a.instant - b.instant);
  return (instant) => {
    const after = points.findIndex((p) => p.instant > instant);
    const next = points[after];
    const previous = points[after - 1];
    if (!next || !previous) throw new RangeError("instant outside the tide curve's span");
    const phase = (instant - previous.instant) / (next.instant - previous.instant);
    return previous.height_mm + ((next.height_mm - previous.height_mm) * (1 - Math.cos(Math.PI * phase))) / 2;
  };
}

/** A waypoint's predicted tide: the height at its arrival minus its time offset, plus its height offset. */
export function waypointTideMm(
  heightAt: (instant: number) => number,
  arrival: number,
  timeOffsetMinutes: number,
  heightOffsetMm: number,
): number {
  return Math.floor(heightAt(arrival - timeOffsetMinutes * MINUTE_MS) + heightOffsetMm + 0.5);
}
