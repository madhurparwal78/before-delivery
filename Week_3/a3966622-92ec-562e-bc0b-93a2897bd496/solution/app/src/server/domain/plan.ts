// The published clearance formula: leg speed, arrival, squat, clearance, required clearance, margin,
// pinch and gate for one boarding instant, and the open boarding windows of a port-local date.
import { clockText, portDate, portMinute, portStamp, stepsOfDate, utcOffsetText } from "../../shared/portTime.js";
import type { Plan, PlanWaypoint, Waypoint } from "../../shared/types.js";
import type { CommittedWindow, MoveRecord, Store } from "../store.js";
import { WAYPOINTS } from "./route.js";
import { tideCurve, waypointTideMm } from "./tide.js";
import { estimateFor } from "./tariff.js";

/** What a plan reads from a move or an order form. */
interface PlanSubject {
  draught_mm: number;
  speed_kn: number;
  block_coefficient: number;
  gross_tonnage: number;
}

export const subjectOf = (move: MoveRecord): PlanSubject => ({
  draught_mm: move.draught_mm,
  speed_kn: move.speed_kn,
  block_coefficient: move.vessel.block_coefficient,
  gross_tonnage: move.vessel.gross_tonnage,
});

const MIN_REQUIRED_MM = 1000;

/** Whole-number half-up division for non-negative integers. */
const roundHalfUp = (numerator: bigint, denominator: bigint): bigint => (2n * numerator + denominator) / (2n * denominator);

const legSpeedKn = (orderedKn: number, limitKn: number | null): number =>
  limitKn === null ? orderedKn : Math.min(orderedKn, limitKn);

const hundredths = (value: number): bigint => BigInt(Math.round(value * 100));

/** Squat in whole mm: Cb × V² / 100 metres, or / 50 at a confined waypoint, rounded half up once. */
function squatMm(blockCoefficient: number, legKn: number, confined: boolean): number {
  const cbThousandths = BigInt(Math.round(blockCoefficient * 1000));
  const v = hundredths(legKn);
  return Number(roundHalfUp(cbThousandths * v * v, 10_000n * (confined ? 50n : 100n)));
}

/** Required clearance: the greater of 1,000 mm and 10% of draught rounded half up. */
const requiredMm = (draughtMm: number): number =>
  Math.max(MIN_REQUIRED_MM, Number(roundHalfUp(BigInt(draughtMm), 10n)));

/**
 * Arrival at each waypoint: the boarding instant plus the exact sum of leg distance over leg speed,
 * rounded half up to the second once per waypoint.
 */
function arrivals(boardingInstant: number, orderedKn: number): { waypoint: Waypoint; arrival: number }[] {
  let numerator = 0n;
  let denominator = 1n;
  let previousTenths = 0n;
  return WAYPOINTS.map((waypoint) => {
    const tenths = BigInt(Math.round(waypoint.distance_nm * 10));
    const legSeconds = { n: (tenths - previousTenths) * 36_000n, d: hundredths(legSpeedKn(orderedKn, waypoint.speed_limit_kn)) };
    previousTenths = tenths;
    numerator = numerator * legSeconds.d + legSeconds.n * denominator;
    denominator *= legSeconds.d;
    return { waypoint, arrival: boardingInstant + Number(roundHalfUp(numerator, denominator)) * 1000 };
  });
}

interface Clearances {
  required_mm: number;
  waypoints: PlanWaypoint[];
  pinch: { waypoint_id: string; margin_mm: number };
  window_state: "open" | "closed";
}

function clearances(
  subject: PlanSubject,
  boardingInstant: number,
  heightAt: (instant: number) => number,
): Clearances {
  const required = requiredMm(subject.draught_mm);
  const waypoints = arrivals(boardingInstant, subject.speed_kn).map(({ waypoint, arrival }): PlanWaypoint => {
    const leg = legSpeedKn(subject.speed_kn, waypoint.speed_limit_kn);
    const tide = waypointTideMm(heightAt, arrival, waypoint.time_offset_minutes, waypoint.height_offset_mm);
    const squat = squatMm(subject.block_coefficient, leg, waypoint.confined);
    const clearance = waypoint.sounded_depth_mm + tide - subject.draught_mm - squat;
    return {
      id: waypoint.id,
      name: waypoint.name,
      distance_nm: waypoint.distance_nm,
      sounded_depth_mm: waypoint.sounded_depth_mm,
      confined: waypoint.confined,
      speed_limit_kn: waypoint.speed_limit_kn,
      leg_speed_kn: leg,
      arrival_at: portStamp(arrival),
      arrival_utc_offset: utcOffsetText(arrival),
      tide_mm: tide,
      squat_mm: squat,
      clearance_mm: clearance,
      margin_mm: clearance - required,
      pinch: false,
    };
  });
  const pinch = waypoints.reduce((low, w) => (w.margin_mm < low.margin_mm ? w : low));
  pinch.pinch = true;
  return {
    required_mm: required,
    waypoints,
    pinch: { waypoint_id: pinch.id, margin_mm: pinch.margin_mm },
    window_state: waypoints.every((w) => w.margin_mm >= 0) ? "open" : "closed",
  };
}

/** The full plan for a boarding instant, with the estimate priced by the revision in force then. */
export function planFor(store: Store, subject: PlanSubject, boardingInstant: number): Plan {
  return {
    tide_version: store.tideVersion(),
    boarding_at: portMinute(boardingInstant),
    draught_mm: subject.draught_mm,
    ...gateAt(store, subject, boardingInstant),
    estimate: estimateFor(store, subject, boardingInstant),
  };
}

/** Whether the window clears at a committed boarding time: the plan's pinch and gate alone. */
export function gateAt(store: Store, subject: PlanSubject, boardingInstant: number): Clearances {
  return clearances(subject, boardingInstant, tideCurve(store, portDate(boardingInstant)));
}

/** The committed window a clearing plan records: time, pinch waypoint by name, margin, tide version. */
export function committedWindow(gate: Clearances, boardingAt: string, tideVersion: number): CommittedWindow {
  const pinch = gate.waypoints.find((w) => w.pinch);
  return { boarding_at: boardingAt, pinch_waypoint: pinch?.name ?? "", margin_mm: gate.pinch.margin_mm, tide_version: tideVersion };
}

/**
 * Open boarding windows on a port-local date: runs of open steps that are consecutive among the
 * date's existing steps, each written as its first and last open step.
 */
export function openWindows(store: Store, subject: PlanSubject, date: string): { from: string; to: string }[] {
  const heightAt = tideCurve(store, date);
  const windows: { from: string; to: string }[] = [];
  let run: { from: number; to: number } | null = null;
  for (const step of stepsOfDate(date)) {
    if (clearances(subject, step.instant, heightAt).window_state === "open") {
      run = run ? { from: run.from, to: step.minutes } : { from: step.minutes, to: step.minutes };
    } else if (run) {
      windows.push({ from: clockText(run.from), to: clockText(run.to) });
      run = null;
    }
  }
  if (run) windows.push({ from: clockText(run.from), to: clockText(run.to) });
  return windows;
}
