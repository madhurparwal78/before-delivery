// Board geometry: card size, snapping, limits, default placement, wheel zoom and arrow sides.

export const CARD_W = 240;
export const CARD_H = 160;
export const GRID = 8;
export const BOARD_LIMIT = 8000;
export const NUDGE = 8;
export const NUDGE_SHIFT = 40;
export const NUDGE_SAVE_MS = 400;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
/** deltaY pixels that halve or double the zoom */
export const WHEEL_ZOOM_PX = 400;
export const WHEEL_LINE_PX = 16;
export const DEFAULT_ORIGIN = 16;
export const DEFAULT_COLUMNS = 4;
export const DEFAULT_STEP_X = 256;
export const DEFAULT_STEP_Y = 192;

export interface Point {
  x: number;
  y: number;
}

export interface BoardView {
  z: number;
  tx: number;
  ty: number;
}

export const HOME_VIEW: BoardView = { z: 1, tx: 0, ty: 0 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Holds a coordinate within the board limits. */
export function clampCoord(v: number): number {
  return clamp(v, -BOARD_LIMIT, BOARD_LIMIT);
}

/** Whether a coordinate may be stored: an integer multiple of 8 within the limits. */
export function validCoord(v: number): boolean {
  return Number.isInteger(v) && v % GRID === 0 && Math.abs(v) <= BOARD_LIMIT;
}

/** Drag position for one axis: start `x0`, total pointer movement `deltaPx`, zoom `z`. */
export function snap(x0: number, deltaPx: number, z: number): number {
  return clampCoord(GRID * Math.floor((x0 + deltaPx / z) / GRID + 0.5));
}

/** Keyboard move for one axis; `dir` is −1, 0 or 1. */
export function nudge(v: number, dir: number, shift: boolean): number {
  return clampCoord(v + dir * (shift ? NUDGE_SHIFT : NUDGE));
}

/** Placement of the card at index `i` in the board's card order when it has no stored position. */
export function defaultPosition(i: number): Point {
  return {
    x: DEFAULT_ORIGIN + (i % DEFAULT_COLUMNS) * DEFAULT_STEP_X,
    y: DEFAULT_ORIGIN + Math.floor(i / DEFAULT_COLUMNS) * DEFAULT_STEP_Y,
  };
}

/** WheelEvent deltaY in pixels: deltaMode 1 counts lines of 16 px, 2 counts pages of `pageHeight`. */
export function wheelDeltaPx(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return deltaY * WHEEL_LINE_PX;
  if (deltaMode === 2) return deltaY * pageHeight;
  return deltaY;
}

/** Zoom about pointer (px, py), relative to the board group's top-left corner. */
export function wheelZoom(view: BoardView, deltaYPx: number, px: number, py: number): BoardView {
  const z = clamp(view.z * 2 ** (-deltaYPx / WHEEL_ZOOM_PX), ZOOM_MIN, ZOOM_MAX);
  return { z, tx: px - ((px - view.tx) * z) / view.z, ty: py - ((py - view.ty) * z) / view.z };
}

function fixed4(v: number): string {
  return Math.abs(v) < 5e-5 ? '0.0000' : v.toFixed(4);
}

/** The `data-board-transform` value. */
export function formatTransform(z: number, tx: number, ty: number): string {
  return `${fixed4(z)},${fixed4(tx)},${fixed4(ty)}`;
}

/** Side midpoints in the order top, right, bottom, left. */
export function sideMidpoints(card: Point): Point[] {
  return [
    { x: card.x + CARD_W / 2, y: card.y },
    { x: card.x + CARD_W, y: card.y + CARD_H / 2 },
    { x: card.x + CARD_W / 2, y: card.y + CARD_H },
    { x: card.x, y: card.y + CARD_H / 2 },
  ];
}

/** Arrow endpoints [x1, y1, x2, y2] in board units: the closest of the 16 midpoint pairs, ties to the earliest sides. */
export function arrowEnds(from: Point, to: Point): [number, number, number, number] {
  const targets = sideMidpoints(to);
  let best: [number, number, number, number] = [0, 0, 0, 0];
  let bestD = Infinity;
  for (const p of sideMidpoints(from)) {
    for (const q of targets) {
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [p.x, p.y, q.x, q.y];
      }
    }
  }
  return best;
}
