import {
  AREA_NAME_MESSAGE,
  AREA_RESERVED_MESSAGE,
  overlapMessage,
  rectangleMessage,
} from './messages.js';
import {
  areaNamesEverywhere,
  cellsToRect,
  rectCells,
  rectsOverlap,
  sortAreas,
  type ScopeGrid,
} from './grid.js';
import type { Area, LayoutState, Rect } from './types.js';

const AREA_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const RESERVED_NAME = 'layout';

export function checkAreaName(name: string): string | null {
  if (!AREA_NAME.test(name)) return AREA_NAME_MESSAGE;
  if (name === RESERVED_NAME) return AREA_RESERVED_MESSAGE;
  return null;
}

export type SetAreaOutcome =
  | { kind: 'rename'; previousName: string; areas: Area[] }
  | { kind: 'extend'; areas: Area[] }
  | { kind: 'create'; areas: Area[] }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

function sameRect(a: Rect, b: Rect): boolean {
  return (
    a.row_start === b.row_start &&
    a.row_end === b.row_end &&
    a.column_start === b.column_start &&
    a.column_end === b.column_end
  );
}

/**
 * The single decision behind saving an area name over a selection, in the published order:
 * name rule, rename, overlap, extend, create.
 */
export function decideSetArea(
  state: LayoutState,
  grid: ScopeGrid,
  name: string,
  selection: Rect,
): SetAreaOutcome {
  const nameProblem = checkAreaName(name);
  if (nameProblem) return { kind: 'error', message: nameProblem };

  const areas = sortAreas(grid.areas);
  const usedNames = areaNamesEverywhere(state);
  const exactly = areas.find((area) => sameRect(area, selection));

  if (exactly && !usedNames.has(name)) {
    return { kind: 'rename', previousName: exactly.name, areas };
  }

  const overlapped = areas.find((area) => area.name !== name && rectsOverlap(area, selection));
  if (overlapped) return { kind: 'error', message: overlapMessage(name, overlapped.name) };

  const placed = areas.find((area) => area.name === name);
  if (placed) {
    if (sameRect(placed, selection)) return { kind: 'none' };
    const union = new Set<string>([...rectCells(placed), ...rectCells(selection)]);
    const rect = cellsToRect(union);
    if (!rect) return { kind: 'error', message: rectangleMessage(name) };
    const next = areas.map((area) => (area.name === name ? { name, ...rect } : area));
    return { kind: 'extend', areas: sortAreas(next) };
  }

  return { kind: 'create', areas: sortAreas([...areas, { name, ...selection }]) };
}

export type ClearOutcome =
  | { kind: 'cleared'; areas: Area[]; removedAreas: string[] }
  | { kind: 'error'; message: string };

/** Clearing empties the cells and removes any area left with no cells. */
export function decideClearCells(grid: ScopeGrid, selection: Rect): ClearOutcome {
  const cleared = new Set(rectCells(selection));
  const kept: Area[] = [];
  const removedAreas: string[] = [];
  for (const area of sortAreas(grid.areas)) {
    const remaining = new Set(rectCells(area).filter((cell) => !cleared.has(cell)));
    if (remaining.size === 0) {
      removedAreas.push(area.name);
      continue;
    }
    const rect = cellsToRect(remaining);
    if (!rect) return { kind: 'error', message: rectangleMessage(area.name) };
    kept.push({ name: area.name, ...rect });
  }
  return { kind: 'cleared', areas: sortAreas(kept), removedAreas };
}

/** The cells of an area row, with `.` for empty cells, as `grid-template-areas` writes them. */
export function areaRowsOf(grid: ScopeGrid): string[][] {
  const rows: string[][] = [];
  for (let row = 1; row <= grid.rows.length; row += 1) {
    const cells: string[] = [];
    for (let column = 1; column <= grid.columns.length; column += 1) {
      const area = sortAreas(grid.areas).find(
        (item) =>
          row >= item.row_start &&
          row < item.row_end &&
          column >= item.column_start &&
          column < item.column_end,
      );
      cells.push(area ? area.name : '.');
    }
    rows.push(cells);
  }
  return rows;
}
