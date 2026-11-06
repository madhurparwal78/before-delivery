import type { Position, SurveyOrder } from '../../shared/types.js';
import { containsPoint, isConvex, polygonArea } from '../domain/geometry.js';
import { PLAN_DEFAULTS, type PlanSettings } from '../domain/plan.js';
import { validation } from '../errors.js';

const MAX_AREA_M2 = 4_000_000;

function readPositions(value: unknown): Position[] | null {
  if (!Array.isArray(value)) return null;
  const points: Position[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const point = item as Record<string, unknown>;
    if (
      typeof point.easting !== 'number' ||
      !Number.isFinite(point.easting) ||
      typeof point.northing !== 'number' ||
      !Number.isFinite(point.northing)
    ) {
      return null;
    }
    points.push({ easting: point.easting, northing: point.northing });
  }
  return points;
}

function numberOr(value: unknown, fallback: number): number | 'bad' {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'bad';
  return value;
}

function inRange(value: number | 'bad', low: number, high: number): boolean {
  return value !== 'bad' && value >= low && value <= high;
}

const REAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!REAL_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export interface PlanFields extends PlanSettings {
  name: string;
  survey_date: string;
  client_org_id: string;
  geofence: Position[];
}

/** Validates the planner body. Mission creation also needs the name, date and geofence. */
export function validatePlan(
  body: Record<string, unknown>,
  full: boolean,
): { settings: PlanSettings; fields: PlanFields } {
  const errors: Record<string, string> = {};

  const area = readPositions(body.survey_area);
  if (area === null || area.length < 3 || area.length > 40) {
    errors.survey_area = 'Enter 3 to 40 survey-area vertices as easting, northing';
  } else if (!isConvex(area)) {
    errors.survey_area = 'The survey area must be a convex shape';
  } else if (polygonArea(area) > MAX_AREA_M2) {
    errors.survey_area = 'The survey area must be at most 4,000,000 m²';
  }

  const depth = numberOr(body.planned_depth_m, Number.NaN);
  if (!inRange(depth, 1, 200)) errors.planned_depth_m = 'Planned depth must be between 1 and 200 m';

  const ratio = numberOr(body.swath_ratio, PLAN_DEFAULTS.swath_ratio);
  if (!inRange(ratio, 1, 8)) errors.swath_ratio = 'Swath ratio must be between 1 and 8';

  const overlap = numberOr(body.overlap_pct, PLAN_DEFAULTS.overlap_pct);
  if (!inRange(overlap, 0, 50)) errors.overlap_pct = 'Overlap must be between 0 and 50 %';

  const azimuth = numberOr(body.line_azimuth_deg, PLAN_DEFAULTS.line_azimuth_deg);
  if (azimuth === 'bad' || azimuth < 0 || azimuth >= 180) {
    errors.line_azimuth_deg = 'Line azimuth must be at least 0° and below 180°';
  }

  const speed = numberOr(body.planned_speed_mps, PLAN_DEFAULTS.planned_speed_mps);
  if (!inRange(speed, 0.5, 4)) errors.planned_speed_mps = 'Planned speed must be between 0.5 and 4 m/s';

  let order: SurveyOrder = PLAN_DEFAULTS.survey_order;
  if (body.survey_order !== undefined && body.survey_order !== null) {
    if (body.survey_order === 'special' || body.survey_order === '1a') order = body.survey_order;
    else errors.survey_order = 'Choose Special Order or Order 1a';
  }

  let name = '';
  let surveyDate = '';
  let geofence: Position[] = [];
  if (full) {
    name = typeof body.name === 'string' ? body.name : '';
    if (name.length < 1 || name.length > 80) {
      errors.name = 'Enter a mission name of up to 80 characters';
    }
    surveyDate = typeof body.survey_date === 'string' ? body.survey_date : '';
    if (!isRealDate(surveyDate)) errors.survey_date = 'Enter the survey date as YYYY-MM-DD';

    const corners = readPositions(body.geofence);
    if (corners === null || corners.length < 3 || corners.length > 40) {
      errors.geofence = 'Enter 3 to 40 geofence corners as easting, northing';
    } else if (!isConvex(corners)) {
      errors.geofence = 'The geofence must be a convex shape';
    } else if (area !== null && !area.every((vertex) => containsPoint(corners, vertex))) {
      errors.geofence = 'The geofence must enclose the survey area';
    } else {
      geofence = corners;
    }
  }

  if (Object.keys(errors).length > 0) throw validation(errors);

  const settings: PlanSettings = {
    survey_area: area!,
    planned_depth_m: depth as number,
    swath_ratio: ratio as number,
    overlap_pct: overlap as number,
    line_azimuth_deg: azimuth as number,
    planned_speed_mps: speed as number,
    survey_order: order,
  };
  return {
    settings,
    fields: {
      ...settings,
      name,
      survey_date: surveyDate,
      client_org_id: typeof body.client_org_id === 'string' ? body.client_org_id : '',
      geofence,
    },
  };
}
