// The view transform: one place that maps model millimetres to canvas pixels (Y up) and back.
// The scale is fitScale x zoom, and fitScale is always derived from the canvas box now, so a resized canvas stays fitted.
import type { Bounds } from '../../../shared/geometry.ts';
import type { Point } from '../../../shared/types.ts';
import { Observable } from '../observable.ts';

const FIT_FILL = 0.8;
const EMPTY_EXTENTS: Bounds = { minX: 0, minY: 0, maxX: 10000, maxY: 7000 };
export const WHEEL_STEP = 1.25;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 5000;

export interface CameraState {
  width: number;
  height: number;
  /** The extents the view was last fitted to. */
  fit: Bounds;
  zoom: number;
  /** Model point at the middle of the canvas. */
  center: Point;
}

function fitScale(state: Pick<CameraState, 'width' | 'height' | 'fit'>): number {
  const { fit, width, height } = state;
  const wide = fit.maxX - fit.minX;
  const tall = fit.maxY - fit.minY;
  const scale = Math.min(wide > 0 ? (FIT_FILL * width) / wide : Infinity, tall > 0 ? (FIT_FILL * height) / tall : Infinity);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Zoom as a whole percent of the fitted view. */
export const zoomPercent = (state: CameraState): number => Math.round(state.zoom * 100);

export const scaleOf = (state: CameraState): number => fitScale(state) * state.zoom;

export const toScreen = (state: CameraState, point: Point): Point => {
  const scale = scaleOf(state);
  return [state.width / 2 + (point[0] - state.center[0]) * scale, state.height / 2 - (point[1] - state.center[1]) * scale];
};

export const toModel = (state: CameraState, x: number, y: number): Point => {
  const scale = scaleOf(state);
  return [state.center[0] + (x - state.width / 2) / scale, state.center[1] - (y - state.height / 2) / scale];
};

const centreOf = (bounds: Bounds): Point => [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];

export class Camera extends Observable<CameraState> {
  constructor(fit: Bounds = EMPTY_EXTENTS) {
    super({ width: 0, height: 0, fit, zoom: 1, center: centreOf(fit) });
  }

  setSize(width: number, height: number): void {
    this.update({ width, height });
  }

  /** Fit to extents (null = the empty-drawing area) and reset the zoom to 100%. */
  fitTo(bounds: Bounds | null): void {
    const fit = bounds ?? EMPTY_EXTENTS;
    this.update({ fit, zoom: 1, center: centreOf(fit) });
  }

  /** Zooms by `factor` keeping the model point under `about` (canvas pixels) still; the canvas centre by default. */
  zoomBy(factor: number, about?: Point): void {
    const state = this.get();
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor));
    if (zoom === state.zoom) return;
    const anchor = about ?? [state.width / 2, state.height / 2];
    const model = toModel(state, anchor[0], anchor[1]);
    const next = { ...state, zoom };
    const scale = scaleOf(next);
    this.set({
      ...next,
      center: [model[0] - (anchor[0] - state.width / 2) / scale, model[1] + (anchor[1] - state.height / 2) / scale],
    });
  }

  panBy(dx: number, dy: number): void {
    const state = this.get();
    const scale = scaleOf(state);
    this.update({ center: [state.center[0] - dx / scale, state.center[1] + dy / scale] });
  }
}
