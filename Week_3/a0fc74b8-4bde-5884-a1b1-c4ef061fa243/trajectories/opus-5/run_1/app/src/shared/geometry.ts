import type { FieldKind } from './types.ts';

export const MIN_SIZE = 0.02;

export const DEFAULT_SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 0.3, h: 0.06 },
  initials: { w: 0.1, h: 0.05 },
  date: { w: 0.2, h: 0.04 },
  text: { w: 0.3, h: 0.04 },
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const round4 = (n: number): number => Math.round(n * 10000) / 10000;

const clampRange = (n: number, lo: number, hi: number): number =>
  n < lo ? lo : n > hi ? hi : n;

/**
 * The one place that decides where a field may sit: never smaller than the
 * minimum, never outside its page.
 */
export const clampBox = (box: Box): Box => {
  const w = round4(clampRange(box.w, MIN_SIZE, 1));
  const h = round4(clampRange(box.h, MIN_SIZE, 1));
  return {
    x: round4(clampRange(box.x, 0, 1 - w)),
    y: round4(clampRange(box.y, 0, 1 - h)),
    w,
    h,
  };
};

export const isBoxValid = (box: Box): boolean =>
  Number.isFinite(box.x) &&
  Number.isFinite(box.y) &&
  Number.isFinite(box.w) &&
  Number.isFinite(box.h) &&
  box.w >= MIN_SIZE &&
  box.h >= MIN_SIZE &&
  box.x >= 0 &&
  box.y >= 0 &&
  box.x + box.w <= 1.00005 &&
  box.y + box.h <= 1.00005;

export const NUDGE_SMALL = 0.005;
export const NUDGE_LARGE = 0.05;
