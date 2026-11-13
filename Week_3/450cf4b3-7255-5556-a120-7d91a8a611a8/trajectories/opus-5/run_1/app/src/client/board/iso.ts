import { svg } from '../dom';

export const TILE_WIDTH = 96;
export const TILE_DEPTH = 48;
export const MAX_EXTRUSION = 96;
export const BLOCK_VIEW_HEIGHT = MAX_EXTRUSION + TILE_DEPTH + 6;
export const BLOCK_VIEW_WIDTH = TILE_WIDTH;
export const COLUMN_STEP = 108;
export const ROW_STEP = 74;

export interface PlanPosition {
  left: number;
  top: number;
}

/** Isometric placement of a station from its grid position. */
export function planPosition(col: number, row: number, minColRowDiff: number): PlanPosition {
  return {
    left: (col - row - minColRowDiff) * (COLUMN_STEP / 2),
    top: (col + row) * (ROW_STEP / 2),
  };
}

export function extrusionPixels(occupiedMinutes: number, spanMinutes: number): number {
  if (spanMinutes <= 0) return 0;
  return (occupiedMinutes / spanMinutes) * MAX_EXTRUSION;
}

/** data-extrusion: the target extrusion in whole pixels, an exact half rounded up. */
export function roundExtrusion(value: number): number {
  return Math.floor(value + 0.5);
}

export interface BlockShape {
  extrusion: number;
  bufferShare: number;
  full: boolean;
  name: string;
  label: string;
}

export interface BlockNodes {
  root: SVGElement;
  top: SVGElement;
  left: SVGElement;
  right: SVGElement;
  band: SVGElement;
  hatch: SVGElement;
  nameText: SVGElement;
  labelText: SVGElement;
}

function diamond(x: number, y: number): string {
  const halfWidth = TILE_WIDTH / 2;
  const halfDepth = TILE_DEPTH / 2;
  return [
    `${x + halfWidth},${y}`,
    `${x + TILE_WIDTH},${y + halfDepth}`,
    `${x + halfWidth},${y + TILE_DEPTH}`,
    `${x},${y + halfDepth}`,
  ].join(' ');
}

