import { roundHalfUp } from './numerals.ts';
import {
  type Wall,
  existingSteps,
  formatInstantSeconds,
  offsetLabel,
  wallOnDate,
  wallToInstant,
} from './porttime.ts';
import { ROUTE, type Waypoint } from './route.ts';
import { type TideTable, tideAtWaypoint } from './tide.ts';

export type PlanWaypoint = {
  id: string;
  name: string;
  distance_nm: number;
  sounded_depth_mm: number;
  confined: boolean;
  speed_limit_kn: number | null;
  leg_speed_kn: number;
  arrival_at: string;
  arrival_utc_offset: string;
  tide_mm: number;
  squat_mm: number;
  clearance_mm: number;
  margin_mm: number;
  pinch: boolean;
};

export type PlanCore = {
  boarding_at: string;
  draught_mm: number;
  required_mm: number;
  waypoints: PlanWaypoint[];
  pinch: { waypoint_id: string; margin_mm: number };
  window_state: 'open' | 'closed';
};

export type PlanSubject = {
  draught_mm: number;
  speed_kn: number;
  block_coefficient: number;
};

/** The leg ending at a waypoint runs at the lesser of the ordered speed and that waypoint's limit. */
export function legSpeedKn(waypoint: Waypoint, orderedSpeedKn: number): number {
  const limit = waypoint.speed_limit_kn;
  return limit === null ? orderedSpeedKn : Math.min(orderedSpeedKn, limit);
}

/** Arrival is boarding plus the exact sum of leg distance over leg speed, rounded once per waypoint. */
export function arrivalInstants(boarding: number, orderedSpeedKn: number): number[] {
  let cumulativeHours = 0;
  let previousDistance = 0;
  const arrivals: number[] = [];
  for (const waypoint of ROUTE) {
    const legDistance = waypoint.distance_nm - previousDistance;
    previousDistance = waypoint.distance_nm;
    cumulativeHours += legDistance / legSpeedKn(waypoint, orderedSpeedKn);
    arrivals.push(boarding + roundHalfUp(cumulativeHours * 3600) * 1000);
  }
  return arrivals;
}

/** Block coefficient times leg speed squared, divided by 100, or by 50 where confined. */
export function squatMm(waypoint: Waypoint, blockCoefficient: number, legSpeed: number): number {
  const divisor = waypoint.confined ? 50 : 100;
  return roundHalfUp(((blockCoefficient * legSpeed * legSpeed) / divisor) * 1000);
}

/** The greater of 1,000 mm and 10% of draught. */
export function requiredClearanceMm(draughtMm: number): number {
  return Math.max(1000, roundHalfUp(draughtMm / 10));
}

export function computePlan(
  table: TideTable,
  subject: PlanSubject,
  boarding: number,
): PlanCore {
  const arrivals = arrivalInstants(boarding, subject.speed_kn);
  const required = requiredClearanceMm(subject.draught_mm);
  const waypoints: PlanWaypoint[] = ROUTE.map((waypoint, index) => {
    const arrival = arrivals[index] as number;
    const legSpeed = legSpeedKn(waypoint, subject.speed_kn);
    const tide = tideAtWaypoint(table, waypoint, arrival);
    const squat = squatMm(waypoint, subject.block_coefficient, legSpeed);
    const clearance = waypoint.sounded_depth_mm + tide - subject.draught_mm - squat;
    return {
      id: waypoint.id,
      name: waypoint.name,
      distance_nm: waypoint.distance_nm,
      sounded_depth_mm: waypoint.sounded_depth_mm,
      confined: waypoint.confined,
      speed_limit_kn: waypoint.speed_limit_kn,
      leg_speed_kn: legSpeed,
      arrival_at: formatInstantSeconds(arrival),
      arrival_utc_offset: offsetLabel(arrival),
      tide_mm: tide,
      squat_mm: squat,
      clearance_mm: clearance,
      margin_mm: clearance - required,
      pinch: false,
    };
  });

  let pinchIndex = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    if ((waypoints[index] as PlanWaypoint).margin_mm < (waypoints[pinchIndex] as PlanWaypoint).margin_mm) {
      pinchIndex = index;
    }
  }
  const pinchWaypoint = waypoints[pinchIndex] as PlanWaypoint;
  pinchWaypoint.pinch = true;

  return {
    boarding_at: formatInstantSeconds(boarding).slice(0, 16),
    draught_mm: subject.draught_mm,
    required_mm: required,
    waypoints,
    pinch: { waypoint_id: pinchWaypoint.id, margin_mm: pinchWaypoint.margin_mm },
    window_state: waypoints.every((waypoint) => waypoint.margin_mm >= 0) ? 'open' : 'closed',
  };
}

export type OpenWindow = { from: string; to: string };

/** A window is a run of open steps consecutive among the date's existing steps. */
export function openWindows(table: TideTable, subject: PlanSubject, date: Wall): OpenWindow[] {
  const windows: OpenWindow[] = [];
  let runStart: number | null = null;
  let runEnd = 0;
  for (const minutes of existingSteps(date)) {
    const wall = wallOnDate(date, minutes);
    const instant = wallToInstant(wall);
    const open =
      instant !== null && computePlan(table, subject, instant).window_state === 'open';
    if (open) {
      if (runStart === null) runStart = minutes;
      runEnd = minutes;
    } else if (runStart !== null) {
      windows.push({ from: stepLabel(runStart), to: stepLabel(runEnd) });
      runStart = null;
    }
  }
  if (runStart !== null) windows.push({ from: stepLabel(runStart), to: stepLabel(runEnd) });
  return windows;
}

export function stepLabel(minutesAfterMidnight: number): string {
  const hour = Math.floor(minutesAfterMidnight / 60);
  const minute = minutesAfterMidnight % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** A waypoint's water depth at arrival is its sounded depth plus its tide. */
export function waterDepthsMm(plan: PlanCore): number[] {
  return plan.waypoints.map((waypoint) => waypoint.sounded_depth_mm + waypoint.tide_mm);
}
