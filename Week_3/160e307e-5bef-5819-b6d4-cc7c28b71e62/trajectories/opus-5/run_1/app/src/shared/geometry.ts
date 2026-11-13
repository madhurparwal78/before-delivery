import type { Piece, PieceId, Seat, Colour } from './types.js';

export const MODEL_VERSION = 'dc-model-1';

export const CUSHION = 370;

export const POCKET_RADIUS = 22.25;
export const POCKET_CENTRES: { id: 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number }[] = [
  { id: 'nw', x: -347.75, y: -347.75 },
  { id: 'ne', x: 347.75, y: -347.75 },
  { id: 'sw', x: -347.75, y: 347.75 },
  { id: 'se', x: 347.75, y: 347.75 },
];

export const COIN_RADIUS = 15.5;
export const COIN_MASS = 5.5;
export const STRIKER_RADIUS = 20.65;
export const STRIKER_MASS = 15;

/** Centre distance at which the striker touches a coin. */
export const STRIKER_COIN_TOUCH = STRIKER_RADIUS + COIN_RADIUS;

export const BASELINE_Y = 252.1;
export const BASELINE_MAX_OFFSET = 200;
export const OFFSET_GRID = 0.5;

export const STRIKER_SPEED_PER_POWER = 4000;

export const WHITE_IDS: PieceId[] = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9'];
export const BLACK_IDS: PieceId[] = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'];
export const COIN_IDS: PieceId[] = [...WHITE_IDS, ...BLACK_IDS];

/** Bodies are always handled in this order, so a replayed log is byte-identical. */
export const BODY_ORDER: PieceId[] = ['striker', 'queen', ...WHITE_IDS, ...BLACK_IDS];

export const OPENING_LAYOUT: { id: PieceId; x: number; y: number }[] = [
  { id: 'queen', x: 0.0, y: 0.0 },
  { id: 'w1', x: 31.2, y: 0.0 },
  { id: 'b1', x: 15.6, y: 27.0 },
  { id: 'w2', x: -15.6, y: 27.0 },
  { id: 'b2', x: -31.2, y: 0.0 },
  { id: 'w3', x: -15.6, y: -27.0 },
  { id: 'b3', x: 15.6, y: -27.0 },
  { id: 'w4', x: 62.4, y: 0.0 },
  { id: 'b4', x: 46.8, y: 27.0 },
  { id: 'b5', x: 31.2, y: 54.0 },
  { id: 'w5', x: 0.0, y: 54.0 },
  { id: 'w6', x: -31.2, y: 54.0 },
  { id: 'b6', x: -46.8, y: 27.0 },
  { id: 'b7', x: -62.4, y: 0.0 },
  { id: 'w7', x: -46.8, y: -27.0 },
  { id: 'w8', x: -31.2, y: -54.0 },
  { id: 'b8', x: 0.0, y: -54.0 },
  { id: 'b9', x: 31.2, y: -54.0 },
  { id: 'w9', x: 46.8, y: -27.0 },
];

export function radiusOf(id: PieceId): number {
  return id === 'striker' ? STRIKER_RADIUS : COIN_RADIUS;
}

export function massOf(id: PieceId): number {
  return id === 'striker' ? STRIKER_MASS : COIN_MASS;
}

export function colourOf(id: PieceId): Colour | null {
  if (id.startsWith('w')) return 'white';
  if (id.startsWith('b')) return 'black';
  return null;
}

/** The seat that owns a coin's colour. */
export function ownerSeat(id: PieceId, whiteSeat: Seat): Seat | null {
  const colour = colourOf(id);
  if (colour === null) return null;
  return colour === 'white' ? whiteSeat : otherSeat(whiteSeat);
}

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function coinIdsOf(seat: Seat, whiteSeat: Seat): PieceId[] {
  return seat === whiteSeat ? WHITE_IDS : BLACK_IDS;
}

export function baselineY(seat: Seat): number {
  return seat === 0 ? BASELINE_Y : -BASELINE_Y;
}

/** Board x for a shooter-relative baseline offset. */
export function offsetToBoardX(offset: number, seat: Seat): number {
  return seat === 0 ? offset : -offset;
}

/** Unit aim direction in board coordinates for an angle in degrees. */
export function aimDirection(angleDegrees: number, seat: Seat): { dx: number; dy: number } {
  const a = (angleDegrees * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const dx = seat === 0 ? s : -s;
  const dy = seat === 0 ? -c : c;
  return { dx: round6(dx), dy: round6(dy) };
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function openingPieces(): Piece[] {
  return OPENING_LAYOUT.map((p) => ({ id: p.id, x: p.x, y: p.y, state: 'board' as const, pocketedBy: null }));
}

export function strikerStart(seat: Seat): { x: number; y: number } {
  return { x: 0, y: baselineY(seat) };
}
