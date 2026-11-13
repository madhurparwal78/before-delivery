import { mulberry32 } from './particles';
import { vec } from './math3d';
import type { Vec3 } from './types';

export interface ClothSettings {
  columns: number;
  rows: number;
  pinned: string;
  gravity: number;
  windStrength: number;
  windDirection: number;
  stiffness: number;
  damping: number;
  iterations: number;
  seed: number;
}

export interface ClothPoint {
  name: string;
  row: number;
  column: number;
  position: Vec3;
  previous: Vec3;
  pinned: boolean;
}

const REST_LENGTH = 0.1;
const DT = 1 / 60;

export function clothPointName(row: number, column: number): string {
  return `R${row} C${column}`;
}

function isPinned(mode: string, row: number, column: number, columns: number): boolean {
  if (mode === 'Top') return row === 1;
  if (mode === 'Left') return column === 1;
  if (mode === 'Corners') return row === 1 && (column === 1 || column === columns);
  return false;
}

export function simulateCloth(settings: ClothSettings, frame: number): ClothPoint[] {
  const columns = Math.round(settings.columns);
  const rows = Math.round(settings.rows);
  const random = mulberry32(settings.seed);
  const points: ClothPoint[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const u = random();
      const rest = vec(
        (column - 1 - (columns - 1) / 2) * REST_LENGTH,
        -(row - 1) * REST_LENGTH,
        (u - 0.5) * 0.002,
      );
      points.push({
        name: clothPointName(row, column),
        row,
        column,
        position: rest,
        previous: rest,
        pinned: isPinned(settings.pinned, row, column, columns),
      });
    }
  }
  const at = (row: number, column: number): ClothPoint => points[(row - 1) * columns + (column - 1)];
  const phi = (settings.windDirection * Math.PI) / 180;
  const acceleration = vec(
    settings.windStrength * Math.cos(phi),
    -settings.gravity,
    settings.windStrength * Math.sin(phi),
  );
  const iterations = Math.round(settings.iterations);

  for (let step = 1; step <= frame; step += 1) {
    for (const point of points) {
      if (point.pinned) continue;
      const vx = (point.position.x - point.previous.x) * (1 - settings.damping);
      const vy = (point.position.y - point.previous.y) * (1 - settings.damping);
      const vz = (point.position.z - point.previous.z) * (1 - settings.damping);
      point.previous = point.position;
      point.position = vec(
        point.position.x + vx + acceleration.x * DT * DT,
        point.position.y + vy + acceleration.y * DT * DT,
        point.position.z + vz + acceleration.z * DT * DT,
      );
    }
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (const point of points) {
        if (point.column < columns) solveConstraint(point, at(point.row, point.column + 1), settings.stiffness);
        if (point.row < rows) solveConstraint(point, at(point.row + 1, point.column), settings.stiffness);
      }
    }
  }
  return points;
}

function solveConstraint(a: ClothPoint, b: ClothPoint, stiffness: number): void {
  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const dz = b.position.z - a.position.z;
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) return;
  const diff = ((length - REST_LENGTH) / length) * stiffness;
  if (!a.pinned && !b.pinned) {
    a.position = vec(
      a.position.x + (dx * diff) / 2,
      a.position.y + (dy * diff) / 2,
      a.position.z + (dz * diff) / 2,
    );
    b.position = vec(
      b.position.x - (dx * diff) / 2,
      b.position.y - (dy * diff) / 2,
      b.position.z - (dz * diff) / 2,
    );
  } else if (a.pinned && !b.pinned) {
    b.position = vec(b.position.x - dx * diff, b.position.y - dy * diff, b.position.z - dz * diff);
  } else if (!a.pinned && b.pinned) {
    a.position = vec(a.position.x + dx * diff, a.position.y + dy * diff, a.position.z + dz * diff);
  }
}

export function clothPointNames(columns: number, rows: number): string[] {
  const names: string[] = [];
  for (let row = 1; row <= Math.round(rows); row += 1) {
    for (let column = 1; column <= Math.round(columns); column += 1) {
      names.push(clothPointName(row, column));
    }
  }
  return names;
}
