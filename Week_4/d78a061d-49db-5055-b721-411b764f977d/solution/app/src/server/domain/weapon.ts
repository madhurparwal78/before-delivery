import { errors } from '../errors.js';
import {
  MAX_POINTS,
  MAX_STROKES,
  MAX_VERTICES,
  MIN_POINTS,
  THICKNESS_MAX,
  THICKNESS_MIN,
  VERTICES_PER_POINT,
} from '../../shared/constants.js';
import { roundHalfAway } from '../../shared/pose.js';
import type { PreviewResult, Stats, Stroke } from '../../shared/types.js';

/** Parses strokes and checks shape and thickness, which come before counts. */
export function parseStrokes(value: unknown): Stroke[] {
  if (!Array.isArray(value)) {
    throw errors.invalidField('strokes', { key: 'fb.strokeShape' });
  }
  const strokes: Stroke[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw errors.invalidField('strokes', { key: 'fb.strokeShape' });
    }
    const candidate = raw as { thickness?: unknown; points?: unknown };
    const points = candidate.points;
    if (!Array.isArray(points) || points.length < MIN_POINTS || points.length > MAX_POINTS) {
      throw errors.invalidField('strokes', { key: 'fb.strokeShape' });
    }
    const parsedPoints: [number, number][] = [];
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2) {
        throw errors.invalidField('strokes', { key: 'fb.strokeShape' });
      }
      const [x, y] = point as unknown[];
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw errors.invalidField('strokes', { key: 'fb.strokeShape' });
      }
      if (x < -1 || x > 1 || y < -1 || y > 1) {
        throw errors.invalidField('strokes', { key: 'fb.strokeShape' });
      }
      parsedPoints.push([x, y]);
    }
    const thickness = candidate.thickness;
    if (typeof thickness !== 'number' || !Number.isFinite(thickness)) {
      throw errors.invalidField('thickness', { key: 'fb.strokeThickness' });
    }
    if (thickness < THICKNESS_MIN || thickness > THICKNESS_MAX) {
      throw errors.invalidField('thickness', { key: 'fb.strokeThickness' });
    }
    strokes.push({ thickness, points: parsedPoints });
  }
  return strokes;
}

function countPoints(strokes: readonly Stroke[]): number {
  return strokes.reduce((total, stroke) => total + stroke.points.length, 0);
}

export function countVertices(strokes: readonly Stroke[]): number {
  return VERTICES_PER_POINT * countPoints(strokes);
}

/** The single place the weapon stat formulas live. */
export function deriveStats(strokes: readonly Stroke[]): Stats {
  if (strokes.length === 0) {
    return { reach_m: 0, weight_kg: 0, swing_per_s: 0 };
  }
  const grip = strokes[0].points[0];
  let reach = 0;
  let weight = 0;
  for (const stroke of strokes) {
    const radius = stroke.thickness / 2;
    for (let index = 0; index < stroke.points.length; index += 1) {
      const point = stroke.points[index];
      const distance = Math.hypot(point[0] - grip[0], point[1] - grip[1]);
      if (distance > reach) reach = distance;
      if (index > 0) {
        const previous = stroke.points[index - 1];
        const length = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        weight += Math.PI * radius * radius * length * 2000;
      }
    }
  }
  const swing = 3 / (1 + (weight * reach) / 2);
  return {
    reach_m: roundHalfAway(reach, 2),
    weight_kg: roundHalfAway(weight, 2),
    swing_per_s: roundHalfAway(swing, 2),
  };
}

export function previewDrawing(strokes: readonly Stroke[], drawingRevision: number | null): PreviewResult {
  const vertices = countVertices(strokes);
  const over: ('strokes' | 'vertices')[] = [];
  if (strokes.length > MAX_STROKES) over.push('strokes');
  if (vertices > MAX_VERTICES) over.push('vertices');
  return {
    drawing_revision: drawingRevision,
    stats: deriveStats(strokes),
    strokes: strokes.length,
    vertices,
    within_limits: over.length === 0,
    over,
  };
}

/** Save refuses any drawing outside the forgeable limits. */
export function assertForgeable(strokes: readonly Stroke[]): void {
  const vertices = countVertices(strokes);
  const fields: Record<string, { key: 'fb.strokeCount' | 'fb.vertexLimit'; params?: Record<string, number> }> = {};
  if (strokes.length === 0 || strokes.length > MAX_STROKES) {
    fields.strokes = { key: 'fb.strokeCount' };
  }
  if (vertices > MAX_VERTICES) {
    fields.vertices = { key: 'fb.vertexLimit', params: { limit: MAX_VERTICES } };
  }
  if (Object.keys(fields).length > 0) throw errors.invalidFields(fields);
}
