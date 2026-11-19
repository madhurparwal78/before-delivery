import { LAYOUTS, type Layout, type LayoutId } from "../shared/model";
import { s } from "./dom";

// Track outlines drawn from each layout's published segments. Straights keep their length and
// heading; every corner turns left, and the corner angles (summing to one full turn) are the ones
// that close the loop best. The small remaining gap is spread along the lap.

interface TrackPoint {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

export interface TrackPath {
  readonly layout: Layout;
  readonly points: readonly TrackPoint[];
  readonly turns: readonly number[];
}

interface Segment {
  readonly start: number;
  readonly length: number;
  readonly corner: number | null;
}

function segments(layout: Layout): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  layout.corners.forEach((corner, index) => {
    if (corner.start > at) out.push({ start: at, length: corner.start - at, corner: null });
    out.push({ start: corner.start, length: corner.end - corner.start, corner: index });
    at = corner.end;
  });
  if (at < layout.length) out.push({ start: at, length: layout.length - at, corner: null });
  return out;
}

function endPoint(parts: readonly Segment[], turns: readonly number[]): [number, number] {
  let x = 0;
  let y = 0;
  let heading = 0;
  for (const part of parts) {
    if (part.corner === null) {
      x += part.length * Math.cos(heading);
      y += part.length * Math.sin(heading);
    } else {
      const turn = turns[part.corner];
      const radius = part.length / turn;
      x += radius * (Math.sin(heading + turn) - Math.sin(heading));
      y += radius * (Math.cos(heading) - Math.cos(heading + turn));
      heading += turn;
    }
  }
  return [x, y];
}

function closingTurns(parts: readonly Segment[], corners: number): number[] {
  const degree = Math.PI / 180;
  let best = { gap: Number.POSITIVE_INFINITY, turns: [] as number[] };
  const search = (prefix: number[], left: number) => {
    if (prefix.length === corners - 1) {
      if (left < 5) return;
      const turns = [...prefix, left].map((d) => d * degree);
      const [x, y] = endPoint(parts, turns);
      const gap = Math.hypot(x, y);
      if (gap < best.gap) best = { gap, turns };
      return;
    }
    for (let d = 5; d <= left - 5 * (corners - prefix.length - 1); d += 1) search([...prefix, d], left - d);
  };
  search([], 360);
  return best.turns;
}

function buildPath(layout: Layout): TrackPath {
  const parts = segments(layout);
  const turns = closingTurns(parts, layout.corners.length);
  const [gapX, gapY] = endPoint(parts, turns);
  const points: TrackPoint[] = [];
  let x = 0;
  let y = 0;
  let heading = 0;
  for (const part of parts) {
    const turnPerMetre = part.corner === null ? 0 : turns[part.corner] / part.length;
    for (let m = 0; m < part.length; m += 1) {
      const along = (part.start + m) / layout.length;
      points.push({ x: x - gapX * along, y: y - gapY * along, heading });
      if (turnPerMetre === 0) {
        x += Math.cos(heading);
        y += Math.sin(heading);
      } else {
        const radius = 1 / turnPerMetre;
        x += radius * (Math.sin(heading + turnPerMetre) - Math.sin(heading));
        y += radius * (Math.cos(heading) - Math.cos(heading + turnPerMetre));
        heading += turnPerMetre;
      }
    }
  }
  points.push({ ...points[0], heading: points[0].heading + 2 * Math.PI });
  return { layout, points, turns };
}

const PATHS = new Map<LayoutId, TrackPath>();

export function trackPath(layoutId: LayoutId): TrackPath {
  let path = PATHS.get(layoutId);
  if (!path) {
    path = buildPath(LAYOUTS[layoutId]);
    PATHS.set(layoutId, path);
  }
  return path;
}

// The point at a lap distance, with an optional sideways offset (positive is to the left).
export function pointAt(path: TrackPath, distance: number, offset = 0): TrackPoint {
  const length = path.layout.length;
  const d = ((distance % length) + length) % length;
  const i = Math.floor(d);
  const t = d - i;
  const a = path.points[i];
  const b = path.points[i + 1];
  const heading = a.heading + (b.heading - a.heading) * t;
  return {
    x: a.x + (b.x - a.x) * t - Math.sin(heading) * offset,
    y: a.y + (b.y - a.y) * t + Math.cos(heading) * offset,
    heading,
  };
}

export function bounds(path: TrackPath): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = path.points.map((p) => p.x);
  const ys = path.points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// SVG "d" for the stretch of the outline from one lap distance to another (y flipped for SVG).
export function pathData(path: TrackPath, from = 0, to = path.layout.length): string {
  const out: string[] = [];
  for (let d = from; d < to; d += 4) {
    const p = path.points[Math.floor(d)];
    out.push(`${out.length ? "L" : "M"}${p.x.toFixed(1)} ${(-p.y).toFixed(1)}`);
  }
  const end = pointAt(path, Math.min(to, path.layout.length - 0.001));
  out.push(`L${end.x.toFixed(1)} ${(-end.y).toFixed(1)}`);
  return out.join("");
}

export function viewBox(path: TrackPath, pad = 24): string {
  const b = bounds(path);
  return `${(b.minX - pad).toFixed(0)} ${(-b.maxY - pad).toFixed(0)} ${(b.maxX - b.minX + 2 * pad).toFixed(0)} ${(b.maxY - b.minY + 2 * pad).toFixed(0)}`;
}

// A plain outline with a start line, for map cards.
export function outline(layoutId: LayoutId, label: string): SVGSVGElement {
  const path = trackPath(layoutId);
  const start = pointAt(path, 0);
  const tick = 22;
  return s("svg", { class: "outline", viewBox: viewBox(path), role: "img", "aria-label": `${label} track outline` },
    s("path", { d: pathData(path), class: "outline-line" }),
    s("line", {
      class: "outline-start",
      x1: start.x - Math.sin(start.heading) * tick, y1: -(start.y + Math.cos(start.heading) * tick),
      x2: start.x + Math.sin(start.heading) * tick, y2: -(start.y - Math.cos(start.heading) * tick),
    }));
}

// A tulip-diagram glyph for one corner: an entry stem with a dot, and the exit turned by the
// corner's angle ending in an arrowhead, as in a rally route book.
export function tulip(turn: number): SVGSVGElement {
  const exit = -Math.PI / 2 - turn;
  const cx = 14;
  const cy = 15;
  const ex = cx + Math.cos(exit) * 10;
  const ey = cy + Math.sin(exit) * 10;
  const head = (angle: number) => `${ex + Math.cos(angle) * 4.5},${ey + Math.sin(angle) * 4.5}`;
  return s("svg", { class: "tulip", viewBox: "0 0 28 28", "aria-hidden": "true", focusable: "false" },
    s("circle", { cx, cy: 25, r: 2 }),
    s("line", { x1: cx, y1: 25, x2: cx, y2: cy }),
    s("line", { x1: cx, y1: cy, x2: cx, y2: 3, class: "tulip-ghost" }),
    s("line", { x1: cx, y1: cy, x2: ex, y2: ey }),
    s("polyline", { points: `${head(exit + Math.PI - 0.5)} ${ex},${ey} ${head(exit + Math.PI + 0.5)}`, class: "tulip-arrow" }));
}
