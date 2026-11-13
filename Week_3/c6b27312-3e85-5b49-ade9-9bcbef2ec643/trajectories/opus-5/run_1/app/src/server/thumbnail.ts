import { bboxText } from '../shared/numbers';
import { Solid, SolidOp, measure } from '../tine/solid';

type Point = [number, number];

/** A three-quarter view: x to the right and back, y to the left and back, z up. */
function project(x: number, y: number, z: number): Point {
  const cos = Math.cos(Math.PI / 6);
  const sin = Math.sin(Math.PI / 6);
  return [(x - y) * cos, (x + y) * sin - z];
}

function circlePoints(cx: number, cy: number, z: number, radius: number): Point[] {
  const points: Point[] = [];
  for (let step = 0; step < 32; step += 1) {
    const angle = (step / 32) * Math.PI * 2;
    points.push(project(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z));
  }
  return points;
}

function stadiumPoints(op: { x: number; y: number; w: number; len: number }, z: number): Point[] {
  const radius = op.w / 2;
  const points: Point[] = [];
  for (let step = 0; step <= 16; step += 1) {
    const angle = -Math.PI / 2 + (step / 16) * Math.PI;
    points.push(
      project(op.x + op.len / 2 + radius * Math.cos(angle), op.y + radius * Math.sin(angle), z),
    );
  }
  for (let step = 0; step <= 16; step += 1) {
    const angle = Math.PI / 2 + (step / 16) * Math.PI;
    points.push(
      project(op.x - op.len / 2 + radius * Math.cos(angle), op.y + radius * Math.sin(angle), z),
    );
  }
  return points;
}

type Shape = { points: Point[]; closed: boolean };

function shapesOf(solid: Solid): Shape[] {
  const shapes: Shape[] = [];
  const body = solid.ops.find((op) => op.op === 'box' || op.op === 'cylinder');
  if (!body) return shapes;
  const height = body.op === 'box' ? body.h : body.op === 'cylinder' ? body.h : 0;

  if (body.op === 'box') {
    const halfWidth = body.w / 2;
    const halfDepth = body.d / 2;
    const corners: [number, number][] = [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth],
    ];
    shapes.push({ points: corners.map(([x, y]) => project(x, y, height)), closed: true });
    shapes.push({ points: corners.map(([x, y]) => project(x, y, 0)), closed: true });
    for (const [x, y] of corners) {
      shapes.push({ points: [project(x, y, 0), project(x, y, height)], closed: false });
    }
  } else if (body.op === 'cylinder') {
    shapes.push({ points: circlePoints(0, 0, height, body.dia / 2), closed: true });
    shapes.push({ points: circlePoints(0, 0, 0, body.dia / 2), closed: true });
    shapes.push({
      points: [project(-body.dia / 2, 0, 0), project(-body.dia / 2, 0, height)],
      closed: false,
    });
    shapes.push({
      points: [project(body.dia / 2, 0, 0), project(body.dia / 2, 0, height)],
      closed: false,
    });
  }

  for (const op of solid.ops as SolidOp[]) {
    if (op.op === 'hole') {
      shapes.push({ points: circlePoints(op.x, op.y, height, op.dia / 2), closed: true });
    } else if (op.op === 'slot') {
      shapes.push({ points: stadiumPoints(op, height), closed: true });
    } else if (op.op === 'boss') {
      shapes.push({ points: circlePoints(op.x, op.y, height, op.dia / 2), closed: true });
      shapes.push({ points: circlePoints(op.x, op.y, height + op.h, op.dia / 2), closed: true });
      shapes.push({
        points: [project(op.x - op.dia / 2, op.y, height), project(op.x - op.dia / 2, op.y, height + op.h)],
        closed: false,
      });
      shapes.push({
        points: [project(op.x + op.dia / 2, op.y, height), project(op.x + op.dia / 2, op.y, height + op.h)],
        closed: false,
      });
    }
  }
  return shapes;
}

/** The stored thumbnail of a solid: a line drawing plus one text element of its box. */
export function thumbnailSvg(solid: Solid): string {
  const shapes = shapesOf(solid);
  const measures = measure(solid);
  const width = 320;
  const height = 240;
  const flat = shapes.flatMap((shape) => shape.points);
  const label = bboxText(measures.bbox);

  let body = '';
  if (flat.length > 0) {
    const xs = flat.map((point) => point[0]);
    const ys = flat.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, 1e-6);
    const rise = Math.max(maxY - minY, 1e-6);
    const scale = Math.min((width - 48) / span, (height - 72) / rise);
    const offsetX = (width - span * scale) / 2 - minX * scale;
    const offsetY = (height - 24 - rise * scale) / 2 - minY * scale;
    const place = (point: Point): string =>
      `${(point[0] * scale + offsetX).toFixed(2)} ${(point[1] * scale + offsetY).toFixed(2)}`;
    body = shapes
      .map((shape) => {
        const path = shape.points.map((point, index) => `${index === 0 ? 'M' : 'L'}${place(point)}`).join(' ');
        return `<path d="${path}${shape.closed ? ' Z' : ''}" fill="none" stroke="#7fe9ff" stroke-width="1.2" stroke-linejoin="round"/>`;
      })
      .join('');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"><rect width="${width}" height="${height}" fill="#070b12"/>${body}<text x="16" y="${
    height - 14
  }" fill="#9fb2c8" font-family="sans-serif" font-size="13">${label}</text></svg>`;
}
