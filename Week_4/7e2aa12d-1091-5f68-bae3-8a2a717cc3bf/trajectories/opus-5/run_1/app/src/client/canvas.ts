import { areaAt, normaliseRect, sortAreas } from '../shared/grid.js';
import { checkTrackSize } from '../shared/trackSize.js';
import type { Area, Axis, Rect } from '../shared/types.js';
import { clear, h, reducedMotion } from './dom.js';

export interface Cell {
  row: number;
  column: number;
}

export interface CanvasGrid {
  columns: string[];
  rows: string[];
  areas: Area[];
}

export interface CanvasHooks {
  editable: boolean;
  nameArea(selection: Rect): void;
  clearCells(selection: Rect): void;
  trackCommand(command: 'add' | 'remove', axis: Axis, index: number): void;
  setTrackSize(axis: Axis, index: number, size: string): void;
  fieldProblem(field: HTMLInputElement, message: string): void;
}

const STEP_BY_UNIT: Record<string, number> = { px: 10, fr: 0.25, '%': 1 };
const DRAG_PIXELS_PER_STEP = 20;

function sizeNumber(size: string): number {
  return Number.parseFloat(size);
}

function sizeUnit(size: string): string {
  return size.endsWith('fr') ? 'fr' : size.endsWith('px') ? 'px' : size.endsWith('%') ? '%' : 'auto';
}

function stepped(size: string, steps: number): string | null {
  const unit = sizeUnit(size);
  const step = STEP_BY_UNIT[unit];
  if (step === undefined) return null;
  const next = Math.round((sizeNumber(size) + steps * step) * 100) / 100;
  const check = checkTrackSize(`${next}${unit}`);
  return check.ok ? check.canonical : null;
}

/** The editable grid with its ruler of resolved widths, and the read-only grid of the view page. */
export class Canvas {
  readonly element: HTMLElement;
  private readonly gridElement: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly blocks = new Map<string, HTMLElement>();
  private grid: CanvasGrid = { columns: [], rows: [], areas: [] };
  private resolved: number[] = [];
  cursor: Cell = { row: 1, column: 1 };
  anchor: Cell = { row: 1, column: 1 };
  private pressed: Cell | null = null;
  private glideUntil = 0;

  constructor(private readonly hooks: CanvasHooks) {
    this.gridElement = h('div', { role: 'grid', 'aria-label': 'Layout grid', class: 'layout-grid' });
    this.layer = h('div', { class: 'area-layer' });
    this.element = h('div', { class: 'canvas-inner' }, this.gridElement, this.layer);
    this.gridElement.addEventListener('keydown', (event) => this.onKeyDown(event as KeyboardEvent));
    this.gridElement.addEventListener('pointerdown', (event) => this.onPointerDown(event as PointerEvent));
    /* Area blocks are placed in pixels, so they follow any resize of the canvas. */
    new ResizeObserver(() => {
      if (Date.now() < this.glideUntil) return;
      this.updateBlocks(false);
    }).observe(this.gridElement);
  }

  selection(): Rect {
    return normaliseRect({
      row_start: Math.min(this.anchor.row, this.cursor.row),
      row_end: Math.max(this.anchor.row, this.cursor.row) + 1,
      column_start: Math.min(this.anchor.column, this.cursor.column),
      column_end: Math.max(this.anchor.column, this.cursor.column) + 1,
    });
  }

  focusCursor(): void {
    this.cellElement(this.cursor.row, this.cursor.column)?.focus();
  }

  private cellElement(row: number, column: number): HTMLElement | null {
    return this.gridElement.querySelector(`[role="gridcell"][data-row="${row}"][data-column="${column}"]`);
  }

