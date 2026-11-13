import { round } from './numbers.js';

export interface GestureStart {
  distance: number;
  midX: number;
  midY: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface GestureView {
  zoom: number;
  panX: number;
  panY: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 50;
export const TAP_MOVE_PX = 8;
export const TAP_MS = 500;
export const LONG_PRESS_MS = 500;

/** Every move computes the view afresh from the gesture start values. */
export function pinchView(start: GestureStart, distance: number, midX: number, midY: number): GestureView {
  const raw = start.zoom * (distance / start.distance);
  const zoom = round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, raw)), 4);
  const ratio = zoom / start.zoom;
  return {
    zoom,
    panX: round(midX - (start.midX - start.panX) * ratio, 4),
    panY: round(midY - (start.midY - start.panY) * ratio, 4),
  };
}

export const WHEEL_STEP = 1.2;

export function wheelZoom(zoom: number, direction: 'in' | 'out'): number {
  return direction === 'in' ? zoom * WHEEL_STEP : zoom / WHEEL_STEP;
}
