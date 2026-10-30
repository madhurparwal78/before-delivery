import { el } from './core';

export interface TableColumn<T> {
  label: string;
  cell: (row: T) => Node | string;
  numeric?: boolean;
}

/**
 * A table with explicit ARIA roles so the row and cell semantics survive the
 * stacked card layout used at 375 pixels.
 */
export function ariaTable<T>(
  name: string,
  columns: ReadonlyArray<TableColumn<T>>,
  data: readonly T[],
  emptyCopy: string,
): HTMLElement {
  if (data.length === 0) {
    return el('div', { class: 'table table--empty' }, [
      el('p', { class: 'empty', text: emptyCopy }),
    ]);
  }
  const header = el(
    'div',
    { class: 'table__row table__row--head', role: 'row' },
    columns.map((column) =>
      el('div', { class: 'table__head', role: 'columnheader', text: column.label }),
    ),
  );
  const body = data.map((row) =>
    el(
      'div',
      { class: 'table__row', role: 'row' },
      columns.map((column) =>
        el(
          'div',
          {
            class: column.numeric === true ? 'table__cell table__cell--figure' : 'table__cell',
            role: 'cell',
            'data-label': column.label,
          },
          [column.cell(row)],
        ),
      ),
    ),
  );
  return el('div', { class: 'table', role: 'table', 'aria-label': name }, [header, ...body]);
}

export interface LedgerRow {
  label: string;
  value: Node | string;
}

/** The order ledger: one row header and one aligned figure per row. */
export function ledgerTable(rows: readonly LedgerRow[]): HTMLElement {
  return el(
    'div',
    { class: 'ledger__table', role: 'table', 'aria-label': 'Order ledger' },
    rows.map((row) =>
      el('div', { class: 'ledger__row', role: 'row' }, [
        el('div', { class: 'ledger__label', role: 'rowheader', text: row.label }),
        el('div', { class: 'ledger__value', role: 'cell' }, [row.value]),
      ]),
    ),
  );
}
