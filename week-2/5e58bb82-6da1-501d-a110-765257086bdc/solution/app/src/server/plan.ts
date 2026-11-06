// The line-plan rule: swath width, line spacing, mainscheme lines, crosslines and duration (decided once).
import { chordRange, directions, distance, dot, insideConvex, isConvex, pointAt, signedArea, vec, type Position } from "./geometry.js";
import { isNumber, isRecord, isString } from "./http.js";
import { roundHalf } from "./numbers.js";

type SurveyOrder = "special" | "1a";

export interface PlanSettings {
  planned_depth_m: number;
  swath_ratio: number;
  overlap_pct: number;
  line_azimuth_deg: number;
  planned_speed_mps: number;
  survey_order: SurveyOrder;
}

interface PlannedLine {
  label: string;
  kind: "planned" | "crossline";
  start: Position;
  end: Position;
  length_m: number;
  /** Across-line offset from the area's lowest projection; mainscheme lines only. */
  offset_m: number | null;
}

interface LinePlan {
  swath_width_m: number;
  line_spacing_m: number;
  line_count: number;
  crossline_count: number;
  estimated_duration_s: number;
  lines: PlannedLine[];
}

const label = (prefix: string, i: number) => `${prefix}${String(i + 1).padStart(2, "0")}`;

export function derivePlan(area: Position[], s: PlanSettings): LinePlan {
  const points = area.map(vec);
  const { along, across } = directions(s.line_azimuth_deg);
  const w = s.planned_depth_m * s.swath_ratio;
  const spacing = w * (1 - s.overlap_pct / 100);
  const acrossValues = points.map((p) => dot(p, across));
  const p0 = Math.min(...acrossValues);
  const spread = Math.max(...acrossValues) - p0;
  let offsets: number[];
  if (spread <= w) offsets = [spread / 2];
  else {
    const n = 1 + Math.ceil((spread - w) / spacing);
    offsets = Array.from({ length: n - 1 }, (_, i) => w / 2 + i * spacing).concat([spread - w / 2]);
  }
  const lines: PlannedLine[] = [];
  offsets.forEach((offset, i) => {
    const [t0, t1] = chordRange(points, across, along, p0 + offset) ?? [0, 0];
    const start = pointAt(across, along, p0 + offset, t0);
    const end = pointAt(across, along, p0 + offset, t1);
    lines.push({ label: label("L", i), kind: "planned", start, end, length_m: distance(start, end), offset_m: offset });
  });
  const mainLength = lines.reduce((sum, l) => sum + l.length_m, 0);
  const alongValues = points.map((p) => dot(p, along));
  const q0 = Math.min(...alongValues);
  const extent = Math.max(...alongValues) - q0;
  let crosslines: PlannedLine[] = [];
  for (let k = 1; ; k++) {
    crosslines = Array.from({ length: k }, (_, j) => {
      const value = q0 + (extent * (j + 1)) / (k + 1);
      const [t0, t1] = chordRange(points, along, across, value) ?? [0, 0];
      const start = pointAt(along, across, value, t0);
      const end = pointAt(along, across, value, t1);
      return { label: label("X", j), kind: "crossline" as const, start, end, length_m: distance(start, end), offset_m: null };
    });
    const crossLength = crosslines.reduce((sum, l) => sum + l.length_m, 0);
    if (crossLength >= 0.05 * mainLength) break;
  }
  const total = mainLength + crosslines.reduce((sum, l) => sum + l.length_m, 0);
  const seconds = total / s.planned_speed_mps + 60 * (lines.length + crosslines.length - 1);
  return {
    swath_width_m: w,
    line_spacing_m: spacing,
    line_count: lines.length,
    crossline_count: crosslines.length,
    estimated_duration_s: roundHalf(seconds, 0),
    lines: [...lines, ...crosslines],
  };
}

