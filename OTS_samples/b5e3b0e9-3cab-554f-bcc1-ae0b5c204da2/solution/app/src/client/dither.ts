import type { Layout, LayoutNode } from "../shared/layout.ts";

const CELL = 10;
const COLUMNS = 100;
const ROWS = 50;
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

type Point = readonly [number, number];

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

interface DitherFields {
  grass: string;
  apron: string;
}

const cache = new WeakMap<Layout, DitherFields>();

/**
 * Grass and apron as ordered-dither pixel fields: each cell is drawn when its intensity beats the Bayer threshold, and the
 * intensity falls off with the distance from the pavement, so the field dissolves into the ground colour.
 */
export function ditherFields(layout: Layout): DitherFields {
  const cached = cache.get(layout);
  if (cached) return cached;
  const nodes = new Map<string, LayoutNode>(layout.nodes.map((n) => [n.id, n]));
  const at = (id: string): Point => {
    const node = nodes.get(id);
    return node ? [node.x, node.y] : [0, 0];
  };
  const pavement: [Point, Point][] = layout.segments.map((s) => [at(s.from), at(s.to)]);
  for (const runway of layout.runways) {
    const [a, b] = runway.thresholds;
    if (a && b) pavement.push([at(a.node), at(b.node)]);
  }
  const stands = layout.nodes.filter((n) => n.kind === "stand").map((n): Point => [n.x, n.y]);
  let grass = "";
  let apron = "";
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const p: Point = [column * CELL + CELL / 2, row * CELL + CELL / 2];
      const threshold = ((BAYER[row % 4]?.[column % 4] ?? 0) + 0.5) / 16;
      const road = Math.min(...pavement.map(([a, b]) => distanceToSegment(p, a, b)));
      if (road > 12 && 1 - road / 150 > threshold) grass += `M${column * CELL} ${row * CELL}h8v8h-8z`;
      const stand = Math.min(...stands.map((s) => Math.hypot(p[0] - s[0], p[1] - s[1])));
      if (road > 6 && 1.15 - stand / 85 > threshold) apron += `M${column * CELL} ${row * CELL}h8v8h-8z`;
    }
  }
  const fields = { grass, apron };
  cache.set(layout, fields);
  return fields;
}
