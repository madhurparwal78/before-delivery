// Isometric floor geometry, computed in the browser from each station's kind, col and row and the
// plan's measured size. All units are CSS pixels, so a 96-unit extrusion is 96 pixels tall.

import type { StationKind } from "../../shared/api.js";
import { EXTRUSION_PX } from "../../shared/metrics.js";

export interface Point {
  x: number;
  y: number;
}

/** Footprint along the two isometric floor axes, in units of `u`. */
const FOOTPRINT: Readonly<Record<StationKind, { w: number; d: number }>> = {
  range: { w: 1, d: 0.8 },
  prep_table: { w: 1.15, d: 0.6 },
  mixer: { w: 0.6, d: 0.6 },
  cooler_shelf: { w: 1, d: 0.45 },
};

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const MAX_SCREEN_WIDTH = 1.8 * COS30;
const MAX_TILE_HEIGHT = 1.8 * SIN30;
const MARGIN = 12;
const HEADROOM = 18;
const TOP_PAD = 10;
const LABEL_BELOW = 84;
const PAD = 8;

export interface Block {
  id: string;
  cell: { x: number; y: number; width: number; height: number };
  /** Floor-level corners: back, right, front, left. */
  back: Point;
  right: Point;
  front: Point;
  left: Point;
  /** Maps footprint coordinates (0..w, 0..d) to the floor plane. */
  at: (a: number, b: number) => Point;
  footprint: { w: number; d: number };
  u: number;
  label: { x: number; y: number; width: number };
}

export interface Plan {
  width: number;
  height: number;
  labelsBelow: boolean;
  blocks: Block[];
  cooler: { x: number; y: number; width: number; height: number } | null;
}

interface StationPlace {
  id: string;
  kind: StationKind;
  col: number;
  row: number;
}

export function planFor(stations: readonly StationPlace[], width: number, heightLimit: number | null): Plan {
  const cols = Math.max(1, ...stations.map((s) => s.col + 1));
  const rows = Math.max(1, ...stations.map((s) => s.row + 1));
  const labelsBelow = width < 900;
  const cellWidth = (width - 2 * MARGIN) / cols;
  const fixed = labelsBelow ? TOP_PAD + EXTRUSION_PX + 8 + LABEL_BELOW + 12 : TOP_PAD + EXTRUSION_PX + 22;
  let u = labelsBelow
    ? Math.min((cellWidth - 2 * PAD) * 0.82, 170) / MAX_SCREEN_WIDTH
    : Math.min((cellWidth - 2 * PAD - 12) * 0.5, 190) / MAX_SCREEN_WIDTH;
  if (heightLimit !== null) {
    u = Math.min(u, ((heightLimit - 2 * MARGIN - HEADROOM) / rows - fixed) / MAX_TILE_HEIGHT);
  }
  u = Math.max(24, u);
  const tileRoom = MAX_TILE_HEIGHT * u;
  const rowHeight = fixed + tileRoom;
  const blocks = stations.map((s): Block => {
    const { w, d } = FOOTPRINT[s.kind];
    const cell = { x: MARGIN + s.col * cellWidth, y: MARGIN + HEADROOM + s.row * rowHeight, width: cellWidth, height: rowHeight };
    const screenWidth = (w + d) * COS30 * u;
    const blockRoom = labelsBelow ? cellWidth - 2 * PAD : (cellWidth - 2 * PAD - 12) * 0.5;
    const left = cell.x + PAD + (blockRoom - screenWidth) / 2;
    const tileHeight = (w + d) * SIN30 * u;
    const back = { x: left + d * COS30 * u, y: cell.y + TOP_PAD + EXTRUSION_PX + (tileRoom - tileHeight) / 2 };
    const at = (a: number, b: number): Point => ({ x: back.x + (a - b) * COS30 * u, y: back.y + (a + b) * SIN30 * u });
    const label = labelsBelow
      ? { x: cell.x + PAD, y: cell.y + TOP_PAD + EXTRUSION_PX + tileRoom + 8, width: cellWidth - 2 * PAD }
      : { x: cell.x + PAD + blockRoom + 12, y: cell.y + TOP_PAD + EXTRUSION_PX - 34, width: cellWidth - 2 * PAD - blockRoom - 12 };
    return { id: s.id, cell, back, right: at(w, 0), front: at(w, d), left: at(0, d), at, footprint: { w, d }, u, label };
  });
  const shelves = stations.filter((s) => s.kind === "cooler_shelf");
  const coolerCells = blocks.filter((b) => shelves.some((s) => s.id === b.id)).map((b) => b.cell);
  const cooler = coolerCells.length
    ? {
        x: Math.min(...coolerCells.map((c) => c.x)) + 2,
        y: Math.min(...coolerCells.map((c) => c.y)) - 6,
        width: Math.max(...coolerCells.map((c) => c.x + c.width)) - Math.min(...coolerCells.map((c) => c.x)) - 4,
        height: rowHeight,
      }
    : null;
  const contentHeight = 2 * MARGIN + HEADROOM + rows * rowHeight;
  return { width, height: heightLimit === null ? contentHeight : Math.max(heightLimit, contentHeight), labelsBelow, blocks, cooler };
}

export function points(list: readonly Point[]): string {
  return list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function raise(p: Point, by: number): Point {
  return { x: p.x, y: p.y - by };
}

/** An isometric circle on the block's top plane, as a path. */
export function ring(block: Block, a: number, b: number, r: number): string {
  const steps = 20;
  const list: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    list.push(block.at(a + r * Math.cos(t), b + r * Math.sin(t)));
  }
  return `M${points(list).replace(/ /g, "L")}Z`;
}

/** Transform for a side face drawn as a unit square standing on the floor edge from `from` to `to`. */
export function faceTransform(from: Point, to: Point, lift: string, height: string): string {
  const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return `translate(${from.x.toFixed(2)}px, calc(${from.y.toFixed(2)}px - ${lift})) skewY(${angle.toFixed(3)}deg) scale(${(to.x - from.x).toFixed(2)}, calc(${height} * -1))`;
}
