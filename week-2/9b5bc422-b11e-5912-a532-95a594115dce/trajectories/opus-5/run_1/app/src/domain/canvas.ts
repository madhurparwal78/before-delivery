import type { WorldPosition } from './types.ts';

export const CARD_WIDTH = 240;
const SLOT_STEP_X = 280;
const SLOT_STEP_Y = 200;
const SLOT_COLUMN = 5;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const FIT_MARGIN = 40;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The card slot rule: each card with no stored position takes the next slot in
 * reading order, to the right of every card that already has one.
 */
export function cardSlots(count: number, storedX: number[]): WorldPosition[] {
  const right = storedX.length ? Math.max(...storedX) + SLOT_STEP_X : 0;
  const slots: WorldPosition[] = [];
  for (let index = 0; index < count; index += 1) {
    slots.push({
      x: right + SLOT_STEP_X * Math.floor(index / SLOT_COLUMN),
      y: SLOT_STEP_Y * (index % SLOT_COLUMN),
    });
  }
  return slots;
}

export type Rect = { x: number; y: number; width: number; height: number };

/** Zoom and pan that bring every card inside the region with a margin to spare. */
export function fitToView(
  cards: Rect[],
  region: { width: number; height: number },
): { zoom: number; panX: number; panY: number } {
  if (!cards.length) return { zoom: 1, panX: FIT_MARGIN, panY: FIT_MARGIN };
  const minX = Math.min(...cards.map((card) => card.x));
  const minY = Math.min(...cards.map((card) => card.y));
  const maxX = Math.max(...cards.map((card) => card.x + card.width));
  const maxY = Math.max(...cards.map((card) => card.y + card.height));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const usableWidth = Math.max(region.width - FIT_MARGIN * 2, 1);
  const usableHeight = Math.max(region.height - FIT_MARGIN * 2, 1);
  const zoom = clampZoom(Math.min(usableWidth / width, usableHeight / height));
  const panX = (region.width - width * zoom) / 2 - minX * zoom;
  const panY = (region.height - height * zoom) / 2 - minY * zoom;
  return { zoom, panX, panY };
}

export function zoomAbout(
  current: { zoom: number; panX: number; panY: number },
  factor: number,
  point: { x: number; y: number },
): { zoom: number; panX: number; panY: number } {
  const zoom = clampZoom(current.zoom * factor);
  const scale = zoom / current.zoom;
  return {
    zoom,
    panX: point.x - (point.x - current.panX) * scale,
    panY: point.y - (point.y - current.panY) * scale,
  };
}

export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
