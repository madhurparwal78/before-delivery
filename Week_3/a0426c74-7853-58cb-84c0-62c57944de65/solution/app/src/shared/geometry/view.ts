// The view: world <-> screen, zoom and pan formulas, ZOOMALL, the Find pan rule and the phone pinch.
import type { Point, Rect } from '../types.ts';
import { clamp, midpoint } from './numbers.ts';

/** The drawing root's `data-zoom`, `data-pan-x`, `data-pan-y`. */
export interface View { zoom: number; panX: number; panY: number }
export interface Size { width: number; height: number }

const WHEEL_STEP = 1.2;
const PINCH_ZOOM_RANGE = { min: 0.05, max: 50 } as const;
const ZOOM_ALL_MARGIN_PX = 24;

/** Screen X = world X * zoom + pan X, screen Y = -world Y * zoom + pan Y. */
export function worldToScreen(view: View, p: Point): Point {
  return [p[0] * view.zoom + view.panX, -p[1] * view.zoom + view.panY];
}

export function screenToWorld(view: View, p: Point): Point {
  return [(p[0] - view.panX) / view.zoom, -(p[1] - view.panY) / view.zoom];
}

/** The world rectangle the pane shows. */
export function viewWorldRect(view: View, pane: Size): Rect {
  const [x1, y2] = screenToWorld(view, [0, 0]);
  const [x2, y1] = screenToWorld(view, [pane.width, pane.height]);
  return [x1, y1, x2, y2];
}

/** Zoom by `factor` keeping the world point under the screen point `about` where it is. */
function zoomAbout(view: View, factor: number, about: Point): View {
  return { zoom: view.zoom * factor, panX: about[0] - (about[0] - view.panX) * factor, panY: about[1] - (about[1] - view.panY) * factor };
}

/** Wheel: each step multiplies (delta < 0, zoom in) or divides (delta > 0) zoom by 1.2, about the pointer. */
export function wheelZoom(view: View, pointer: Point, deltaY: number): View {
  return zoomAbout(view, deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, pointer);
}

/** Values recorded when the second finger touches (brief: Phone gestures). */
export interface PinchStart { distance: number; midpoint: Point; view: View }

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Pinch: zoom' = zoom0 * d / d0 held in [0.05, 50]; pan' = p - (p0 - pan0) * zoom' / zoom0; both rounded to 4 decimals. */
export function pinchView(start: PinchStart, distance: number, midpoint: Point): View {
  const { view, midpoint: p0 } = start;
  const zoom = round4(clamp((view.zoom * distance) / start.distance, PINCH_ZOOM_RANGE.min, PINCH_ZOOM_RANGE.max));
  const ratio = zoom / view.zoom;
  return { zoom, panX: round4(midpoint[0] - (p0[0] - view.panX) * ratio), panY: round4(midpoint[1] - (p0[1] - view.panY) * ratio) };
}

/** ZOOMALL: fit `bounds` into the pane with 24 px on each side, centred. Null bounds (nothing visible) keeps `view`. */
export function zoomAllView(bounds: Rect | null, pane: Size, view: View): View {
  if (bounds === null) return view;
  const width = bounds[2] - bounds[0];
  const height = bounds[3] - bounds[1];
  const fits = [(pane.width - 2 * ZOOM_ALL_MARGIN_PX) / width, (pane.height - 2 * ZOOM_ALL_MARGIN_PX) / height].filter((fit) => Number.isFinite(fit));
  const zoom = fits.length === 0 ? view.zoom : Math.min(...fits);
  const centre = midpoint([bounds[0], bounds[1]], [bounds[2], bounds[3]]);
  return { zoom, panX: pane.width / 2 - centre[0] * zoom, panY: pane.height / 2 + centre[1] * zoom };
}

function shiftInto(low: number, high: number, size: number, margin: number): number {
  let shift = 0;
  if (high > size - margin) shift = size - margin - high;
  if (low + shift < margin) shift = margin - low;
  return shift;
}

/** Find pan rule: the smallest pan that puts `bounds` at least `margin` px (48) inside each pane edge; a view that already does is returned unchanged. */
export function panToReveal(bounds: Rect, view: View, pane: Size, margin: number): View {
  const [left, bottom] = worldToScreen(view, [bounds[0], bounds[1]]);
  const [right, top] = worldToScreen(view, [bounds[2], bounds[3]]);
  const dx = shiftInto(left, right, pane.width, margin);
  const dy = shiftInto(top, bottom, pane.height, margin);
  return dx === 0 && dy === 0 ? view : { ...view, panX: view.panX + dx, panY: view.panY + dy };
}
