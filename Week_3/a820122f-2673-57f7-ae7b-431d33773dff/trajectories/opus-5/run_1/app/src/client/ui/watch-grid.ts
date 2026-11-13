import type { DayCell } from '../api.js';
import { CELL_STATE_NAMES } from '../copy.js';
import { el } from '../dom.js';

export type CellChange = { cell: DayCell; kind: 'rest' | 'work' };

export type WatchGrid = {
  element: HTMLElement;
  setCells: (cells: DayCell[], editable: boolean) => void;
  onChange: (handler: (changes: CellChange[]) => void) => void;
  stop: () => void;
};

function cellName(cell: DayCell): string {
  return `${cell.ship_time} ${CELL_STATE_NAMES[cell.state] ?? 'Not logged'}${
    cell.repeated ? ' repeated' : ''
  }`;
}

function nextOnToggle(state: DayCell['state']): 'rest' | 'work' {
  return state === 'rest' || state === 'short_break' ? 'work' : 'rest';
}

/** The half-hour watch grid: one Tab stop, arrow keys, Space, Enter, R, W, and painting by drag. */
export function createWatchGrid(): WatchGrid {
  const element = el('div', { role: 'grid', 'aria-label': 'Watch grid', class: 'watch-grid' });
  const wide = window.matchMedia('(min-width: 768px)');
  let cells: DayCell[] = [];
  let editable = false;
  let focusIndex = 0;
  let painting: 'rest' | 'work' | null = null;
  let handler: (changes: CellChange[]) => void = () => undefined;
  const nodes: HTMLElement[] = [];

  function columns(): number {
    return wide.matches ? 12 : 6;
  }

  function paintCell(index: number, kind: 'rest' | 'work'): void {
    const cell = cells[index];
    if (cell === undefined || !editable) return;
    const alreadyLogged =
      kind === 'rest' ? cell.state === 'rest' || cell.state === 'short_break' : cell.state === 'work';
    if (alreadyLogged) return;
    cell.state = kind;
    refreshCell(index);
    handler([{ cell, kind }]);
  }

  function refreshCell(index: number): void {
    const cell = cells[index];
    const node = nodes[index];
    if (cell === undefined || node === undefined) return;
    node.replaceChildren(
      el('span', { class: 'cell-time', text: cell.ship_time }),
      el('span', { class: 'visually-hidden', text: ` ${CELL_STATE_NAMES[cell.state] ?? ''}` }),
      ...(cell.repeated ? [el('span', { class: 'visually-hidden', text: ' repeated' })] : []),
    );
    node.dataset['state'] = cell.state;
    node.setAttribute('aria-label', cellName(cell));
    node.setAttribute('aria-disabled', editable ? 'false' : 'true');
    node.tabIndex = index === focusIndex ? 0 : -1;
  }

  function focusCell(index: number): void {
    if (index < 0 || index >= cells.length) return;
    focusIndex = index;
    nodes.forEach((node, position) => {
      node.tabIndex = position === focusIndex ? 0 : -1;
    });
    nodes[focusIndex]?.focus();
  }

  function render(): void {
    nodes.length = 0;
    const perRow = columns();
    const rows: HTMLElement[] = [];
    for (let start = 0; start < cells.length; start += perRow) {
      const row = el('div', { role: 'row', class: 'watch-row' });
      for (let index = start; index < Math.min(start + perRow, cells.length); index += 1) {
        const node = el('div', { role: 'gridcell', class: 'watch-cell' });
        node.dataset['index'] = String(index);
        nodes[index] = node;
        row.append(node);
      }
      rows.push(row);
    }
    element.replaceChildren(...rows);
    if (focusIndex >= cells.length) focusIndex = Math.max(0, cells.length - 1);
    cells.forEach((_, index) => refreshCell(index));
  }

  function indexFromEvent(event: Event): number | null {
    const target = (event.target as HTMLElement | null)?.closest('[role="gridcell"]');
    if (target === null || target === undefined) return null;
    const index = Number((target as HTMLElement).dataset['index']);
    return Number.isInteger(index) ? index : null;
  }

  element.addEventListener('focusin', (event) => {
    const index = indexFromEvent(event);
    if (index !== null && index !== focusIndex) {
      focusIndex = index;
      nodes.forEach((node, position) => {
        node.tabIndex = position === focusIndex ? 0 : -1;
      });
    }
  });

  element.addEventListener('keydown', (event) => {
    const perRow = columns();
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -perRow,
      ArrowDown: perRow,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      focusCell(Math.min(Math.max(focusIndex + move, 0), cells.length - 1));
      return;
    }
    const cell = cells[focusIndex];
    if (cell === undefined) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      paintCell(focusIndex, nextOnToggle(cell.state));
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      paintCell(focusIndex, 'rest');
      return;
    }
    if (event.key === 'w' || event.key === 'W') {
      event.preventDefault();
      paintCell(focusIndex, 'work');
    }
  });

  element.addEventListener('pointerdown', (event) => {
    const index = indexFromEvent(event);
    if (index === null) return;
    event.preventDefault();
    focusCell(index);
    const cell = cells[index];
    if (cell === undefined) return;
    painting = nextOnToggle(cell.state);
    paintCell(index, painting);
    if (event.isPrimary) element.setPointerCapture(event.pointerId);
  });

  element.addEventListener('pointermove', (event) => {
    if (painting === null) return;
    const point = document.elementFromPoint(event.clientX, event.clientY);
    const target = point?.closest('[role="gridcell"]') as HTMLElement | null;
    if (target === null || target === undefined) return;
    const index = Number(target.dataset['index']);
    if (Number.isInteger(index)) paintCell(index, painting);
  });

  const endPaint = (): void => {
    painting = null;
  };
  element.addEventListener('pointerup', endPaint);
  element.addEventListener('pointercancel', endPaint);
  window.addEventListener('pointerup', endPaint);

  const onBreakpoint = (): void => render();
  wide.addEventListener('change', onBreakpoint);

  return {
    element,
    setCells: (next, nextEditable) => {
      const sameLength = next.length === cells.length;
      cells = next.map((cell) => ({ ...cell }));
      editable = nextEditable;
      if (sameLength && nodes.length === cells.length) {
        cells.forEach((_, index) => refreshCell(index));
      } else {
        render();
      }
    },
    onChange: (next) => {
      handler = next;
    },
    stop: () => {
      wide.removeEventListener('change', onBreakpoint);
      window.removeEventListener('pointerup', endPaint);
    },
  };
}