  render(grid: CanvasGrid, resolved: number[], animate: boolean): void {
    this.grid = grid;
    this.resolved = resolved;
    this.cursor = this.clamp(this.cursor);
    this.anchor = this.clamp(this.anchor);

    const focusKey = (document.activeElement as HTMLElement | null)?.dataset['focusKey'] ?? null;
    const caret =
      document.activeElement instanceof HTMLInputElement ? document.activeElement.selectionStart : null;

    clear(this.gridElement);
    this.gridElement.style.setProperty(
      '--track-template',
      `var(--row-header-width) repeat(${grid.columns.length}, minmax(44px, 1fr))`,
    );
    this.gridElement.append(this.headerRow());
    for (let row = 1; row <= grid.rows.length; row += 1) this.gridElement.append(this.bodyRow(row));
    this.updateBlocks(animate);

    if (focusKey) {
      const restored = this.element.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`);
      if (restored) {
        restored.focus();
        if (restored instanceof HTMLInputElement && caret !== null) {
          restored.setSelectionRange(caret, caret);
        }
      }
    }
  }

  private clamp(cell: Cell): Cell {
    return {
      row: Math.min(Math.max(cell.row, 1), Math.max(this.grid.rows.length, 1)),
      column: Math.min(Math.max(cell.column, 1), Math.max(this.grid.columns.length, 1)),
    };
  }

  private headerRow(): HTMLElement {
    const row = h('div', { role: 'row', class: 'grid-row header-row' });
    row.append(h('div', { role: 'presentation', 'aria-hidden': 'true', class: 'grid-corner' }));
    this.grid.columns.forEach((size, index) => {
      const number = index + 1;
      const resolved = this.resolved[index];
      const header = h('div', {
        role: 'columnheader',
        'aria-label': `Column ${number}`,
        class: 'track-header column-header',
        'data-track-index': number,
        'data-track-size': size,
        'data-track-unit': checkTrackSize(size).ok ? (checkTrackSize(size) as { unit: string }).unit : 'auto',
      });
      if (resolved !== undefined) header.setAttribute('data-resolved-px', String(resolved));
      if (this.hooks.editable) {
        header.append(
          this.sizeField('column', number, size),
          this.separator('column', number, size),
          h('button', {
            type: 'button',
            class: 'remove-track',
            'aria-label': `Remove column ${number}`,
            'data-focus-key': `remove-column-${number}`,
            text: '×',
            onclick: () => this.hooks.trackCommand('remove', 'column', number),
          }),
        );
      } else {
        header.append(h('span', { class: 'track-size numeric', text: size }));
      }
      header.append(
        h('span', {
          class: 'resolved numeric',
          text: resolved === undefined ? '' : `${resolved}px`,
        }),
      );
      row.append(header);
    });
    return row;
  }

  private bodyRow(row: number): HTMLElement {
    const element = h('div', { role: 'row', class: 'grid-row' });
    const size = this.grid.rows[row - 1] as string;
    const header = h('div', {
      role: 'rowheader',
      'aria-label': `Row ${row}`,
      class: 'track-header row-header',
      'data-track-index': row,
      'data-track-size': size,
      'data-track-unit': checkTrackSize(size).ok ? (checkTrackSize(size) as { unit: string }).unit : 'auto',
    });
    if (this.hooks.editable) {
      header.append(
        this.sizeField('row', row, size),
        this.separator('row', row, size),
        h('button', {
          type: 'button',
          class: 'remove-track',
          'aria-label': `Remove row ${row}`,
          'data-focus-key': `remove-row-${row}`,
          text: '×',
          onclick: () => this.hooks.trackCommand('remove', 'row', row),
        }),
      );
    } else {
      header.append(h('span', { class: 'track-size numeric', text: size }));
    }
    element.append(header);

    const selection = this.selection();
    for (let column = 1; column <= this.grid.columns.length; column += 1) {
      const area = areaAt(this.grid, row, column);
      const selected =
        row >= selection.row_start &&
        row < selection.row_end &&
        column >= selection.column_start &&
        column < selection.column_end;
      const cell = h('div', {
        role: 'gridcell',
        class: 'grid-cell',
        'data-row': row,
        'data-column': column,
        'data-area': area ? area.name : '',
        'aria-label': `Row ${row}, column ${column}, ${area ? area.name : 'empty'}`,
        tabindex: row === this.cursor.row && column === this.cursor.column ? 0 : -1,
      });
      if (this.hooks.editable) {
        cell.setAttribute('aria-selected', selected ? 'true' : 'false');
        if (row === this.cursor.row && column === this.cursor.column) {
          cell.setAttribute('data-focus-key', 'cursor-cell');
        }
      }
      element.append(cell);
    }
    return element;
  }

  private sizeField(axis: Axis, index: number, size: string): HTMLInputElement {
    const label = axis === 'column' ? `Column ${index} size` : `Row ${index} size`;
    const field = h('input', {
      type: 'text',
      class: 'size-field numeric',
      'aria-label': label,
      'data-focus-key': `size-${axis}-${index}`,
      size: 8,
      value: size,
    }) as HTMLInputElement;
    /** Enter, leaving the field and a separator all write here, so a value is sent only once. */
    field.dataset['attempted'] = size;
    const commit = (): void => {
      const typed = field.value.trim();
      if (typed === field.dataset['attempted']) return;
      const check = checkTrackSize(typed);
      if (!check.ok) {
        this.hooks.fieldProblem(field, check.message);
        field.value = size;
        return;
      }
      if (check.canonical === size) {
        field.value = size;
        return;
      }
      field.dataset['attempted'] = check.canonical;
      this.hooks.setTrackSize(axis, index, check.canonical);
    };
    field.addEventListener('blur', commit);
    field.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });
    return field;
  }

  private separator(axis: Axis, index: number, size: string): HTMLElement {
    const unit = sizeUnit(size);
    const fixed = STEP_BY_UNIT[unit] === undefined;
    const element = h('div', {
      role: 'separator',
      class: 'track-separator',
      'aria-label': axis === 'column' ? `Resize column ${index}` : `Resize row ${index}`,
      'aria-orientation': axis === 'column' ? 'vertical' : 'horizontal',
      'aria-valuetext': size,
      'data-focus-key': `separator-${axis}-${index}`,
      tabindex: 0,
    });
    if (fixed) {
      element.setAttribute('aria-disabled', 'true');
      return element;
    }

    const field = (): HTMLInputElement | null =>
      this.element.querySelector(`[data-focus-key="size-${axis}-${index}"]`);

    element.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      const grow = key === 'ArrowRight' || key === 'ArrowDown';
      const shrink = key === 'ArrowLeft' || key === 'ArrowUp';
      if (!grow && !shrink) return;
      event.preventDefault();
      const next = stepped(size, grow ? 1 : -1);
      if (!next || next === size) return;
      element.setAttribute('aria-valuetext', next);
      this.showSize(field(), next);
      this.hooks.setTrackSize(axis, index, next);
    });

    element.addEventListener('pointerdown', (event) => {
      const pointer = event as PointerEvent;
      pointer.preventDefault();
      element.setPointerCapture(pointer.pointerId);
      const origin = axis === 'column' ? pointer.clientX : pointer.clientY;
      let shown = size;
      const move = (moveEvent: PointerEvent): void => {
        const travel = (axis === 'column' ? moveEvent.clientX : moveEvent.clientY) - origin;
        const steps = Math.trunc(travel / DRAG_PIXELS_PER_STEP);
        const next = stepped(size, steps) ?? shown;
        shown = next;
        element.setAttribute('aria-valuetext', next);
        this.showSize(field(), next);
      };
      const finish = (): void => {
        element.removeEventListener('pointermove', move as EventListener);
        element.removeEventListener('pointerup', finish);
        element.removeEventListener('pointercancel', finish);
        if (shown !== size) this.hooks.setTrackSize(axis, index, shown);
      };
      element.addEventListener('pointermove', move as EventListener);
      element.addEventListener('pointerup', finish);
      element.addEventListener('pointercancel', finish);
    });

    return element;
  }

  private showSize(field: HTMLInputElement | null, size: string): void {
    if (!field) return;
    field.value = size;
    field.dataset['attempted'] = size;
  }

  private cellFromPoint(x: number, y: number): Cell | null {
    const target = document.elementFromPoint(x, y);
    const cell = target?.closest('[role="gridcell"]');
    if (!cell || !this.gridElement.contains(cell)) return null;
    return {
      row: Number((cell as HTMLElement).dataset['row']),
      column: Number((cell as HTMLElement).dataset['column']),
    };
  }

  private onPointerDown(event: PointerEvent): void {
    const target = (event.target as HTMLElement | null)?.closest('[role="gridcell"]');
    if (!target) return;
    const cell: Cell = {
      row: Number((target as HTMLElement).dataset['row']),
      column: Number((target as HTMLElement).dataset['column']),
    };
    event.preventDefault();
    this.pressed = cell;
    this.cursor = cell;
    this.anchor = cell;
    this.refreshSelection();
    this.focusCursor();
    if (!this.hooks.editable) return;

    this.gridElement.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent): void => {
      const over = this.cellFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!over || (over.row === this.cursor.row && over.column === this.cursor.column)) return;
      this.cursor = over;
      this.refreshSelection();
    };
    const finish = (): void => {
      this.gridElement.removeEventListener('pointermove', move as EventListener);
      this.gridElement.removeEventListener('pointerup', finish);
      this.gridElement.removeEventListener('pointercancel', finish);
      const start = this.pressed;
      this.pressed = null;
      if (!start) return;
      if (start.row === this.cursor.row && start.column === this.cursor.column) return;
      this.hooks.nameArea(this.selection());
    };
    this.gridElement.addEventListener('pointermove', move as EventListener);
    this.gridElement.addEventListener('pointerup', finish);
    this.gridElement.addEventListener('pointercancel', finish);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || target.getAttribute('role') !== 'gridcell') return;
    const key = event.key;
    const moves: Record<string, Cell> = {
      ArrowUp: { row: -1, column: 0 },
      ArrowDown: { row: 1, column: 0 },
      ArrowLeft: { row: 0, column: -1 },
      ArrowRight: { row: 0, column: 1 },
    };
    const move = moves[key];
    if (move) {
      event.preventDefault();
      this.cursor = this.clamp({ row: this.cursor.row + move.row, column: this.cursor.column + move.column });
      if (!event.shiftKey || !this.hooks.editable) this.anchor = this.cursor;
      this.refreshSelection();
      this.focusCursor();
      return;
    }
    if (!this.hooks.editable) return;
    if (key === 'Enter') {
      event.preventDefault();
      this.hooks.nameArea(this.selection());
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      this.hooks.clearCells(this.selection());
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === 'c') {
      event.preventDefault();
      this.hooks.trackCommand('add', 'column', this.cursor.column);
    } else if (key === 'C') {
      event.preventDefault();
      this.hooks.trackCommand('remove', 'column', this.cursor.column);
    } else if (key === 'r') {
      event.preventDefault();
      this.hooks.trackCommand('add', 'row', this.cursor.row);
    } else if (key === 'R') {
      event.preventDefault();
      this.hooks.trackCommand('remove', 'row', this.cursor.row);
    }
  }

  private refreshSelection(): void {
    const selection = this.selection();
    for (const cell of this.gridElement.querySelectorAll<HTMLElement>('[role="gridcell"]')) {
      const row = Number(cell.dataset['row']);
      const column = Number(cell.dataset['column']);
      const inside =
        row >= selection.row_start &&
        row < selection.row_end &&
        column >= selection.column_start &&
        column < selection.column_end;
      if (this.hooks.editable) cell.setAttribute('aria-selected', inside ? 'true' : 'false');
      const isCursor = row === this.cursor.row && column === this.cursor.column;
      cell.setAttribute('tabindex', isCursor ? '0' : '-1');
      if (this.hooks.editable) {
        if (isCursor) cell.setAttribute('data-focus-key', 'cursor-cell');
        else cell.removeAttribute('data-focus-key');
      }
    }
  }

  /** The Breakpoint Fold: blocks present before and after glide to their new cells. */
  private updateBlocks(animate: boolean): void {
    const gliding = animate && !reducedMotion();
    if (gliding) this.glideUntil = Date.now() + 300;
    const areas = sortAreas(this.grid.areas);
    const names = new Set(areas.map((area) => area.name));
    for (const [name, block] of this.blocks) {
      if (!names.has(name)) {
        block.remove();
        this.blocks.delete(name);
      }
    }
    const base = this.layer.getBoundingClientRect();
    for (const area of areas) {
      const first = this.cellElement(area.row_start, area.column_start);
      const last = this.cellElement(area.row_end - 1, area.column_end - 1);
      if (!first || !last) continue;
      const from = first.getBoundingClientRect();
      const to = last.getBoundingClientRect();
      let block = this.blocks.get(area.name);
      const fresh = !block;
      if (!block) {
        block = h('div', { class: 'area-block' }, h('span', { class: 'area-block-name' }));
        this.blocks.set(area.name, block);
        this.layer.append(block);
      }
      const label = block.firstElementChild as HTMLElement;
      label.textContent = area.name;
      block.setAttribute('data-area-name', area.name);
      block.setAttribute('data-row-start', String(area.row_start));
      block.setAttribute('data-column-start', String(area.column_start));
      block.setAttribute('data-row-end', String(area.row_end));
      block.setAttribute('data-column-end', String(area.column_end));
      const styles = {
        left: `${from.left - base.left}px`,
        top: `${from.top - base.top}px`,
        width: `${to.right - from.left}px`,
        height: `${to.bottom - from.top}px`,
      };
      if (fresh || !gliding) {
        block.classList.add('no-glide');
        Object.assign(block.style, styles);
        void block.offsetWidth;
        block.classList.remove('no-glide');
      } else {
        Object.assign(block.style, styles);
      }
    }
  }
}
