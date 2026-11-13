import earcut from 'earcut';
import { Solid, SolidOp } from './api';

export type MeshData = { positions: Float32Array; normals: Float32Array };

type Builder = { positions: number[]; normals: number[] };

const CIRCLE_STEPS = 40;

function triangle(
  into: Builder,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
  for (const point of [a, b, c]) {
    into.positions.push(point[0], point[1], point[2]);
    into.normals.push(nx, ny, nz);
  }
}

function quad(
  into: Builder,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): void {
  triangle(into, a, b, c);
  triangle(into, a, c, d);
}

function circleRing(cx: number, cy: number, radius: number): [number, number][] {
  const points: [number, number][] = [];
  for (let step = 0; step < CIRCLE_STEPS; step += 1) {
    const angle = (step / CIRCLE_STEPS) * Math.PI * 2;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function stadiumRing(x: number, y: number, len: number, width: number): [number, number][] {
  const radius = width / 2;
  const points: [number, number][] = [];
  const half = CIRCLE_STEPS / 2;
  for (let step = 0; step <= half; step += 1) {
    const angle = -Math.PI / 2 + (step / half) * Math.PI;
    points.push([x + len / 2 + radius * Math.cos(angle), y + radius * Math.sin(angle)]);
  }
  for (let step = 0; step <= half; step += 1) {
    const angle = Math.PI / 2 + (step / half) * Math.PI;
    points.push([x - len / 2 + radius * Math.cos(angle), y + radius * Math.sin(angle)]);
  }
  return points;
}

function ringOf(op: SolidOp): [number, number][] | null {
  switch (op.op) {
    case 'hole':
      return circleRing(op.x, op.y, op.dia / 2);
    case 'slot':
      return stadiumRing(op.x, op.y, op.len, op.w);
    case 'boss':
      return circleRing(op.x, op.y, op.dia / 2);
    default:
      return null;
  }
}

/** A face with holes, triangulated at height z, facing up or down. */
function face(
  into: Builder,
  outline: [number, number][],
  holes: [number, number][][],
  z: number,
  up: boolean,
): void {
  const flat: number[] = [];
  const holeIndices: number[] = [];
  for (const point of outline) flat.push(point[0], point[1]);
  for (const hole of holes) {
    holeIndices.push(flat.length / 2);
    for (const point of hole) flat.push(point[0], point[1]);
  }
  const indices = earcut(flat, holeIndices.length > 0 ? holeIndices : undefined, 2);
  for (let index = 0; index < indices.length; index += 3) {
    const points = [indices[index], indices[index + 1], indices[index + 2]].map(
      (vertex): [number, number, number] => [flat[vertex * 2], flat[vertex * 2 + 1], z],
    );
    if (up) triangle(into, points[0], points[1], points[2]);
    else triangle(into, points[0], points[2], points[1]);
  }
}

/** The wall of a ring extruded between two heights. */
function wall(into: Builder, ring: [number, number][], low: number, high: number, outward: boolean): void {
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const a: [number, number, number] = [current[0], current[1], low];
    const b: [number, number, number] = [next[0], next[1], low];
    const c: [number, number, number] = [next[0], next[1], high];
    const d: [number, number, number] = [current[0], current[1], high];
    if (outward) quad(into, a, b, c, d);
    else quad(into, b, a, d, c);
  }
}

function bodyOf(solid: Solid): SolidOp | undefined {
  return solid.ops.find((op) => op.op === 'box' || op.op === 'cylinder');
}

export function bodyHeight(solid: Solid): number {
  const body = bodyOf(solid);
  if (!body) return 0;
  return body.op === 'box' ? body.h : body.op === 'cylinder' ? body.h : 0;
}

/** The evaluated solid as triangles, with sharp edges and flat normals. */
export function solidMesh(solid: Solid): MeshData {
  const into: Builder = { positions: [], normals: [] };
  const body = bodyOf(solid);
  if (!body) return { positions: new Float32Array(), normals: new Float32Array() };
  const height = bodyHeight(solid);

  const outline: [number, number][] =
    body.op === 'box'
      ? [
          [-body.w / 2, -body.d / 2],
          [body.w / 2, -body.d / 2],
          [body.w / 2, body.d / 2],
          [-body.w / 2, body.d / 2],
        ]
      : circleRing(0, 0, body.op === 'cylinder' ? body.dia / 2 : 0);

  const cuts = solid.ops.filter((op) => op.op === 'hole' || op.op === 'slot');
  const holes = cuts.map((op) => ringOf(op)!).map((ring) => [...ring].reverse());

  face(into, outline, holes, height, true);
  face(into, outline, holes, 0, false);
  wall(into, outline, 0, height, true);
  for (const op of cuts) wall(into, ringOf(op)!, 0, height, false);

  for (const op of solid.ops) {
    if (op.op !== 'boss') continue;
    const ring = circleRing(op.x, op.y, op.dia / 2);
    wall(into, ring, height, height + op.h, true);
    face(into, ring, [], height + op.h, true);
  }

  return { positions: new Float32Array(into.positions), normals: new Float32Array(into.normals) };
}

/** The volume of one cut or join on its own, for the build tape's colours. */
export function opMesh(op: SolidOp, height: number): MeshData {
  const into: Builder = { positions: [], normals: [] };
  const ring = ringOf(op);
  if (ring) {
    const low = op.op === 'boss' ? height : 0;
    const high = op.op === 'boss' ? height + op.h : height;
    wall(into, ring, low, high, true);
    face(into, ring, [], high, true);
    face(into, ring, [], low, false);
  }
  return { positions: new Float32Array(into.positions), normals: new Float32Array(into.normals) };
}

function opKey(op: SolidOp): string {
  return JSON.stringify(op);
}

/** The operations one tape step added or removed, by comparing two stored solids. */
export function stepDifference(
  previous: Solid | null,
  current: Solid,
): { added: SolidOp[]; removed: SolidOp[] } {
  const before = new Set((previous?.ops ?? []).map(opKey));
  const after = new Set(current.ops.map(opKey));
  const added = current.ops.filter((op) => !before.has(opKey(op)));
  const removed = (previous?.ops ?? []).filter((op) => !after.has(opKey(op)));
  return {
    added: added.filter((op) => op.op === 'boss' || op.op === 'box' || op.op === 'cylinder'),
    removed: [...added.filter((op) => op.op === 'hole' || op.op === 'slot'), ...removed],
  };
}
