/** The single home of the board snap and the arrow side choice. */

export const BOARD_GRID = 8;
export const BOARD_MIN = -8000;
export const BOARD_MAX = 8000;
export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 160;
export const BOARD_ZOOM_MIN = 0.25;
export const BOARD_ZOOM_MAX = 4;
export const BOARD_NUDGE = 8;
export const BOARD_NUDGE_SHIFT = 40;
export const BOARD_MAX_POSITIONS = 200;

export function isBoardCoordinate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value % BOARD_GRID === 0 &&
    value >= BOARD_MIN &&
    value <= BOARD_MAX
  );
}

export function clampBoardCoordinate(value: number): number {
  return Math.min(BOARD_MAX, Math.max(BOARD_MIN, value));
}

/** The drag snap: from the press position, the pointer delta in pixels and the zoom. */
export function snapBoardCoordinate(start: number, deltaPixels: number, zoom: number): number {
  const raw = start + deltaPixels / zoom;
  const snapped = BOARD_GRID * Math.floor(raw / BOARD_GRID + 0.5);
  return clampBoardCoordinate(snapped);
}

export function defaultCardPosition(index: number): { x: number; y: number } {
  return { x: 16 + (index % 4) * 256, y: 16 + Math.floor(index / 4) * 192 };
}

export type SideName = 'top' | 'right' | 'bottom' | 'left';
export const SIDE_ORDER: SideName[] = ['top', 'right', 'bottom', 'left'];

export function sideMidpoint(x: number, y: number, side: SideName): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: x + CARD_WIDTH / 2, y };
    case 'right':
      return { x: x + CARD_WIDTH, y: y + CARD_HEIGHT / 2 };
    case 'bottom':
      return { x: x + CARD_WIDTH / 2, y: y + CARD_HEIGHT };
    default:
      return { x, y: y + CARD_HEIGHT / 2 };
  }
}

export type ArrowEnds = { from: { x: number; y: number }; to: { x: number; y: number } };

export function arrowEnds(
  fromCard: { x: number; y: number },
  toCard: { x: number; y: number },
): ArrowEnds {
  let best: { distance: number; from: SideName; to: SideName } | null = null;
  for (const fromSide of SIDE_ORDER) {
    for (const toSide of SIDE_ORDER) {
      const a = sideMidpoint(fromCard.x, fromCard.y, fromSide);
      const b = sideMidpoint(toCard.x, toCard.y, toSide);
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (best === null || distance < best.distance - 1e-9) {
        best = { distance, from: fromSide, to: toSide };
      }
    }
  }
  const chosen = best as { distance: number; from: SideName; to: SideName };
  return {
    from: sideMidpoint(fromCard.x, fromCard.y, chosen.from),
    to: sideMidpoint(toCard.x, toCard.y, chosen.to),
  };
}

/** Wheel zoom about the pointer. */
export function zoomAbout(
  zoom: number,
  translate: { x: number; y: number },
  pointer: { x: number; y: number },
  deltaY: number,
): { zoom: number; x: number; y: number } {
  const next = Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, zoom * Math.pow(2, -deltaY / 400)));
  const x = pointer.x - (pointer.x - translate.x) * (next / zoom);
  const y = pointer.y - (pointer.y - translate.y) * (next / zoom);
  return { zoom: next, x, y };
}