export function createBlock(stationId: string): BlockNodes {
  const root = svg('svg', {
    viewBox: `0 0 ${BLOCK_VIEW_WIDTH} ${BLOCK_VIEW_HEIGHT}`,
    width: BLOCK_VIEW_WIDTH,
    height: BLOCK_VIEW_HEIGHT,
    class: 'station-block',
    'aria-hidden': 'true',
  });
  const defs = svg('defs');
  const pattern = svg('pattern', {
    id: `hatch-${stationId}`,
    width: 6,
    height: 6,
    patternUnits: 'userSpaceOnUse',
    patternTransform: 'rotate(45)',
  });
  pattern.append(svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatch-line' }));
  defs.append(pattern);
  const left = svg('polygon', { class: 'face left', points: '' });
  const right = svg('polygon', { class: 'face right', points: '' });
  const band = svg('polygon', { class: 'cleanup-band', points: '' });
  const top = svg('polygon', { class: 'face top', points: '' });
  const hatch = svg('polygon', {
    class: 'hatch',
    points: '',
    fill: `url(#hatch-${stationId})`,
    opacity: '0',
  });
  const nameText = svg('text', { class: 'block-name', x: TILE_WIDTH / 2, y: 0, 'text-anchor': 'middle' });
  const labelText = svg('text', { class: 'block-label', x: TILE_WIDTH / 2, y: 0, 'text-anchor': 'middle' });
  root.append(defs, left, right, band, top, hatch, nameText, labelText);
  return { root, top, left, right, band, hatch, nameText, labelText };
}

/** Redraws the block's faces, cleanup band, hatch and label for one extrusion. */
export function drawBlock(nodes: BlockNodes, shape: BlockShape): void {
  const baseY = BLOCK_VIEW_HEIGHT - TILE_DEPTH - 2;
  const height = Math.max(0, Math.min(MAX_EXTRUSION, shape.extrusion));
  const topY = baseY - height;
  const halfWidth = TILE_WIDTH / 2;
  const halfDepth = TILE_DEPTH / 2;

  nodes.top.setAttribute('points', diamond(0, topY));
  nodes.hatch.setAttribute('points', diamond(0, topY));
  nodes.hatch.setAttribute('opacity', shape.full ? '1' : '0');
  nodes.left.setAttribute(
    'points',
    [
      `0,${topY + halfDepth}`,
      `${halfWidth},${topY + TILE_DEPTH}`,
      `${halfWidth},${baseY + TILE_DEPTH}`,
      `0,${baseY + halfDepth}`,
    ].join(' '),
  );
  nodes.right.setAttribute(
    'points',
    [
      `${halfWidth},${topY + TILE_DEPTH}`,
      `${TILE_WIDTH},${topY + halfDepth}`,
      `${TILE_WIDTH},${baseY + halfDepth}`,
      `${halfWidth},${baseY + TILE_DEPTH}`,
    ].join(' '),
  );
  const bandHeight = Math.max(0, Math.min(height, height * shape.bufferShare));
  nodes.band.setAttribute(
    'points',
    bandHeight <= 0
      ? ''
      : [
          `0,${topY + halfDepth}`,
          `${halfWidth},${topY + TILE_DEPTH}`,
          `${TILE_WIDTH},${topY + halfDepth}`,
          `${TILE_WIDTH},${topY + halfDepth + bandHeight}`,
          `${halfWidth},${topY + TILE_DEPTH + bandHeight}`,
          `0,${topY + halfDepth + bandHeight}`,
        ].join(' '),
  );
  nodes.nameText.setAttribute('y', String(topY + halfDepth - 2));
  nodes.nameText.textContent = shape.name;
  nodes.labelText.setAttribute('y', String(topY + halfDepth + 12));
  nodes.labelText.textContent = shape.label;
}

export function createSlab(label: string): SVGElement {
  const root = svg('svg', {
    viewBox: `0 0 ${TILE_WIDTH} ${TILE_DEPTH + 16}`,
    width: TILE_WIDTH,
    height: TILE_DEPTH + 16,
    class: 'slab-shape',
    'aria-hidden': 'true',
  });
  root.append(svg('polygon', { class: 'slab-face', points: diamond(0, 8) }));
  const text = svg('text', {
    class: 'slab-text',
    x: TILE_WIDTH / 2,
    y: TILE_DEPTH / 2 + 12,
    'text-anchor': 'middle',
  });
  text.textContent = label;
  root.append(text);
  return root;
}

/** A dashed hairline hugging the row of cooler shelves. */
export function createCoolerOutline(
  tiles: ReadonlyArray<PlanPosition>,
  width: number,
  height: number,
  origin: PlanPosition,
): SVGElement {
  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    class: 'cooler-outline',
    'aria-hidden': 'true',
  });
  const first = tiles[0];
  const last = tiles[tiles.length - 1];
  if (first === undefined || last === undefined) return root;
  const margin = 8;
  const baseY = BLOCK_VIEW_HEIGHT - TILE_DEPTH - 2;
  const point = (tile: PlanPosition, dx: number, dy: number): string =>
    `${tile.left - origin.left + dx},${tile.top - origin.top + baseY + dy}`;
  const points = [
    point(first, TILE_WIDTH / 2, -margin),
    point(last, TILE_WIDTH / 2, -margin),
    point(last, TILE_WIDTH + margin, TILE_DEPTH / 2),
    point(last, TILE_WIDTH / 2, TILE_DEPTH + margin),
    point(first, TILE_WIDTH / 2, TILE_DEPTH + margin),
    point(first, -margin, TILE_DEPTH / 2),
  ].join(' ');
  root.append(svg('polygon', { points, class: 'cooler-outline-shape' }));
  return root;
}
