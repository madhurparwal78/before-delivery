// Geometry rules (brief: Business rules, Geometry rules): snapping, nudges, ports, the default port
// pair, the insertion position, reading order, align and distribute.
import type { Box, Page, Point, Port, Shape } from "./types";

const GRID = 8;
export const NUDGE = 8;
export const FINE_NUDGE = 1;
const MIN_SIZE = 24;
const MAX_SIZE = 2000;
const COORD_LIMIT = 20000;

/** The inclusive range of each geometry field (brief: Limits); the inspector and the server both check it. */
export const FIELD_RANGE = {
  x: [-COORD_LIMIT, COORD_LIMIT],
  y: [-COORD_LIMIT, COORD_LIMIT],
  w: [MIN_SIZE, MAX_SIZE],
  h: [MIN_SIZE, MAX_SIZE],
} as const satisfies Record<string, readonly [number, number]>;

export type GeometryField = keyof typeof FIELD_RANGE;

/** True when the value is a whole number inside the field's range. */
export function inRange(field: GeometryField, value: unknown): value is number {
  const [min, max] = FIELD_RANGE[field];
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
export const INSERT_W = 160;
export const INSERT_H = 80;
const INSERT_SHIFT = 208;
export const DUPLICATE_OFFSET = 24;
const ZOOM_STEPS: readonly number[] = [25, 50, 75, 100, 150, 200, 300, 400];
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

/** Nearest multiple of 8; halves round up. */
function snap(value: number): number {
  return GRID * Math.floor(value / GRID + 0.5);
}

/** Snapped, or rounded to the nearest integer while snapping is off (halves upward in both cases). */
function place(value: number, free: boolean): number {
  return free ? Math.floor(value + 0.5) : snap(value);
}

/**
 * The one offset a dragged selection moves by: with snapping, the selection's bounding box lands with
 * its left and top edges on multiples of 8; sizes never change.
 */
export function moveOffset(boxes: readonly Box[], dx: number, dy: number, free: boolean): Point {
  const box = boundingBox(boxes);
  return [place(box.x + dx, free) - box.x, place(box.y + dy, free) - box.y];
}

/** A shape's corner, named by the edges it joins. */
export type Corner = "nw" | "ne" | "sw" | "se";

/**
 * A corner resize: the opposite corner stays fixed and the dragged edges snap (or round); a size outside
 * 24 to 2,000 stops exactly at that limit from the fixed edge, unsnapped.
 */
export function resizeBox(start: Box, corner: Corner, dx: number, dy: number, free: boolean): Box {
  const axis = (pos: number, size: number, delta: number, low: boolean): [number, number] => {
    if (low) {
      const fixed = pos + size;
      const length = Math.min(MAX_SIZE, Math.max(MIN_SIZE, fixed - place(pos + delta, free)));
      return [fixed - length, length];
    }
    return [pos, Math.min(MAX_SIZE, Math.max(MIN_SIZE, place(pos + size + delta, free) - pos))];
  };
  const [x, w] = axis(start.x, start.w, dx, corner.endsWith("w"));
  const [y, h] = axis(start.y, start.h, dy, corner.startsWith("n"));
  return { x, y, w, h };
}

export function portPoint(box: Box, port: Port): Point {
  switch (port) {
    case "n":
      return [Math.floor(box.x + box.w / 2), box.y];
    case "e":
      return [box.x + box.w, Math.floor(box.y + box.h / 2)];
    case "s":
      return [Math.floor(box.x + box.w / 2), box.y + box.h];
    case "w":
      return [box.x, Math.floor(box.y + box.h / 2)];
  }
}

export const PORTS: readonly Port[] = ["n", "e", "s", "w"];

/** The default port pair from source to target. */
export function defaultPorts(source: Box, target: Box): { from: Port; to: Port } {
  const scx = source.x + source.w / 2;
  const scy = source.y + source.h / 2;
  const tcx = target.x + target.w / 2;
  const tcy = target.y + target.h / 2;
  const right = tcx >= scx;
  const below = tcy >= scy;
  const horizontalGap = right ? target.x - (source.x + source.w) : source.x - (target.x + target.w);
  const verticalGap = below ? target.y - (source.y + source.h) : source.y - (target.y + target.h);
  if (horizontalGap >= verticalGap) return right ? { from: "e", to: "w" } : { from: "w", to: "e" };
  return below ? { from: "s", to: "n" } : { from: "n", to: "s" };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function visibleLayerIds(page: Page): Set<string> {
  return new Set(page.layers.filter((layer) => layer.visible).map((layer) => layer.id));
}

/** The top visible, unlocked layer of the page, or null when insertion is impossible. */
export function insertionLayer(page: Page): string | null {
  const open = page.layers.filter((layer) => layer.visible && !layer.locked).sort((a, b) => b.order - a.order);
  return open[0]?.id ?? null;
}

/** Where an inserted 160x80 shape goes, given the document point at the canvas centre. */
export function insertionPosition(page: Page, centre: Point): Point {
  const visible = visibleLayerIds(page);
  const others = page.shapes.filter((shape) => visible.has(shape.layer));
  const box = { x: Math.floor(centre[0] - INSERT_W / 2), y: Math.floor(centre[1] - INSERT_H / 2), w: INSERT_W, h: INSERT_H };
  while (others.some((shape) => overlaps(box, shape))) box.x += INSERT_SHIFT;
  return [box.x, box.y];
}

/** Reading order: top edge, then left edge, then id. */
export function readingOrder<T extends Shape>(shapes: readonly T[]): T[] {
  return [...shapes].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function boundingBox(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

export type AlignSide = "left" | "centre" | "right" | "top" | "middle" | "bottom";

/** One rigid box for align and distribute: a selected group (its members' bounding box) or one ungrouped shape. */
interface Unit {
  box: Box;
  members: Shape[];
  /** The lowest shape id in the unit, for distribute's tie break. */
  key: string;
}

/** Align needs two or more units and distribute three or more; with fewer the controls are disabled. */
export function canAlign(shapes: readonly Shape[]): boolean {
  return alignmentUnits(shapes).length >= 2;
}

export function canDistribute(shapes: readonly Shape[]): boolean {
  return alignmentUnits(shapes).length >= 3;
}

function alignmentUnits(shapes: readonly Shape[]): Unit[] {
  const byGroup = new Map<string, Shape[]>();
  for (const s of shapes) byGroup.set(s.group ?? s.id, [...(byGroup.get(s.group ?? s.id) ?? []), s]);
  return [...byGroup.values()].map((members) => ({ box: boundingBox(members), members, key: members.map((m) => m.id).sort()[0] as string }));
}

/** Moves every member of each unit by that unit's offset. */
function moveUnits(moves: [Unit, number, number][]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const [unit, ox, oy] of moves) for (const m of unit.members) out.set(m.id, { x: m.x + ox, y: m.y + oy });
  return out;
}

/** New x and y for every selected shape, each unit aligned against the bounding box of all units (results round down). */
export function align(shapes: readonly Shape[], side: AlignSide): Map<string, { x: number; y: number }> {
  const units = alignmentUnits(shapes);
  const all = boundingBox(units.map((u) => u.box));
  return moveUnits(units.map((u): [Unit, number, number] => {
    const b = u.box;
    let { x, y } = b;
    if (side === "left") x = all.x;
    if (side === "centre") x = Math.floor(all.x + all.w / 2 - b.w / 2);
    if (side === "right") x = all.x + all.w - b.w;
    if (side === "top") y = all.y;
    if (side === "middle") y = Math.floor(all.y + all.h / 2 - b.h / 2);
    if (side === "bottom") y = all.y + all.h - b.h;
    return [u, x - b.x, y - b.y];
  }));
}

/** Equal gaps between neighbouring unit boxes; the first and last units stay put. */
export function distribute(shapes: readonly Shape[], axis: "horizontal" | "vertical"): Map<string, { x: number; y: number }> {
  const pos = (b: Box) => (axis === "horizontal" ? b.x : b.y);
  const size = (b: Box) => (axis === "horizontal" ? b.w : b.h);
  const order = alignmentUnits(shapes).sort((a, b) => pos(a.box) + size(a.box) / 2 - (pos(b.box) + size(b.box) / 2) || (a.key < b.key ? -1 : 1));
  const first = order[0];
  const last = order[order.length - 1];
  if (!first || !last) return new Map();
  const inner = order.slice(1, -1);
  const span = pos(last.box) - (pos(first.box) + size(first.box)) - inner.reduce((sum, u) => sum + size(u.box), 0);
  const gap = Math.floor(span / (order.length - 1));
  let cursor = pos(first.box) + size(first.box);
  const moves: [Unit, number, number][] = [[first, 0, 0], [last, 0, 0]];
  for (const u of inner) {
    cursor += gap;
    const offset = cursor - pos(u.box);
    moves.push(axis === "horizontal" ? [u, offset, 0] : [u, 0, offset]);
    cursor += size(u.box);
  }
  return moveUnits(moves);
}

export function nextZoom(current: number, direction: 1 | -1): number {
  const percent = Math.round(current * 100);
  const steps = direction > 0 ? ZOOM_STEPS.filter((s) => s > percent) : ZOOM_STEPS.filter((s) => s < percent).reverse();
  return (steps[0] ?? (direction > 0 ? ZOOM_MAX * 100 : ZOOM_MIN * 100)) / 100;
}