const MESSAGES = {
  planned_depth_m: "Planned depth must be between 1 and 200 m",
  swath_ratio: "Swath ratio must be between 1 and 8",
  overlap_pct: "Overlap must be between 0 and 50 %",
  line_azimuth_deg: "Line azimuth must be at least 0° and below 180°",
  planned_speed_mps: "Planned speed must be between 0.5 and 4 m/s",
  survey_order: "Choose Special Order or Order 1a",
};

function polygon(value: unknown): Position[] | null {
  if (!Array.isArray(value)) return null;
  const out: Position[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isNumber(item.easting) || !isNumber(item.northing)) return null;
    out.push({ easting: item.easting, northing: item.northing });
  }
  return out;
}

/** Survey-area rule, shared by preview and creation. Writes its message into `errors`. */
export function checkSurveyArea(value: unknown, errors: Record<string, string>): Position[] | null {
  const area = polygon(value);
  if (!area || area.length < 3 || area.length > 40) {
    errors.survey_area = "Enter 3 to 40 survey-area vertices as easting, northing";
    return null;
  }
  const points = area.map(vec);
  if (!isConvex(points)) {
    errors.survey_area = "The survey area must be a convex shape";
    return null;
  }
  if (Math.abs(signedArea(points)) > 4_000_000) {
    errors.survey_area = "The survey area must be at most 4,000,000 m²";
    return null;
  }
  return area;
}

/** Geofence rule, shared by creation and the mid-survey geofence change. */
export function checkGeofence(value: unknown, area: Position[] | null, errors: Record<string, string>): Position[] | null {
  const fence = polygon(value);
  if (!fence || fence.length < 3 || fence.length > 40) {
    errors.geofence = "Enter 3 to 40 geofence corners as easting, northing";
    return null;
  }
  const points = fence.map(vec);
  if (!isConvex(points)) {
    errors.geofence = "The geofence must be a convex shape";
    return null;
  }
  if (area && !area.every((p) => insideConvex(points, vec(p), 1e-6))) {
    errors.geofence = "The geofence must enclose the survey area";
    return null;
  }
  return fence;
}

function ranged(value: unknown, fallback: number | null, ok: (n: number) => boolean): number | null {
  if (value === undefined || value === null) return fallback;
  return isNumber(value) && ok(value) ? value : null;
}

/** Plan settings with the brief's defaults; messages per field. */
export function checkSettings(raw: Record<string, unknown>, errors: Record<string, string>): PlanSettings | null {
  const depth = ranged(raw.planned_depth_m, null, (n) => n >= 1 && n <= 200);
  const ratio = ranged(raw.swath_ratio, 4, (n) => n >= 1 && n <= 8);
  const overlap = ranged(raw.overlap_pct, 20, (n) => n >= 0 && n <= 50);
  const azimuth = ranged(raw.line_azimuth_deg, 0, (n) => n >= 0 && n < 180);
  const speed = ranged(raw.planned_speed_mps, 2.0, (n) => n >= 0.5 && n <= 4);
  const order = raw.survey_order === undefined || raw.survey_order === null ? "1a"
    : isString(raw.survey_order) && (raw.survey_order === "special" || raw.survey_order === "1a") ? raw.survey_order : null;
  if (depth === null) errors.planned_depth_m = MESSAGES.planned_depth_m;
  if (ratio === null) errors.swath_ratio = MESSAGES.swath_ratio;
  if (overlap === null) errors.overlap_pct = MESSAGES.overlap_pct;
  if (azimuth === null) errors.line_azimuth_deg = MESSAGES.line_azimuth_deg;
  if (speed === null) errors.planned_speed_mps = MESSAGES.planned_speed_mps;
  if (order === null) errors.survey_order = MESSAGES.survey_order;
  if (depth === null || ratio === null || overlap === null || azimuth === null || speed === null || order === null) return null;
  return { planned_depth_m: depth, swath_ratio: ratio, overlap_pct: overlap, line_azimuth_deg: azimuth,
    planned_speed_mps: speed, survey_order: order };
}

