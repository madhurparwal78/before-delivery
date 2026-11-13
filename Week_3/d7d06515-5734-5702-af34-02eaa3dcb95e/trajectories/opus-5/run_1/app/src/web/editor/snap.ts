import type { Drawing, DrawingObject, Point } from '../../shared/api';
import { isLayerVisible, toScreen, type ViewState } from './view';

export type SnapKind = 'Endpoint' | 'Midpoint' | 'Center' | 'Intersection';

export const SNAP_ORDER: SnapKind[] = ['Endpoint', 'Midpoint', 'Center', 'Intersection'];

export interface SnapCandidate {
  kind: SnapKind;
  point: Point;
}

export const MOUSE_APERTURE = 10;
export const TOUCH_APERTURE = 24;
export const PICK_PIXELS = 5;
export const PICK_MILLIMETRES = 10;

function pushSnaps(target: SnapCandidate[], object: DrawingObject): void {
  for (const point of object.snaps.endpoint) target.push({ kind: 'Endpoint', point });
  for (const point of object.snaps.midpoint) target.push({ kind: 'Midpoint', point });
  for (const point of object.snaps.center) target.push({ kind: 'Center', point });
}

/**
 * Every snap candidate the server computed: base objects and loaded xref objects on
 * layers that are neither frozen nor off, plus the intersections between them.
 */
export function snapCandidates(drawing: Drawing): SnapCandidate[] {
  const candidates: SnapCandidate[] = [];
  for (const object of drawing.objects) {
    if (!isLayerVisible(drawing.layers, object.layer)) continue;
    pushSnaps(candidates, object);
  }
  for (const xref of drawing.xrefs) {
    if (xref.status !== 'loaded') continue;
    for (const object of xref.objects) pushSnaps(candidates, object);
  }
  for (const point of drawing.intersections) candidates.push({ kind: 'Intersection', point });
  return candidates;
}

/** The candidates inside the aperture, nearest first, ties in the published kind order. */
export function candidatesInAperture(
  candidates: SnapCandidate[],
  pointerScreen: Point,
  view: ViewState,
  width: number,
  height: number,
  aperture: number,
): SnapCandidate[] {
  const scored = candidates
    .map((candidate) => {
      const screen = toScreen(view, width, height, candidate.point);
      return {
        candidate,
        gap: Math.hypot(screen[0] - pointerScreen[0], screen[1] - pointerScreen[1]),
      };
    })
    .filter((entry) => entry.gap <= aperture);
  scored.sort((a, b) => {
    if (Math.abs(a.gap - b.gap) > 1e-6) return a.gap - b.gap;
    return SNAP_ORDER.indexOf(a.candidate.kind) - SNAP_ORDER.indexOf(b.candidate.kind);
  });
  return scored.map((entry) => entry.candidate);
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

export function distanceToObject(point: Point, object: DrawingObject): number {
  switch (object.type) {
    case 'line':
      return distanceToSegment(point, object.start, object.end);
    case 'polyline': {
      const vertices = object.closed ? [...object.vertices, object.vertices[0]!] : object.vertices;
      let best = Infinity;
      for (let i = 0; i < vertices.length - 1; i += 1) {
        best = Math.min(best, distanceToSegment(point, vertices[i]!, vertices[i + 1]!));
      }
      return best;
    }
    case 'spline': {
      let best = Infinity;
      for (let i = 0; i < object.fit_points.length - 1; i += 1) {
        best = Math.min(best, distanceToSegment(point, object.fit_points[i]!, object.fit_points[i + 1]!));
      }
      return best;
    }
    case 'circle':
      return Math.abs(Math.hypot(point[0] - object.center[0], point[1] - object.center[1]) - object.radius);
    case 'arc':
      return Math.abs(Math.hypot(point[0] - object.center[0], point[1] - object.center[1]) - object.radius);
    case 'mtext':
      return Math.hypot(point[0] - object.position[0], point[1] - object.position[1]);
    case 'dimension':
      return Math.hypot(point[0] - object.location[0], point[1] - object.location[1]);
    case 'insert':
      return Math.hypot(point[0] - object.position[0], point[1] - object.position[1]);
    case 'revcloud': {
      const x0 = Math.min(object.first[0], object.opposite[0]);
      const x1 = Math.max(object.first[0], object.opposite[0]);
      const y0 = Math.min(object.first[1], object.opposite[1]);
      const y1 = Math.max(object.first[1], object.opposite[1]);
      const corners: Point[] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ];
      let best = Infinity;
      for (let i = 0; i < 4; i += 1) best = Math.min(best, distanceToSegment(point, corners[i]!, corners[i + 1]!));
      return best;
    }
  }
}

export function selectableObjects(drawing: Drawing): DrawingObject[] {
  return drawing.objects.filter((object) => isLayerVisible(drawing.layers, object.layer));
}

/** The nearest selectable object within a tolerance; ties go to the most recently created. */
export function pickObject(
  objects: DrawingObject[],
  point: Point,
  tolerance: number,
): DrawingObject | null {
  let best: DrawingObject | null = null;
  let bestGap = Infinity;
  for (const object of objects) {
    const gap = distanceToObject(point, object);
    if (gap > tolerance) continue;
    if (gap <= bestGap + 1e-9) {
      best = object;
      bestGap = Math.min(bestGap, gap);
    }
  }
  return best;
}
