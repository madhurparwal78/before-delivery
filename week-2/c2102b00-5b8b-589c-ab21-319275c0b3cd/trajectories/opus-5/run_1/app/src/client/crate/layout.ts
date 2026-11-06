import type { CrateModel } from './model.ts';

/** The crate's measurements, shared by the WebGL and the still drawing. */
export const BOX = {
  width: 1.0,
  depth: 0.8,
  height: 0.4,
  wall: 0.035,
} as const;

export const VIEW = {
  elevation: (55 * Math.PI) / 180,
  frustumHeight: 1.5,
  aspect: 4 / 3,
  distance: 4,
} as const;

export interface SlotSize {
  width: number;
  depth: number;
}

export function slotSize(model: CrateModel): SlotSize {
  const inner = BOX.width - 2 * BOX.wall;
  const innerDepth = BOX.depth - 2 * BOX.wall;
  return { width: inner / model.columns, depth: innerDepth / model.rows };
}

/** The slot of a cell: the first cell is back-left, the row runs left to right. */
export function slotCentre(model: CrateModel, index: number): { x: number; z: number } {
  const size = slotSize(model);
  const column = index % model.columns;
  const row = Math.floor(index / model.columns);
  const inner = BOX.width - 2 * BOX.wall;
  const innerDepth = BOX.depth - 2 * BOX.wall;
  return {
    x: -inner / 2 + (column + 0.5) * size.width,
    z: -innerDepth / 2 + (row + 0.5) * size.depth,
  };
}

export function unitBodyHeight(kind: CrateModel['unit']): number {
  if (kind === 'bottle') return 0.3;
  if (kind === 'jug') return 0.22;
  if (kind === 'jar') return 0.17;
  return 0.16;
}

export function topExtent(model: CrateModel): number {
  const size = slotSize(model);
  return 0.6 * Math.min(size.width, size.depth);
}
