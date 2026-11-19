import type { Box } from './layout.ts';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const WHEEL_STEP = 1.1;
export const FIT_MARGIN = 96;
const FOCUS_MARGIN = 48;
export const MINIMAP_STEP = 40;

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;
export const clampZoom = (zoom: number): number => round4(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)));

/** A map is opened at zoom 1 with the root centred. */
export const openView = (width: number, height: number): View => ({ zoom: 1, panX: width / 2, panY: height / 2 });

/** Zoom about a point given relative to the canvas, keeping the map point under it still. */
export function zoomAbout(view: View, zoom: number, px: number, py: number): View {
  const next = clampZoom(zoom);
  return { zoom: next, panX: px - ((px - view.panX) * next) / view.zoom, panY: py - ((py - view.panY) * next) / view.zoom };
}

export const wheelZoom = (view: View, deltaY: number, px: number, py: number): View =>
  zoomAbout(view, deltaY < 0 ? view.zoom * WHEEL_STEP : view.zoom / WHEEL_STEP, px, py);

export function boundsOf(boxes: Iterable<Box>): { left: number; top: number; right: number; bottom: number } | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of boxes) {
    left = Math.min(left, box.x - Math.floor(box.w / 2));
    right = Math.max(right, box.x - Math.floor(box.w / 2) + box.w);
    top = Math.min(top, box.y - Math.floor(box.h / 2));
    bottom = Math.max(bottom, box.y - Math.floor(box.h / 2) + box.h);
  }
  return Number.isFinite(left) ? { left, top, right, bottom } : null;
}

/** Fit to screen, and the frame of a presentation slide: the whole box set centred at most at zoom 1. */
export function fitView(boxes: Iterable<Box>, width: number, height: number): View {
  const bounds = boundsOf(boxes);
  if (!bounds) return openView(width, height);
  const bw = bounds.right - bounds.left;
  const bh = bounds.bottom - bounds.top;
  const zoom = round4(Math.min(1, (width - FIT_MARGIN) / bw, (height - FIT_MARGIN) / bh));
  const cx = (bounds.left + bounds.right) / 2;
  const cy = (bounds.top + bounds.bottom) / 2;
  return { zoom, panX: width / 2 - cx * zoom, panY: height / 2 - cy * zoom };
}

/** The least pan that leaves a box at least 48 px inside the canvas. */
export function keepInView(view: View, box: Box, width: number, height: number): View {
  const half = { w: box.w / 2, h: box.h / 2 };
  const left = (box.x - half.w) * view.zoom + view.panX;
  const right = (box.x + half.w) * view.zoom + view.panX;
  const top = (box.y - half.h) * view.zoom + view.panY;
  const bottom = (box.y + half.h) * view.zoom + view.panY;
  let dx = 0;
  let dy = 0;
  if (left < FOCUS_MARGIN) dx = FOCUS_MARGIN - left;
  else if (right > width - FOCUS_MARGIN) dx = width - FOCUS_MARGIN - right;
  if (top < FOCUS_MARGIN) dy = FOCUS_MARGIN - top;
  else if (bottom > height - FOCUS_MARGIN) dy = height - FOCUS_MARGIN - bottom;
  if (right - left > width - 2 * FOCUS_MARGIN && dx !== 0) dx = FOCUS_MARGIN - left;
  if (bottom - top > height - 2 * FOCUS_MARGIN && dy !== 0) dy = FOCUS_MARGIN - top;
  return dx === 0 && dy === 0 ? view : { ...view, panX: view.panX + dx, panY: view.panY + dy };
}

/** The map point at the middle of the canvas. */
export const centreOf = (view: View, width: number, height: number): { x: number; y: number } => ({
  x: (width / 2 - view.panX) / view.zoom,
  y: (height / 2 - view.panY) / view.zoom,
});

/** The view that shows another person's zoom and centre on my canvas. */
export const followView = (zoom: number, centre: { x: number; y: number }, width: number, height: number): View => ({
  zoom,
  panX: width / 2 - centre.x * zoom,
  panY: height / 2 - centre.y * zoom,
});

export const formatZoom = (zoom: number): string => zoom.toFixed(4);
export const formatPan = (pan: number): string => pan.toFixed(2);
