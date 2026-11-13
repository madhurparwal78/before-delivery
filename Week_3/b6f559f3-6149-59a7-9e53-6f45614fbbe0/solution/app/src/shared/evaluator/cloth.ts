import { FRAMES_PER_SECOND } from '../format';
import { mulberry32 } from './particles';

export type Pinned = 'Top' | 'Left' | 'Corners' | 'None';

export interface ClothParams {
  columns: number;
  rows: number;
  pinned: Pinned;
  gravity: number;
  windStrength: number;
  windDirection: number;
  stiffness: number;
  damping: number;
  iterations: number;
  seed: number;
}

interface ClothPoint {
  name: string;
  row: number;
  column: number;
  pinned: boolean;
  x: number;
  y: number;
  z: number;
  previous: [number, number, number];
}

const REST_LENGTH = 0.1;
const DT = 1 / FRAMES_PER_SECOND;

interface Simulation {
  frame: number;
  points: ClothPoint[];
}

const cache = new Map<string, Simulation>();

const clothPointName = (row: number, column: number): string => `R${row} C${column}`;

function isPinned(pinned: Pinned, row: number, column: number, columns: number): boolean {
  switch (pinned) {
    case 'Top':
      return row === 1;
    case 'Left':
      return column === 1;
    case 'Corners':
      return row === 1 && (column === 1 || column === columns);
    case 'None':
      return false;
  }
}

function restPoints(params: ClothParams): ClothPoint[] {
  const random = mulberry32(params.seed);
  const points: ClothPoint[] = [];
  for (let row = 1; row <= params.rows; row++) {
    for (let column = 1; column <= params.columns; column++) {
      const x = (column - 1 - (params.columns - 1) / 2) * REST_LENGTH;
      const y = -(row - 1) * REST_LENGTH;
      const z = (random() - 0.5) * 0.002;
      points.push({
        name: clothPointName(row, column),
        row,
        column,
        pinned: isPinned(params.pinned, row, column, params.columns),
        x,
        y,
        z,
        previous: [x, y, z],
      });
    }
  }
  return points;
}

function solve(first: ClothPoint, second: ClothPoint, stiffness: number): void {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const dz = second.z - first.z;
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) return;
  const diff = ((length - REST_LENGTH) / length) * stiffness;
  if (!first.pinned && !second.pinned) {
    first.x += (dx * diff) / 2;
    first.y += (dy * diff) / 2;
    first.z += (dz * diff) / 2;
    second.x -= (dx * diff) / 2;
    second.y -= (dy * diff) / 2;
    second.z -= (dz * diff) / 2;
  } else if (!first.pinned) {
    first.x += dx * diff;
    first.y += dy * diff;
    first.z += dz * diff;
  } else if (!second.pinned) {
    second.x -= dx * diff;
    second.y -= dy * diff;
    second.z -= dz * diff;
  }
}

function step(points: ClothPoint[], params: ClothParams): void {
  const angle = (params.windDirection * Math.PI) / 180;
  const ax = params.windStrength * Math.cos(angle);
  const ay = -params.gravity;
  const az = params.windStrength * Math.sin(angle);
  for (const point of points) {
    if (point.pinned) continue;
    const vx = (point.x - point.previous[0]) * (1 - params.damping);
    const vy = (point.y - point.previous[1]) * (1 - params.damping);
    const vz = (point.z - point.previous[2]) * (1 - params.damping);
    point.previous = [point.x, point.y, point.z];
    point.x += vx + ax * DT * DT;
    point.y += vy + ay * DT * DT;
    point.z += vz + az * DT * DT;
  }
  const at = (row: number, column: number): ClothPoint => points[(row - 1) * params.columns + (column - 1)] as ClothPoint;
  for (let i = 0; i < params.iterations; i++) {
    for (let row = 1; row <= params.rows; row++) {
      for (let column = 1; column <= params.columns; column++) {
        const point = at(row, column);
        if (column < params.columns) solve(point, at(row, column + 1), params.stiffness);
        if (row < params.rows) solve(point, at(row + 1, column), params.stiffness);
      }
    }
  }
}

/** Cloth points at `frame`, simulated one fixed step per frame from the seeded rest state. */
export function clothAt(params: ClothParams, frame: number): ClothPoint[] {
  const key = JSON.stringify(params);
  let sim = cache.get(key);
  if (!sim || sim.frame > frame) {
    sim = { frame: 0, points: restPoints(params) };
    if (cache.size > 24) cache.clear();
    cache.set(key, sim);
  }
  while (sim.frame < frame) {
    sim.frame += 1;
    step(sim.points, params);
  }
  return sim.points;
}
