import { studio } from './app.ts';
import { el } from './dom.ts';
import { instantDateLabel, money } from './format.ts';
import type { Entry } from './types.ts';

const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'Opening balance',
  pack: 'Credit pack',
  firing_fee: 'Firing fee',
  storage_fee: 'Storage fee',
  refund: 'Refund',
  adjustment: 'Adjustment',
};

const ACCOUNT_LABELS: Record<string, string> = {
  member_credit: 'Member credit',
  card_receipts: 'Card receipts',
  firing_revenue: 'Firing revenue',
  adjustments: 'Adjustments',
};

const COLUMNS = ['Date', 'Movement', 'Account', 'Amount'] as const;

/** The paired ledger, both entries of every movement in the order they were applied. */
export function ledgerTable(entries: readonly Entry[]): HTMLTableElement {
  const zone = studio()?.time_zone ?? 'UTC';
  // Each cell carries its column name, so at 375 a row reads as label and value pairs.
  const cell = (column: (typeof COLUMNS)[number], text: string, mono = false): HTMLElement =>
    el('td', { 'data-label': column, class: mono ? 'mono' : null, text });
  return el('table', { class: 'table ledger', 'aria-label': 'Ledger' }, [
    el('thead', {}, [el('tr', {}, COLUMNS.map((column) => el('th', { scope: 'col', text: column })))]),
    el(
      'tbody',
      {},
      entries.length === 0
        ? [el('tr', {}, [el('td', { colspan: 4, class: 'muted', text: 'No credit movements yet.' })])]
        : entries.map((entry) =>
            el('tr', {}, [
              cell('Date', instantDateLabel(entry.created_at, zone)),
              cell('Movement', MOVEMENT_LABELS[entry.kind] ?? entry.kind),
              cell('Account', ACCOUNT_LABELS[entry.account] ?? entry.account),
              cell('Amount', money(entry.amount_cents), true),
            ]),
          ),
    ),
  ]);
}
