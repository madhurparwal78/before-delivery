import { CELLS, cellColumn, cellRow, type Cell, type Digit } from '../shared/board';
import { highlightTokens } from '../shared/highlight';
import { apply, el } from './dom';

export type BoardState = 'playing' | 'paused' | 'lost' | 'won';

export interface BoardSource {
  isGiven(cell: Cell): boolean;
  valueAt(cell: Cell): Digit | null;
  notesAt(cell: Cell): Digit[];
  isWrong(cell: Cell): boolean;
  isHinted(cell: Cell): boolean;
}

function labelFor(source: BoardSource, cell: Cell, hidden: boolean): string {
  const place = `Row ${cellRow(cell)}, column ${cellColumn(cell)}, `;
  if (hidden) return `${place}hidden`;
  const value = source.valueAt(cell);
  if (source.isGiven(cell)) return `${place}given ${value}`;
  if (value === null) {
    const notes = source.notesAt(cell);
    return notes.length === 0 ? `${place}empty` : `${place}empty, notes ${notes.join(' ')}`;
  }
  if (source.isHinted(cell)) return `${place}${value}, hint`;
  if (source.isWrong(cell)) return `${place}${value}, wrong`;
  return `${place}${value}`;
}

export class BoardView {
  readonly element: HTMLElement;
  selected: Cell;

  private readonly cells = new Map<Cell, HTMLElement>();
  private readonly values = new Map<Cell, HTMLElement>();
  private readonly notes = new Map<Cell, HTMLElement>();

  constructor(onSelect: (cell: Cell) => void) {
    this.selected = 'r1c1';
    this.element = el('div', {
      role: 'grid',
      'aria-label': 'Puzzle board',
      id: 'board',
      class: 'board',
      'data-state': 'playing',
    });
    for (let row = 1; row <= 9; row += 1) {
      const line = el('div', { role: 'row', class: 'board-row' });
      for (let column = 1; column <= 9; column += 1) {
        const cell = `r${row}c${column}`;
        const value = el('span', { class: 'cell-value' });
        const notes = el('span', { class: 'cell-notes', 'aria-hidden': 'true' });
        const node = el(
          'div',
          {
            role: 'gridcell',
            class: 'cell',
            'data-cell': cell,
            tabindex: '-1',
          },
          [value, notes],
        );
        node.addEventListener('click', () => onSelect(cell));
        this.cells.set(cell, node);
        this.values.set(cell, value);
        this.notes.set(cell, notes);
        line.append(node);
      }
      this.element.append(line);
    }
  }

  cellElement(cell: Cell): HTMLElement {
    return this.cells.get(cell) as HTMLElement;
  }

  focusSelected(): void {
    this.cellElement(this.selected).focus();
  }

  render(source: BoardSource, state: BoardState): void {
    const hidden = state === 'paused';
    const plain = state !== 'playing';
    apply(this.element, { 'data-state': state, 'aria-hidden': hidden ? 'true' : null });
    for (const cell of CELLS) {
      const node = this.cellElement(cell);
      const value = hidden ? null : source.valueAt(cell);
      const notes = hidden ? [] : source.notesAt(cell);
      apply(node, {
        'data-given': source.isGiven(cell) ? 'true' : 'false',
        'data-value': value === null ? '' : String(value),
        'data-notes': notes.join(' '),
        'data-wrong': !hidden && source.isWrong(cell) ? 'true' : 'false',
        'data-hinted': !hidden && source.isHinted(cell) ? 'true' : 'false',
        'aria-selected': cell === this.selected ? 'true' : 'false',
        tabindex: cell === this.selected ? '0' : '-1',
        'aria-label': labelFor(source, cell, hidden),
        'data-highlight': plain ? '' : highlightTokens(cell, this.selected, (at) => source.valueAt(at)),
      });
      (this.values.get(cell) as HTMLElement).textContent = value === null ? '' : String(value);
      (this.notes.get(cell) as HTMLElement).textContent = notes.join(' ');
    }
  }
}

export function emptyCellCount(puzzle: string): number {
  return [...puzzle].filter((character) => character === '0').length;
}
