import type { Box, FieldKind } from "./types.js";

const MIN_SIZE = 0.02;
export const STEP = 0.005;
export const BIG_STEP = 0.05;

export const DEFAULT_SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 0.3, h: 0.06 },
  initials: { w: 0.1, h: 0.05 },
  date: { w: 0.2, h: 0.04 },
  text: { w: 0.3, h: 0.04 },
};

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function clamp(value: number, low: number, high: number): number {
  return round4(Math.min(Math.max(value, low), Math.max(low, high)));
}

export function moveBox(box: Box, dx: number, dy: number): Box {
  return { ...box, x: clamp(box.x + dx, 0, 1 - box.w), y: clamp(box.y + dy, 0, 1 - box.h) };
}

export function resizeBox(box: Box, dw: number, dh: number): Box {
  return { ...box, w: clamp(box.w + dw, MIN_SIZE, 1 - box.x), h: clamp(box.h + dh, MIN_SIZE, 1 - box.y) };
}

export function boxCenteredAt(kind: FieldKind, cx: number, cy: number): Box {
  const { w, h } = DEFAULT_SIZE[kind];
  return { w, h, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) };
}

export function isBoxInsidePage(box: Box): boolean {
  const values = [box.x, box.y, box.w, box.h];
  if (!values.every((v) => Number.isFinite(v))) return false;
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.w >= MIN_SIZE &&
    box.h >= MIN_SIZE &&
    round4(box.x + box.w) <= 1 &&
    round4(box.y + box.h) <= 1
  );
}

export function roundBox(box: Box): Box {
  return { x: round4(box.x), y: round4(box.y), w: round4(box.w), h: round4(box.h) };
}
