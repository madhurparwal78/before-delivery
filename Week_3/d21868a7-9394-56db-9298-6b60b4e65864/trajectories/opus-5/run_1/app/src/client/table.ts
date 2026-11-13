import { el, type Child } from './dom.ts';

/**
 * Tables keep their table, row and cell roles at every viewport, so a row that
 * stacks into a block on a phone still reads as a row.
 */

export interface TableParts {
  element: HTMLTableElement;
  body: HTMLElement;
}

export function dataTable(label: string, headers: readonly string[], extraClass = ''): TableParts {
  const head = el('thead', {
    attrs: { role: 'rowgroup' },
    children: [
      el('tr', {
        attrs: { role: 'row' },
        children: headers.map((header) =>
          el('th', { attrs: { role: 'columnheader', scope: 'col' }, text: header }),
        ),
      }),
    ],
  });
  const body = el('tbody', { attrs: { role: 'rowgroup' } });
  const element = el('table', {
    class: `data-table ${extraClass}`.trim(),
    attrs: { role: 'table', 'aria-label': label },
    children: [head, body],
  });
  return { element, body };
}

export function dataRow(cells: readonly { label: string; content: Child | readonly Child[] }[]): HTMLElement {
  return el('tr', {
    attrs: { role: 'row' },
    children: cells.map((cell) =>
      el('td', {
        attrs: { role: 'cell', 'data-label': cell.label },
        children: Array.isArray(cell.content) ? (cell.content as readonly Child[]) : [cell.content as Child],
      }),
    ),
  });
}
