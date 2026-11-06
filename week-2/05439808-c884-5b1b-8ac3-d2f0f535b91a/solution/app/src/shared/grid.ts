// Footprints and the placement geometry of the 40 × 40 island grid.
import { BUILD_AREA_MAX, BUILD_AREA_MIN, BUILDINGS, GRID_SIZE, type BuildingType, type Rotation } from './catalog';

interface Footprint {
  x: number;
  y: number;
  width: number;
  depth: number;
}

interface Placed {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
}

/** The footprint of a building at its minimum corner; a quarter turn swaps width and depth. */
export function footprint(type: BuildingType, x: number, y: number, rotation: Rotation): Footprint {
  const spec = BUILDINGS[type];
  const quarter = rotation === 90 || rotation === 270;
  return { x, y, width: quarter ? spec.depth : spec.width, depth: quarter ? spec.width : spec.depth };
}

export function insideBuildArea(f: Footprint): boolean {
  return f.x >= BUILD_AREA_MIN && f.y >= BUILD_AREA_MIN
    && f.x + f.width - 1 <= BUILD_AREA_MAX && f.y + f.depth - 1 <= BUILD_AREA_MAX;
}

function overlaps(a: Footprint, b: Footprint): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.depth && b.y < a.y + a.depth;
}

/** The building, if any, whose footprint covers a cell. */
export function buildingAt<T extends Placed>(buildings: readonly T[], x: number, y: number): T | undefined {
  return buildings.find((b) => {
    const f = footprint(b.type, b.x, b.y, b.rotation);
    return x >= f.x && x < f.x + f.width && y >= f.y && y < f.y + f.depth;
  });
}

/** True when the footprint overlaps any building other than the one being moved. */
export function occupied(buildings: readonly Placed[], f: Footprint, movingId: number | null): boolean {
  return buildings.some((b) => b.id !== movingId && overlaps(f, footprint(b.type, b.x, b.y, b.rotation)));
}

/** The outer two-cell tidal deploy ring. */
export function onTidalRing(x: number, y: number): boolean {
  const inGrid = x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE;
  return inGrid && (x < BUILD_AREA_MIN || y < BUILD_AREA_MIN || x > BUILD_AREA_MAX || y > BUILD_AREA_MAX);
}
