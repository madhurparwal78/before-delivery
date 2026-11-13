import { roundToScale } from '../domain/round.js';
import type { Raster } from './image.js';
import { encodeRgbPng } from './png.js';

export const TILE_PIXELS = 256;
export const PIXELS_PER_METRE = 40;
export const RESIDUAL_LIMIT_METRES = 0.05;

export interface PointPair {
  readonly pixelX: number;
  readonly pixelY: number;
  readonly across: number;
  readonly down: number;
}

export type Homography = readonly number[];

function solve(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row]?.[column] ?? 0) > Math.abs(matrix[pivot]?.[column] ?? 0)) pivot = row;
    }
    const pivotRow = matrix[pivot];
    const currentRow = matrix[column];
    if (pivotRow === undefined || currentRow === undefined) return null;
    if (Math.abs(pivotRow[column] ?? 0) < 1e-12) return null;
    matrix[pivot] = currentRow;
    matrix[column] = pivotRow;
    const swapped = vector[pivot] as number;
    vector[pivot] = vector[column] as number;
    vector[column] = swapped;
    const lead = matrix[column] as number[];
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const target = matrix[row] as number[];
      const factor = (target[column] ?? 0) / (lead[column] as number);
      if (factor === 0) continue;
      for (let index = column; index < size; index += 1) {
        target[index] = (target[index] ?? 0) - factor * (lead[index] ?? 0);
      }
      vector[row] = (vector[row] as number) - factor * (vector[column] as number);
    }
  }
  return vector.map((value, index) => value / ((matrix[index] as number[])[index] as number));
}

export function triangleArea(a: PointPair, b: PointPair, c: PointPair, space: 'pixel' | 'wall'): number {
  const point = (pair: PointPair): readonly [number, number] =>
    space === 'pixel' ? [pair.pixelX, pair.pixelY] : [pair.across, pair.down];
  const [ax, ay] = point(a);
  const [bx, by] = point(b);
  const [cx, cy] = point(c);
  return Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
}

export function isDegenerate(points: readonly PointPair[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      for (let third = second + 1; third < points.length; third += 1) {
        const a = points[first] as PointPair;
        const b = points[second] as PointPair;
        const c = points[third] as PointPair;
        if (triangleArea(a, b, c, 'pixel') < 1 || triangleArea(a, b, c, 'wall') === 0) return true;
      }
    }
  }
  return false;
}

/** One homography mapping upright pixels to wall metres. */
export function fitHomography(points: readonly PointPair[]): Homography | null {
  const matrix: number[][] = [];
  const vector: number[] = [];
  for (const point of points) {
    matrix.push([point.pixelX, point.pixelY, 1, 0, 0, 0, -point.pixelX * point.across, -point.pixelY * point.across]);
    vector.push(point.across);
    matrix.push([0, 0, 0, point.pixelX, point.pixelY, 1, -point.pixelX * point.down, -point.pixelY * point.down]);
    vector.push(point.down);
  }
  const solved = solve(matrix, vector);
  if (solved === null || solved.some((value) => !Number.isFinite(value))) return null;
  return [...solved, 1];
}

export function project(homography: Homography, x: number, y: number): readonly [number, number] {
  const [a, b, c, d, e, f, g, h, i] = homography as readonly number[];
  const weight = (g as number) * x + (h as number) * y + (i as number);
  return [
    ((a as number) * x + (b as number) * y + (c as number)) / weight,
    ((d as number) * x + (e as number) * y + (f as number)) / weight,
  ];
}

export function invert(homography: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = homography.map((value) => value);
  const cofactors = [
    (e as number) * (i as number) - (f as number) * (h as number),
    (c as number) * (h as number) - (b as number) * (i as number),
    (b as number) * (f as number) - (c as number) * (e as number),
    (f as number) * (g as number) - (d as number) * (i as number),
    (a as number) * (i as number) - (c as number) * (g as number),
    (c as number) * (d as number) - (a as number) * (f as number),
    (d as number) * (h as number) - (e as number) * (g as number),
    (b as number) * (g as number) - (a as number) * (h as number),
    (a as number) * (e as number) - (b as number) * (d as number),
  ];
  const determinant = (a as number) * (cofactors[0] as number) + (b as number) * (cofactors[3] as number) + (c as number) * (cofactors[6] as number);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-15) return null;
  return cofactors.map((value) => value / determinant);
}

export function residualMetres(homography: Homography, check: PointPair): number {
  const [across, down] = project(homography, check.pixelX, check.pixelY);
  const gap = Math.hypot(across - check.across, down - check.down);
  return roundToScale(gap, 3);
}

export interface Tile {
  readonly key: string;
  readonly column: number;
  readonly row: number;
  readonly png: Buffer;
}

/** Rectified tiles at 40 pixels per metre, sampled through the inverse homography. */
export function renderTiles(
  raster: Raster,
  homography: Homography,
  widthMetres: number,
  heightMetres: number,
): Tile[] {
  const inverse = invert(homography);
  if (inverse === null) return [];
  const wallWidthPx = Math.ceil(widthMetres * PIXELS_PER_METRE);
  const wallHeightPx = Math.ceil(heightMetres * PIXELS_PER_METRE);
  const columns = Math.ceil(wallWidthPx / TILE_PIXELS);
  const rows = Math.ceil(wallHeightPx / TILE_PIXELS);
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const width = Math.min(TILE_PIXELS, wallWidthPx - column * TILE_PIXELS);
      const height = Math.min(TILE_PIXELS, wallHeightPx - row * TILE_PIXELS);
      const rgba = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const across = (column * TILE_PIXELS + x + 0.5) / PIXELS_PER_METRE;
          const down = (row * TILE_PIXELS + y + 0.5) / PIXELS_PER_METRE;
          const [sourceX, sourceY] = project(inverse, across, down);
          const target = (y * width + x) * 4;
          const px = Math.round(sourceX - 0.5);
          const py = Math.round(sourceY - 0.5);
          if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) {
            rgba[target + 3] = 255;
            continue;
          }
          const origin = (py * raster.width + px) * 4;
          rgba[target] = raster.rgba[origin] ?? 0;
          rgba[target + 1] = raster.rgba[origin + 1] ?? 0;
          rgba[target + 2] = raster.rgba[origin + 2] ?? 0;
          rgba[target + 3] = 255;
        }
      }
      tiles.push({ key: `${column}-${row}`, column, row, png: encodeRgbPng(width, height, rgba) });
    }
  }
  return tiles;
}
