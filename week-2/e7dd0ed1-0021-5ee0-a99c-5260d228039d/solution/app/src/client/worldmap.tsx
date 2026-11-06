// The flat dot-grid world (brief: Visual design, Composition): muted dots over land from the 3° mask,
// equirectangular, one SVG unit per degree. Used by the marketing strip and the inspector's replica map.
import type { JSX } from "preact";
import { MASK_NORTH, MASK_STEP_DEGREES, MASK_WEST, WORLD_MASK } from "../shared/worldMask";

export interface Frame {
  west: number;
  east: number;
  north: number;
  south: number;
}

export const WORLD: Frame = {
  west: MASK_WEST,
  east: MASK_WEST + 360,
  north: MASK_NORTH,
  south: MASK_NORTH - WORLD_MASK.length * MASK_STEP_DEGREES,
};

export function project(frame: Frame, lon: number, lat: number): { x: number; y: number } {
  return { x: lon - frame.west, y: frame.north - lat };
}

export function viewBox(frame: Frame): string {
  return `0 0 ${frame.east - frame.west} ${frame.north - frame.south}`;
}

// A grid of `cells` × `cells` mask cells becomes one dot, drawn when any of its cells is land: the
// marketing strip draws every 3° cell, the narrow inspector map one dot per 6°.
export interface DotGrid {
  cells: number;
  radius: number;
}

export const FINE_DOTS: DotGrid = { cells: 1, radius: 0.62 };
const dotPaths = new Map<string, string>();

// All land dots of a frame as one path of tiny circles: thousands of dots, one element.
function landPath(frame: Frame, grid: DotGrid): string {
  const cacheKey = `${viewBox(frame)} ${frame.west} ${frame.north} ${grid.cells} ${grid.radius}`;
  const cached = dotPaths.get(cacheKey);
  if (cached) return cached;
  const step = MASK_STEP_DEGREES * grid.cells;
  const r = grid.radius;
  const parts: string[] = [];
  for (let rowIndex = 0; rowIndex < WORLD_MASK.length; rowIndex += grid.cells) {
    const lat = MASK_NORTH - rowIndex * MASK_STEP_DEGREES - step / 2;
    if (lat > frame.north || lat < frame.south) continue;
    const rows = WORLD_MASK.slice(rowIndex, rowIndex + grid.cells);
    for (let col = 0; col < (rows[0]?.length ?? 0); col += grid.cells) {
      if (!rows.some((row) => row.slice(col, col + grid.cells).includes("#"))) continue;
      const lon = MASK_WEST + col * MASK_STEP_DEGREES + step / 2;
      if (lon < frame.west || lon > frame.east) continue;
      const { x, y } = project(frame, lon, lat);
      parts.push(`M${(x - r).toFixed(2)} ${y.toFixed(2)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`);
    }
  }
  const path = parts.join("");
  dotPaths.set(cacheKey, path);
  return path;
}

export function LandDots({ frame, grid, class: className = "land" }: { frame: Frame; grid: DotGrid; class?: string }): JSX.Element {
  return <path class={className} d={landPath(frame, grid)} />;
}
