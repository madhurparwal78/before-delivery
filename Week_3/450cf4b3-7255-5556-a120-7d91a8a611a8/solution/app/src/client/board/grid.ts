// Keyboard drop-target moves across the station grid.

interface Cell {
  id: string;
  col: number;
  row: number;
}

/**
 * Right/Left: the station one column over in the same row. Up/Down: the row above or below, on the
 * station whose column is nearest (ties go to the lower column). Nothing wraps; at an edge, stay.
 */
export function stepTarget(cells: readonly Cell[], current: string, key: string): string {
  const here = cells.find((c) => c.id === current);
  if (!here) return current;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const col = here.col + (key === "ArrowRight" ? 1 : -1);
    return cells.find((c) => c.row === here.row && c.col === col)?.id ?? current;
  }
  const row = here.row + (key === "ArrowDown" ? 1 : -1);
  const candidates = cells.filter((c) => c.row === row)
    .sort((a, b) => Math.abs(a.col - here.col) - Math.abs(b.col - here.col) || a.col - b.col);
  return candidates[0]?.id ?? current;
}
