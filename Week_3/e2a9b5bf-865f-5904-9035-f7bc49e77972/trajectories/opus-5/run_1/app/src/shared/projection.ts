import { roundHalfUp } from './round.js';
import { train } from './optics.js';
import type { SkyPoint, TrainId } from './types.js';

/**
 * Offsets on screen measured in arcminutes from the circle centre, x to the
 * right and y downward. The circle's radius stands for half the stored, rounded
 * true field.
 */
export interface ViewOffset {
  x: number;
  y: number;
}

/**
 * The projection: start from the naked-eye view (north up, east left), rotate by
 * the train's rotation, then mirror left-to-right for a mirrored train.
 */
export function skyToView(point: SkyPoint, trainId: TrainId): ViewOffset {
  const t = train(trainId);
  const rad = (t.rotation_deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const nakedX = -point[0];
  const nakedY = -point[1];
  const x = nakedX * cos - nakedY * sin;
  const y = nakedX * sin + nakedY * cos;
  return { x: t.mirrored ? -x : x, y };
}

export function viewToSky(offset: ViewOffset, trainId: TrainId): SkyPoint {
  const t = train(trainId);
  const rad = (t.rotation_deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = t.mirrored ? -offset.x : offset.x;
  const y = offset.y;
  const nakedX = x * cos + y * sin;
  const nakedY = -x * sin + y * cos;
  return [-nakedX, -nakedY];
}

/** Stored sky coordinates carry at most two decimals. */
export function roundSkyPoint(point: SkyPoint): SkyPoint {
  return [roundHalfUp(point[0], 2), roundHalfUp(point[1], 2)];
}

export function fieldRadiusArcmin(trueFieldArcmin: number): number {
  return trueFieldArcmin / 2;
}

/** Arcminutes per pixel of the circle's radius. */
export function arcminPerPixel(trueFieldArcmin: number, radiusPx: number): number {
  return fieldRadiusArcmin(trueFieldArcmin) / radiusPx;
}

export interface PixelPoint {
  x: number;
  y: number;
}

/** Sky coordinates to pixels relative to the circle's centre. */
export function skyToPixel(
  point: SkyPoint,
  trainId: TrainId,
  trueFieldArcmin: number,
  radiusPx: number,
): PixelPoint {
  const view = skyToView(point, trainId);
  const perArcmin = radiusPx / fieldRadiusArcmin(trueFieldArcmin);
  return { x: view.x * perArcmin, y: view.y * perArcmin };
}

/** Pixels relative to the circle's centre back to sky coordinates. */
export function pixelToSky(
  pixel: PixelPoint,
  trainId: TrainId,
  trueFieldArcmin: number,
  radiusPx: number,
): SkyPoint {
  const perPixel = arcminPerPixel(trueFieldArcmin, radiusPx);
  return roundSkyPoint(viewToSky({ x: pixel.x * perPixel, y: pixel.y * perPixel }, trainId));
}

/**
 * A sky point held inside the circle. Rotation and mirroring preserve length, so
 * a point outside a narrower field moves along its own radius to the edge.
 */
export function clampToField(point: SkyPoint, trueFieldArcmin: number): SkyPoint {
  const limit = fieldRadiusArcmin(trueFieldArcmin);
  const length = Math.hypot(point[0], point[1]);
  if (length <= limit || length === 0) return point;
  const ratio = limit / length;
  return roundSkyPoint([point[0] * ratio, point[1] * ratio]);
}

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

const ARROW_VIEW_STEP: Record<ArrowDirection, ViewOffset> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Move a sky-position cursor by whole arcminutes in the arrow's direction on
 * screen, stopping at the circle's edge.
 */
export function moveCursor(
  cursor: SkyPoint,
  direction: ArrowDirection,
  trainId: TrainId,
  trueFieldArcmin: number,
  arcminutes: number,
): SkyPoint {
  const step = ARROW_VIEW_STEP[direction];
  const view = skyToView(cursor, trainId);
  const moved: ViewOffset = {
    x: view.x + step.x * arcminutes,
    y: view.y + step.y * arcminutes,
  };
  const limit = fieldRadiusArcmin(trueFieldArcmin);
  const length = Math.hypot(moved.x, moved.y);
  if (length > limit && length > 0) {
    const ratio = limit / length;
    moved.x *= ratio;
    moved.y *= ratio;
  }
  return roundSkyPoint(viewToSky(moved, trainId));
}
