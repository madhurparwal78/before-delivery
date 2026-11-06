import type { CoverageGrid, Holiday, Position } from '../../shared/types.js';
import { el, setText } from '../dom.js';

export interface CoverageTable {
  node: HTMLElement;
  update(grid: CoverageGrid | null, holidays: Holiday[]): void;
  focusedCell(): { col: number; row: number } | null;
}

/**
 * The coverage chart shown as an ARIA grid of its cells, with full row and column
 * counts and 1-based indexes, operated entirely by keyboard.
 */
export function createCoverageTable(
  onFocusCell: (centre: Position, holiday: Holiday | null) => void,
  onQueue: (holiday: Holiday | null) => void,
): CoverageTable {
  const node = el('div', { role: 'grid', 'aria-label': 'Coverage table', class: 'coverage-grid' });
  let current: CoverageGrid | null = null;
  let holidaysNow: Holiday[] = [];
  let focused: { col: number; row: number } | null = null;

  function centreOf(col: number, row: number): Position {
    const origin = current?.origin ?? { easting: 0, northing: 0 };
    return {
      easting: origin.easting + col * 5 + 2.5,
      northing: origin.northing + row * 5 + 2.5,
    };
  }

  function holidayAt(col: number, row: number): Holiday | null {
    for (const holiday of holidaysNow) {
      if (holiday.status === 'Closed') continue;
      if (holiday.cells.some(([c, r]) => c === col && r === row)) return holiday;
    }
    return null;
  }

  function cellText(col: number, row: number): string {
    const overlap = current?.overlap[row]?.[col] ?? -1;
    if (overlap === -1) return 'outside';
    const holiday = holidayAt(col, row);
    const count = overlap >= 3 ? '3+' : String(overlap);
    return holiday ? `${holiday.label} ${count}` : count;
  }

  function cellNode(col: number, row: number): HTMLElement | null {
    return node.querySelector<HTMLElement>(`[data-col="${col}"][data-row="${row}"]`);
  }

  function focusCell(col: number, row: number): void {
    if (!current) return;
    const clampedCol = Math.max(0, Math.min(current.cols - 1, col));
    const clampedRow = Math.max(0, Math.min(current.rows - 1, row));
    const previous = focused ? cellNode(focused.col, focused.row) : null;
    if (previous) previous.setAttribute('tabindex', '-1');
    focused = { col: clampedCol, row: clampedRow };
    const target = cellNode(clampedCol, clampedRow);
    if (target) {
      target.setAttribute('tabindex', '0');
      target.focus();
    }
    onFocusCell(centreOf(clampedCol, clampedRow), holidayAt(clampedCol, clampedRow));
  }

  node.addEventListener('keydown', (event) => {
    if (!current || !focused) return;
    const { col, row } = focused;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        focusCell(col - 1, row);
        break;
      case 'ArrowRight':
        event.preventDefault();
        focusCell(col + 1, row);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusCell(col, row + 1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusCell(col, row - 1);
        break;
      case 'Home':
        event.preventDefault();
        if (event.ctrlKey) focusCell(0, current.rows - 1);
        else focusCell(0, row);
        break;
      case 'End':
        event.preventDefault();
        if (event.ctrlKey) focusCell(current.cols - 1, 0);
        else focusCell(current.cols - 1, row);
        break;
      case 'PageUp':
        event.preventDefault();
        focusCell(col, row + 10);
        break;
      case 'PageDown':
        event.preventDefault();
        focusCell(col, row - 10);
        break;
      case 'Enter':
        event.preventDefault();
        onQueue(holidayAt(col, row));
        break;
      default:
        break;
    }
  });

  return {
    node,
    focusedCell: () => focused,
    update(grid, holidays) {
      holidaysNow = holidays;
      const sameShape =
        current !== null && grid !== null && current.cols === grid.cols && current.rows === grid.rows;
      current = grid;
      if (!grid) {
        node.replaceChildren();
        return;
      }
      node.setAttribute('aria-rowcount', String(grid.rows));
      node.setAttribute('aria-colcount', String(grid.cols));

      if (!sameShape) {
        node.replaceChildren();
        // Rows run from north at the top to south.
        for (let row = grid.rows - 1; row >= 0; row -= 1) {
          const rowNode = el('div', {
            role: 'row',
            'aria-rowindex': String(grid.rows - row),
          });
          for (let col = 0; col < grid.cols; col += 1) {
            const cell = el('div', {
              role: 'gridcell',
              'aria-rowindex': String(grid.rows - row),
              'aria-colindex': String(col + 1),
              'data-col': String(col),
              'data-row': String(row),
              tabindex: '-1',
              class: 'grid-cell',
            }, [cellText(col, row)]);
            cell.addEventListener('click', () => focusCell(col, row));
            rowNode.append(cell);
          }
          node.append(rowNode);
        }
        if (!focused) focused = { col: 0, row: grid.rows - 1 };
        const first = cellNode(focused.col, focused.row);
        if (first) first.setAttribute('tabindex', '0');
        return;
      }

      for (let row = 0; row < grid.rows; row += 1) {
        for (let col = 0; col < grid.cols; col += 1) {
          const cell = cellNode(col, row);
          if (cell) setText(cell, cellText(col, row));
        }
      }
    },
  };
}
