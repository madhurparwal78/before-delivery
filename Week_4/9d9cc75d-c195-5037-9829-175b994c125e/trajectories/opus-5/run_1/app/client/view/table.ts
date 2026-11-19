import { dataValue } from '../../shared/display.js';
import { isShareColumn, twinModel } from '../../shared/twin.js';
import type { QueryResult } from '../../shared/types.js';
import { clear, el } from '../dom.js';
import { markKey } from './chart.js';

export function renderTwin(
  host: HTMLElement,
  sheetName: string,
  result: QueryResult,
  primary: number,
  highlightKeys: Set<string> = new Set(),
): void {
  clear(host);
  if (result.chart === 'none') return;
  const model = twinModel(result, primary);
  const dimensionCount = result.columns.filter((c) => c.role === 'dimension').length;
  const shares = result.columns.map((c) => c.role === 'measure' && isShareColumn(c.name));

  const table = el('table', { role: 'grid', 'aria-label': `${sheetName} table`, class: 'twin' });
  const head = el('thead', {}, [
    el(
      'tr',
      { role: 'row' },
      model.header.map((name) => el('th', { role: 'columnheader', scope: 'col', text: name })),
    ),
  ]);
  const body = el('tbody');
  result.rows.forEach((row, index) => {
    const key = markKey(row.slice(0, dimensionCount));
    const cells: HTMLElement[] = [];
    model.rows[index].cells.forEach((text, columnIndex) => {
      if (columnIndex < dimensionCount) {
        cells.push(el('th', { role: 'rowheader', scope: 'row', text }));
        return;
      }
      const value = row[columnIndex];
      cells.push(
        el('td', {
          role: 'gridcell',
          'data-value': typeof value === 'number' ? dataValue(value) : '',
          class: shares[columnIndex] ? 'number share' : 'number',
          text,
        }),
      );
    });
    const tr = el('tr', { role: 'row', 'data-highlight': highlightKeys.has(key) ? 'true' : null }, cells);
    body.append(tr);
  });
  for (const extra of model.extra) {
    body.append(
      el('tr', { role: 'row', class: 'twin-extra' }, [
        el('th', { role: 'rowheader', scope: 'row', text: extra.label }),
        ...extra.cells.map((text) => el('td', { role: 'gridcell', class: 'number', text })),
      ]),
    );
  }
  table.append(head, body);
  host.append(table);
}
