// Stored solids: their canonical bytes, digests and the line-drawn thumbnail that goes with each.
import { createHash } from "node:crypto";
import { canonicalJson } from "../shared/canonical";
import { bboxText, fixed } from "../shared/numbers";
import { bodyHeight, measure, type Solid, type SolidOp } from "../shared/tine";

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

export function solidBytes(solid: Solid): Buffer {
  return Buffer.from(canonicalJson({ ops: solid.ops }));
}

export function digestOf(solid: Solid): string {
  return sha256(solidBytes(solid));
}

type Point = [number, number];

const WIDTH = 240;
const HEIGHT = 180;
const MARGIN = 14;
const LABEL_BAND = 28;
const ARC_STEPS = 32;

/** A three-quarter view from (1, -1, 1) with z up, as screen coordinates with y up. */
function project(x: number, y: number, z: number): Point {
  return [(x + y) / Math.SQRT2, (-x + y + 2 * z) / Math.sqrt(6)];
}

function circle(cx: number, cy: number, z: number, radius: number): Point[] {
  return Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
    const angle = (2 * Math.PI * i) / ARC_STEPS;
    return project(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z);
  });
}

function stadium(cx: number, cy: number, z: number, length: number, width: number): Point[] {
  const radius = width / 2;
  const points: Point[] = [];
  for (let i = 0; i <= ARC_STEPS / 2; i++) {
    const angle = -Math.PI / 2 + (Math.PI * i) / (ARC_STEPS / 2);
    points.push(project(cx + length / 2 + radius * Math.cos(angle), cy + radius * Math.sin(angle), z));
  }
  for (let i = 0; i <= ARC_STEPS / 2; i++) {
    const angle = Math.PI / 2 + (Math.PI * i) / (ARC_STEPS / 2);
    points.push(project(cx - length / 2 + radius * Math.cos(angle), cy + radius * Math.sin(angle), z));
  }
  points.push(points[0]);
  return points;
}

function box(w: number, d: number, h: number): Point[][] {
  const corner = (i: number): Point => project(i & 1 ? w / 2 : -w / 2, i & 2 ? d / 2 : -d / 2, i & 4 ? h : 0);
  const edges: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  return edges.map(([a, b]) => [corner(a), corner(b)]);
}

/** A column's two rims and the two lines that make its silhouette. */
function column(cx: number, cy: number, radius: number, from: number, to: number): Point[][] {
  const reach = radius / Math.SQRT2;
  return [
    circle(cx, cy, from, radius),
    circle(cx, cy, to, radius),
    [project(cx + reach, cy + reach, from), project(cx + reach, cy + reach, to)],
    [project(cx - reach, cy - reach, from), project(cx - reach, cy - reach, to)],
  ];
}

function strokes(op: SolidOp, height: number): Point[][] {
  switch (op.op) {
    case "box":
      return box(op.w, op.d, op.h);
    case "cylinder":
      return column(0, 0, op.dia / 2, 0, op.h);
    case "boss":
      return column(op.x, op.y, op.dia / 2, height, height + op.h);
    case "hole":
      return [circle(op.x, op.y, height, op.dia / 2), circle(op.x, op.y, 0, op.dia / 2)];
    case "slot":
      return [stadium(op.x, op.y, height, op.len, op.w)];
  }
}

/** A dark ground with cyan strokes and exactly one <text>: the bounding box. */
export function thumbnailSvg(solid: Solid): Buffer {
  const height = bodyHeight(solid);
  const lines = solid.ops.flatMap((op) => strokes(op, height));
  const xs = lines.flat().map((point) => point[0]);
  const ys = lines.flat().map((point) => point[1]);
  const [minX, maxX, maxY] = [Math.min(...xs), Math.max(...xs), Math.max(...ys)];
  const [drawWidth, drawHeight] = [maxX - minX, maxY - Math.min(...ys)];
  const room: Point = [WIDTH - 2 * MARGIN, HEIGHT - LABEL_BAND - 2 * MARGIN];
  const scale = Math.min(room[0] / Math.max(drawWidth, 1e-9), room[1] / Math.max(drawHeight, 1e-9));
  const left = (WIDTH - drawWidth * scale) / 2;
  const top = MARGIN + (room[1] - drawHeight * scale) / 2;
  const screen = ([x, y]: Point) => `${fixed(left + (x - minX) * scale, 1)} ${fixed(top + (maxY - y) * scale, 1)}`;
  const path = lines.map((line) => `M${line.map(screen).join("L")}`).join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">` +
      `<rect width="${WIDTH}" height="${HEIGHT}" fill="#0b1220"/>` +
      (path === "" ? "" : `<path d="${path}" fill="none" stroke="#22d3ee" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>`) +
      `<text x="${WIDTH / 2}" y="${HEIGHT - 10}" text-anchor="middle" fill="#8ea3bf" font-family="sans-serif" font-size="12">${bboxText(measure(solid).bbox)}</text>` +
      `</svg>`,
  );
}
