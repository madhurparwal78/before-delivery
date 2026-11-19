import type { Tile } from './layout.js';

export const CHAT_REACH_TILES = 6;

export function chebyshev(from: Tile, to: Tile): number {
  return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
}

export function withinEarshot(from: Tile, to: Tile): boolean {
  return chebyshev(from, to) <= CHAT_REACH_TILES;
}
