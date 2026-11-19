import type { TerminalSign } from "./model";

export interface Point {
  x: number;
  y: number;
}

/** The breadboard is a grid of slots; a part sits at the centre of the slot with its index. */
const SLOT_W = 200;
const SLOT_H = 132;
const BOARD_PAD = 24;
const RAIL_H = 34;
/** Distance from a part's centre to each terminal. */
export const TERMINAL_REACH = 56;
const STUB = 18;
const BENCH_MIN_ROWS = 2;
const CORNER = 9;

interface BoardGeometry {
  columns: number;
  rows: number;
  width: number;
  height: number;
}

export function boardGeometry(count: number, columns: number, minRows = BENCH_MIN_ROWS): BoardGeometry {
  const rows = Math.max(minRows, Math.ceil(count / columns));
  return { columns, rows, width: 2 * BOARD_PAD + columns * SLOT_W, height: 2 * RAIL_H + rows * SLOT_H };
}

function slotOf(index: number, columns: number): { row: number; column: number } {
  return { row: Math.floor(index / columns), column: index % columns };
}

export function slotCenter(index: number, columns: number): Point {
  const { row, column } = slotOf(index, columns);
  return { x: BOARD_PAD + column * SLOT_W + SLOT_W / 2, y: RAIL_H + row * SLOT_H + SLOT_H / 2 };
}

/** The + terminal is on a part's left, the - terminal on its right. */
export function terminalPoint(index: number, columns: number, sign: TerminalSign): Point {
  const centre = slotCenter(index, columns);
  return { x: centre.x + (sign === "+" ? -TERMINAL_REACH : TERMINAL_REACH), y: centre.y };
}

interface Anchor {
  index: number;
  sign: TerminalSign;
}

function dropRepeats(points: Point[]): Point[] {
  return points.filter((p, i) => {
    const before = points[i - 1];
    return !before || before.x !== p.x || before.y !== p.y;
  });
}

/**
 * The corners of a wire between two terminals. Neighbouring facing terminals join straight; any other pair leaves
 * each terminal sideways, then runs along the channel just above the lower row. `lane` spreads parallel wires apart.
 */
export function wireRoute(from: Anchor, to: Anchor, columns: number, lane: number): Point[] {
  const a = terminalPoint(from.index, columns, from.sign);
  const b = terminalPoint(to.index, columns, to.sign);
  const slotA = slotOf(from.index, columns);
  const slotB = slotOf(to.index, columns);
  const [left, right] = a.x <= b.x ? [from, to] : [to, from];
  const facing = slotA.row === slotB.row && Math.abs(slotA.column - slotB.column) === 1 && left.sign === "-" && right.sign === "+";
  if (facing) return [a, b];
  const reach = STUB + (lane % 3) * 5;
  const exitA: Point = { x: a.x + (from.sign === "+" ? -reach : reach), y: a.y };
  const exitB: Point = { x: b.x + (to.sign === "+" ? -reach : reach), y: b.y };
  const channel = RAIL_H + Math.max(slotA.row, slotB.row) * SLOT_H + 10 + (lane % 5) * 5;
  return dropRepeats([a, exitA, { x: exitA.x, y: channel }, { x: exitB.x, y: channel }, exitB, b]);
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** A polyline with each interior corner rounded by a quadratic curve. */
export function roundedPath(points: readonly Point[]): string {
  const first = points[0];
  if (!first) return "";
  let path = `M${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < points.length; i += 1) {
    const here = points[i];
    const before = points[i - 1];
    const after = points[i + 1];
    if (!here || !before) continue;
    if (!after) {
      path += ` L${round(here.x)} ${round(here.y)}`;
      continue;
    }
    const inLength = Math.hypot(here.x - before.x, here.y - before.y);
    const outLength = Math.hypot(after.x - here.x, after.y - here.y);
    const radius = Math.min(CORNER, inLength / 2, outLength / 2);
    const enter = { x: here.x + ((before.x - here.x) / inLength) * radius, y: here.y + ((before.y - here.y) / inLength) * radius };
    const leave = { x: here.x + ((after.x - here.x) / outLength) * radius, y: here.y + ((after.y - here.y) / outLength) * radius };
    path += ` L${round(enter.x)} ${round(enter.y)} Q${round(here.x)} ${round(here.y)} ${round(leave.x)} ${round(leave.y)}`;
  }
  return path;
}
