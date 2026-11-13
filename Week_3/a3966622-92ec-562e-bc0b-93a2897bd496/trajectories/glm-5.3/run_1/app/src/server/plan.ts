import { offsetStringAt, formatPortStamp, formatPortDate } from './porttime.js';
import { roundHalfUp } from './numerals.js';
import { ROUTE } from './route.js';
import { tideKnots, waypointTideMm } from './tide.js';
import type { TideEvent } from './route.js';

// The published clearance formula. Leg speeds, arrivals, squat, clearance,
// required clearance, margin and pinch are decided here and nowhere else.

export interface PlanInput {
  draught_mm: number;
  speed_kn: number;
  block_coefficient: number;
  boardingMs: number;
  tideEventsFor: (date: string) => readonly TideEvent[];
  tideVersion: number;
}

export interface PlanWaypoint {
  id: string;
  name: string;
  distance_nm: number;
  sounded_depth_mm: number;
  confined: boolean;
  speed_limit_kn: number | null;
  leg_speed_kn: number;
  arrival_at: string; // "HH:MM:SS" port time
  arrival_utc_offset: string;
  tide_mm: number;
  squat_mm: number;
  clearance_mm: number;
  required_mm: number;
  margin_mm: number;
  pinch: boolean;
}

export interface PlanWaypoints {
  waypoints: PlanWaypoint[];
  pinchWaypointId: string;
  pinchMarginMm: number;
  gateOpen: boolean;
  tideVersion: number;
  boardingMs: number;
  draughtMm: number;
  requiredMm: number;
}

export function computePlan(input: PlanInput): PlanWaypoints {
  const boardingDate = formatPortDate(input.boardingMs);
  const knots = tideKnots(boardingDate, input.tideEventsFor);

  // Cumulative real elapsed time, never a difference of wall-clock readings.
  let cumulativeSec = 0;
  let previousDistanceNm = 0;
  const waypoints: PlanWaypoint[] = [];
  const margins: number[] = [];
  let pinchIndex = 0;

  for (let i = 0; i < ROUTE.length; i++) {
    const wp = ROUTE[i]!;
    const legDistanceNm = wp.distance_nm - previousDistanceNm;
    const legSpeedKn = Math.min(input.speed_kn, wp.speed_limit_kn ?? input.speed_kn);
    // Exact seconds accumulate between legs; the cumulative value is rounded
    // half up to the nearest second once per waypoint.
    cumulativeSec += (legDistanceNm / legSpeedKn) * 3600;
    const arrivalMs = input.boardingMs + roundHalfUp(cumulativeSec) * 1000;

    const tideMm = roundHalfUp(waypointTideMm(knots, arrivalMs, wp.time_offset_minutes, wp.height_offset_mm));
    const squatM = (input.block_coefficient * legSpeedKn * legSpeedKn) / (wp.confined ? 50 : 100);
    const squatMm = roundHalfUp(squatM * 1000);
    const clearanceMm = wp.sounded_depth_mm + tideMm - input.draught_mm - squatMm;
    // Required clearance: the greater of 1,000 mm and 10% of draught, rounded
    // half up to a whole millimetre.
    const requiredMm = Math.max(1000, roundHalfUp((input.draught_mm * 10) / 100));
    const marginMm = clearanceMm - requiredMm;

    waypoints.push({
      id: wp.id,
      name: wp.name,
      distance_nm: wp.distance_nm,
      sounded_depth_mm: wp.sounded_depth_mm,
      confined: wp.confined,
      speed_limit_kn: wp.speed_limit_kn,
      leg_speed_kn: legSpeedKn,
      arrival_at: formatPortStamp(arrivalMs),
      arrival_utc_offset: offsetStringAt(arrivalMs),
      tide_mm: tideMm,
      squat_mm: squatMm,
      clearance_mm: clearanceMm,
      required_mm: requiredMm,
      margin_mm: marginMm,
      pinch: false,
    });
    margins.push(marginMm);
    if (marginMm < margins[pinchIndex]!) pinchIndex = i;
    previousDistanceNm = wp.distance_nm;
  }

  waypoints[pinchIndex]!.pinch = true;
  const pinchMarginMm = margins[pinchIndex]!;
  return {
    waypoints,
    pinchWaypointId: waypoints[pinchIndex]!.id,
    pinchMarginMm,
    gateOpen: margins.every((m) => m >= 0),
    tideVersion: input.tideVersion,
    boardingMs: input.boardingMs,
    draughtMm: input.draught_mm,
    requiredMm: waypoints[0]!.required_mm,
  };
}

// A waypoint's water depth at arrival is its sounded depth plus its tide.
export function waterDepthMm(wp: PlanWaypoint): number {
  return wp.sounded_depth_mm + wp.tide_mm;
}

export function arrivalHm(wp: PlanWaypoint): string {
  return `${wp.arrival_at.slice(0, 5)}`;
}
