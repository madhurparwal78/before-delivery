import { ShareCell } from './api.js';
import { drawCell, registerCanvas } from './art.js';
import { el } from './dom.js';
import { prefersReducedMotion, settings } from './settings.js';
import { fromHex } from '../shared/hex.js';
import { PADDING_NAMESPACE } from '../shared/namespace.js';
import { readShare } from '../shared/shares.js';

const liveArrivals = new Set<number>();

/** Marks a block as newly arrived, so its square reveals row by row. */
export function noteLiveArrival(height: number): void {
  liveArrivals.add(height);
}

export function takeLiveArrival(height: number): boolean {
  const arrived = liveArrivals.has(height);
  liveArrivals.delete(height);
  return arrived;
}

export interface SquareOptions {
  height: number;
  k: number;
  rows: ShareCell[][];
  namespaceNames: Map<string, string>;
  mine: Set<string>;
  outline: Set<string>;
  revealImmediately: boolean;
}

export interface SquareView {
  frame: HTMLElement;
  grid: HTMLElement;
  revealRows: () => void;
}

function cellLabel(cell: ShareCell, names: Map<string, string>): string {
  if (cell.kind === 'withheld') return 'Withheld';
  if (cell.quadrant !== 'Q0') return 'Parity';
  if (cell.kind === 'padding') return 'Padding';
  return names.get(cell.namespace) ?? cell.namespace;
}

/** The share panel: one modal dialog per opened cell. */
function openSharePanel(cell: ShareCell, origin: HTMLElement): void {
  const dialog = el('dialog', { attrs: { 'aria-label': `Share ${cell.row}, ${cell.col}` } });
  const items: HTMLElement[] = [];
  if (cell.share) {
    const fields = readShare(fromHex(cell.share));
    items.push(el('li', { class: 'mono', text: `Namespace ${fields.namespace}` }));
    items.push(el('li', { class: 'mono', text: `Info byte ${fields.infoByte}` }));
    if (fields.sequenceLength !== null) {
      items.push(el('li', { text: `Sequence length ${fields.sequenceLength} bytes` }));
    }
    items.push(el('li', { class: 'mono', text: `Data ${fields.data}` }));
  } else {
    items.push(el('li', { class: 'mono', text: `Namespace ${cell.namespace}` }));
    items.push(el('li', { text: 'This share was withheld by the producer.' }));
  }
  dialog.append(
    el('h2', { text: `Share ${cell.row}, ${cell.col}` }),
    el('ul', { class: 'list' }, items),
    el(
      'button',
      {
        class: 'pill pill-outline',
        attrs: { type: 'button' },
        on: { click: () => dialog.close() },
      },
      'Close',
    ),
  );
  dialog.addEventListener('close', () => {
    dialog.remove();
    origin.focus();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
}

/** The data square: a grid of 2k rows of 2k gridcells with roving focus. */
export function renderSquare(options: SquareOptions): SquareView {
  const width = 2 * options.k;
  const grid = el('div', {
    class: 'square',
    attrs: { role: 'grid', 'aria-label': `Data square, block ${options.height}` },
  });
  const cells: HTMLElement[][] = [];

  for (let r = 0; r < width; r++) {
    const row = el('div', {
      attrs: { role: 'row' },
      data: { row: r, revealed: options.revealImmediately ? 'true' : 'false' },
    });
    const rowCells: HTMLElement[] = [];
    for (let c = 0; c < width; c++) {
      const cell = options.rows[r][c];
      const key = `${r},${c}`;
      const node = el('div', {
        class: 'square-cell',
        attrs: {
          role: 'gridcell',
          'aria-label': `Share ${r}, ${c}: ${cellLabel(cell, options.namespaceNames)}`,
          tabindex: r === 0 && c === 0 ? 0 : -1,
        },
        data: {
          row: r,
          col: c,
          quadrant: cell.quadrant,
          namespace: cell.namespace,
          kind: cell.kind,
          share: cell.share ?? '',
          mine: options.mine.has(key) ? 'true' : undefined,
          outlined: options.outline.has(key) ? 'true' : undefined,
        },
      });
      if (options.outline.has(key)) node.style.outline = '2px solid var(--strand-pale)';
      const canvas = el('canvas');
      node.appendChild(canvas);
      registerCanvas(canvas, () =>
        drawCell(canvas, { namespace: cell.namespace, kind: cell.kind, share: cell.share }),
      );
      node.addEventListener('click', () => {
        focusCell(r, c);
        openSharePanel(cell, node);
      });
      node.addEventListener('keydown', (event) => {
        const key2 = (event as KeyboardEvent).key;
        if (key2 === 'Enter') {
          event.preventDefault();
          openSharePanel(cell, node);
          return;
        }
        const target = nextPosition(key2, r, c, width, event as KeyboardEvent);
        if (!target) return;
        event.preventDefault();
        focusCell(target[0], target[1]);
      });
      rowCells.push(node);
      row.appendChild(node);
    }
    cells.push(rowCells);
    grid.appendChild(row);
  }

  function focusCell(r: number, c: number): void {
    for (const rowCells of cells) {
      for (const node of rowCells) node.setAttribute('tabindex', '-1');
    }
    const node = cells[r][c];
    node.setAttribute('tabindex', '0');
    node.focus();
  }

  const frame = el('div', { class: 'square-frame' }, grid);

  const revealRows = (): void => {
    const rows = [...grid.querySelectorAll<HTMLElement>('[role="row"]')];
    if (prefersReducedMotion()) {
      for (const row of rows) row.dataset.revealed = 'true';
      return;
    }
    for (const row of rows) row.dataset.revealed = 'false';
    rows.forEach((row, index) => {
      window.setTimeout(
        () => {
          row.dataset.revealed = 'true';
        },
        index * settings.squareRowRevealMs,
      );
    });
  };

  return { frame, grid, revealRows };
}

function nextPosition(
  key: string,
  row: number,
  col: number,
  width: number,
  event: KeyboardEvent,
): [number, number] | null {
  if (key === 'ArrowRight') return [row, Math.min(width - 1, col + 1)];
  if (key === 'ArrowLeft') return [row, Math.max(0, col - 1)];
  if (key === 'ArrowDown') return [Math.min(width - 1, row + 1), col];
  if (key === 'ArrowUp') return [Math.max(0, row - 1), col];
  if (key === 'Home') return event.ctrlKey ? [0, 0] : [row, 0];
  if (key === 'End') return event.ctrlKey ? [width - 1, width - 1] : [row, width - 1];
  return null;
}

/** The namespace legend of a block's square, padding included. */
export function namespaceLegend(
  rows: ShareCell[][],
  k: number,
  names: Map<string, string>,
): HTMLElement {
  const counts = new Map<string, number>();
  for (let r = 0; r < k; r++) {
    for (let c = 0; c < k; c++) {
      const cell = rows[r][c];
      counts.set(cell.namespace, (counts.get(cell.namespace) ?? 0) + 1);
    }
  }
  const items = [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([namespace, count]) =>
      el(
        'li',
        {
          attrs: { 'aria-label': namespace === PADDING_NAMESPACE ? 'Padding' : names.get(namespace) ?? namespace },
          data: { namespace, count },
        },
        [
          el('span', {
            text: namespace === PADDING_NAMESPACE ? 'Padding' : names.get(namespace) ?? namespace,
          }),
          el('span', { class: 'muted', text: ` ${count} ${count === 1 ? 'share' : 'shares'}` }),
        ],
      ),
    );
  return el('ul', { class: 'list square-legend', attrs: { 'aria-label': 'Namespace legend' } }, items);
}
