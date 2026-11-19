import { PHASE_FIELD } from '../../shared/palette.js';
import type { Part, Step } from '../../shared/types.js';
import type { PartRow } from '../domain/guides.js';

const WIDTH = 960;
const HEIGHT = 720;
const MARGIN = 48;

interface Point {
  x: number;
  y: number;
}

/** A part's offset is its apart distance along its axis, times the apart amount, times the model scale. */
function offsetOf(part: Part, explode: number, scale: number): [number, number, number] {
  const metres = (part.apart_mm / 1000) * explode * scale;
  return [
    part.axis === 'x' ? metres : 0,
    part.axis === 'y' ? metres : 0,
    part.axis === 'z' ? metres : 0,
  ];
}

function rotate(
  point: readonly [number, number, number],
  yaw: number,
  pitch: number,
): [number, number, number] {
  const ya = (yaw * Math.PI) / 180;
  const pa = (pitch * Math.PI) / 180;
  const x1 = point[0] * Math.cos(ya) + point[2] * Math.sin(ya);
  const z1 = -point[0] * Math.sin(ya) + point[2] * Math.cos(ya);
  const y2 = point[1] * Math.cos(pa) - z1 * Math.sin(pa);
  const z2 = point[1] * Math.sin(pa) + z1 * Math.cos(pa);
  return [x1, y2, z2];
}

function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (input: readonly Point[]): Point[] => {
    const stack: Point[] = [];
    for (const point of input) {
      while (stack.length >= 2) {
        const a = stack[stack.length - 2];
        const b = stack[stack.length - 1];
        if (a && b && cross(a, b, point) <= 0) stack.pop();
        else break;
      }
      stack.push(point);
    }
    return stack;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function toHex(colour: readonly number[]): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(colour[0] ?? 0.6)}${channel(colour[1] ?? 0.6)}${channel(colour[2] ?? 0.6)}`;
}

/**
 * The still the server draws for a step at its saved pose and apart amount:
 * non-focus parts are flat silhouettes in the field's text colour and focus
 * parts keep their own materials with an opposing outline.
 */
export function renderStill(
  step: Step,
  parts: readonly Part[],
  rows: readonly PartRow[],
  scale: number,
  title: string,
): string {
  const field = PHASE_FIELD[step.phase];
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const focus = new Set(step.focus_parts);

  interface Drawn {
    hull: Point[];
    depth: number;
    colour: string;
    isFocus: boolean;
  }

  const drawn: Drawn[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const part of parts) {
    const row = rowById.get(part.id);
    if (!row) continue;
    const offset = offsetOf(part, step.explode, scale);
    const projected: Point[] = [];
    let depth = 0;
    for (let corner = 0; corner < 8; corner += 1) {
      const source: [number, number, number] = [
        ((corner & 1) === 0 ? row.bbox_min[0] ?? 0 : row.bbox_max[0] ?? 0) + offset[0],
        ((corner & 2) === 0 ? row.bbox_min[1] ?? 0 : row.bbox_max[1] ?? 0) + offset[1],
        ((corner & 4) === 0 ? row.bbox_min[2] ?? 0 : row.bbox_max[2] ?? 0) + offset[2],
      ];
      const [x, y, z] = rotate(source, step.camera.yaw, step.camera.pitch);
      projected.push({ x, y: -y });
      depth += z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (-y < minY) minY = -y;
      if (-y > maxY) maxY = -y;
    }
    drawn.push({
      hull: convexHull(projected),
      depth: depth / 8,
      colour: focus.has(part.id) ? toHex(row.colour) : field.text,
      isFocus: focus.has(part.id),
    });
  }

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const zoom = Math.min((WIDTH - MARGIN * 2) / spanX, (HEIGHT - MARGIN * 2) / spanY) / step.camera.zoom;
  const toScreen = (point: Point): string =>
    `${((point.x - (minX + maxX) / 2) * zoom + WIDTH / 2).toFixed(1)},${(
      (point.y - (minY + maxY) / 2) * zoom +
      HEIGHT / 2
    ).toFixed(1)}`;

  const shapes = drawn
    .sort((a, b) => a.depth - b.depth)
    .map((shape) => {
      const points = shape.hull.map(toScreen).join(' ');
      const outline = shape.isFocus
        ? ` stroke="${field.text}" stroke-width="4"`
        : ` stroke="${field.field}" stroke-width="1"`;
      return `<polygon points="${points}" fill="${shape.colour}"${outline}/>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img"><title>${escapeXml(
    `${title}, step ${step.number} still`,
  )}</title><rect width="${WIDTH}" height="${HEIGHT}" fill="${field.field}"/>${shapes}</svg>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
