// The one place that decides area names, rectangles and the area editing rules.
import type { AreaLine } from './layout.js';

export const AREA_NAME_MESSAGE = 'Area names use 1 to 24 lowercase letters, digits and hyphens and start with a letter.';
export const RESERVED_AREA_MESSAGE = 'The name layout is reserved.';

const AREA_NAME = /^[a-z][a-z0-9-]{0,23}$/;

export function areaNameError(name: string): string | null {
  if (!AREA_NAME.test(name)) return AREA_NAME_MESSAGE;
  if (name === 'layout') return RESERVED_AREA_MESSAGE;
  return null;
}

/** Areas in reading order of their top-left cell. */
export function sortAreas(areas: AreaLine[]): AreaLine[] {
  return [...areas].sort((a, b) =>
    a.row_start - b.row_start || a.column_start - b.column_start || a.name.localeCompare(b.name)
  );
}



