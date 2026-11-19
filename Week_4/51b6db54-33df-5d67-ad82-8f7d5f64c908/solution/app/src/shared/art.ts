import { EDGE_E, EDGE_N, EDGE_S, EDGE_W } from './rules';
import { edgeMask } from './tiles';

/** Generated artwork shared by the demo workspace and the landing page: a gumdrop walker. */
export const GUMDROP_SIZE = 32;

export const GUMDROP_PALETTE = [
  '2a1b3dff', // 1 outline
  'ff5fa2ff', // 2 body
  'ff9ec7ff', // 3 highlight
  'c2377aff', // 4 shade
  '7ff0c8ff', // 5 mint sprinkle
  'ffe66bff', // 6 lemon sprinkle
  '6be3ffff', // 7 cyan sprinkle
  'ffffffff', // 8 eye white
  'ff7a7aff', // 9 cheek
  '00000066', // 10 shadow
  '8f1f5bff', // 11 foot
  'ff9a3cff', // 12 orange sprinkle
] as const;

export type Rows = number[][];

const blank = (): Rows => Array.from({ length: GUMDROP_SIZE }, () => Array<number>(GUMDROP_SIZE).fill(0));

export interface GumdropCels {
  shadow: Rows;
  body: Rows;
  outline: Rows;
}

const SPRINKLES: readonly (readonly [number, number, number])[] = [
  [-5, -7, 5],
  [3, -9, 6],
  [6, -3, 7],
  [-7, 0, 12],
  [-2, 3, 5],
  [4, 4, 6],
];

/** One frame (0 to 7) of the walk cycle on three layers. */
export function gumdropCels(frame: number): GumdropCels {
  const shadow = blank();
  const body = blank();
  const outline = blank();
  const phase = (frame / 8) * Math.PI * 2;
  const bob = Math.round(Math.abs(Math.sin(phase)) * 2);
  const cx = 16;
  const cy = 16 - bob;
  const inside = (x: number, y: number): boolean => {
    const dx = (x - cx) / 10;
    const dy = (y - cy + 2) / (y < cy ? 11 : 9);
    return dx * dx + dy * dy <= 1;
  };
  for (let y = 0; y < GUMDROP_SIZE; y++) {
    for (let x = 0; x < GUMDROP_SIZE; x++) {
      if (!inside(x, y)) continue;
      const lit = x < cx - 2 && y < cy - 3;
      const shaded = x > cx + 3 || y > cy + 5;
      (body[y] as number[])[x] = lit ? 3 : shaded ? 4 : 2;
    }
  }
  for (const [dx, dy, colour] of SPRINKLES) {
    const x = cx + dx;
    const y = cy + dy;
    if (inside(x, y) && inside(x + 1, y)) {
      (body[y] as number[])[x] = colour;
      (body[y] as number[])[x + 1] = colour;
    }
  }
  const swing = Math.round(Math.sin(phase) * 3);
  for (const [foot, direction] of [[11, 1], [20, -1]] as const) {
    const x = foot + swing * direction;
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 4; dx++) (body[26 - bob + dy] as number[])[x + dx] = 11;
  }
  for (let y = 0; y < GUMDROP_SIZE; y++) {
    for (let x = 0; x < GUMDROP_SIZE; x++) {
      if (inside(x, y) || !(inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1))) continue;
      (outline[y] as number[])[x] = 1;
    }
  }
  for (const eyeX of [cx - 4, cx + 2]) {
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 3; dx++) (outline[cy - 4 + dy] as number[])[eyeX + dx] = dx === 1 && dy > 0 ? 1 : 8;
  }
  for (let dx = -2; dx <= 2; dx++) (outline[cy + 3 + (Math.abs(dx) === 2 ? -1 : 0)] as number[])[cx + dx] = 1;
  for (const cheek of [cx - 7, cx + 6]) for (let dx = 0; dx < 2; dx++) (body[cy + 1] as number[])[cheek + dx] = 9;
  const half = 6 + (bob === 0 ? 2 : 0);
  for (let x = cx - half; x <= cx + half; x++) (shadow[29] as number[])[x] = 10;
  for (let x = cx - half + 2; x <= cx + half - 2; x++) (shadow[30] as number[])[x] = 10;
  return { shadow, body, outline };
}

/** An 8 by 8 tile of the Candy Ground set for an edge mask: borders where no neighbour continues it. */
export function groundTile(mask: number): Rows {
  const tile: Rows = Array.from({ length: 8 }, () => Array<number>(8).fill(5));
  for (let i = 0; i < 8; i++) {
    if (!(mask & EDGE_N)) (tile[0] as number[])[i] = 4;
    if (!(mask & EDGE_S)) (tile[7] as number[])[i] = 4;
    if (!(mask & EDGE_W)) (tile[i] as number[])[0] = 4;
    if (!(mask & EDGE_E)) (tile[i] as number[])[7] = 4;
  }
  (tile[3] as number[])[3] = 6;
  (tile[4] as number[])[5] = 7;
  return tile;
}

/** Courtyard: a rounded plaza of ground tiles on a 12 by 8 map, tile numbers from the default edge table. */
export function courtyardCells(): { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[] {
  const width = 12;
  const height = 8;
  const filled = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && ((x - 5.5) / 5.5) ** 2 + ((y - 3.5) / 3.5) ** 2 <= 1.15;
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!filled(x, y)) continue;
      cells.push({ x, y, tile: edgeMask(filled, x, y) + 1, flip_h: false, flip_v: false });
    }
  }
  return cells;
}
