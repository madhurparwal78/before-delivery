import type { SummaryQuestion, SummaryRow } from '../../shared/types.ts';
import { h } from '../lib/dom.ts';

// The tables of one summary question: options with count and percent, or the ranking's mean positions.

function table(name: string, headings: string[], rows: string[][]): HTMLTableElement {
  return h('table', { 'aria-label': name, class: 'figures' },
    h('thead', {}, h('tr', {}, headings.map((heading) => h('th', { scope: 'col' }, heading)))),
    h('tbody', {}, rows.map(([first, ...rest]) => h('tr', {}, h('th', { scope: 'row' }, first), rest.map((cell) => h('td', {}, cell))))));
}

export function optionTable(name: string, rows: SummaryRow[]): HTMLTableElement {
  return table(name, ['Option', 'Count', 'Percent'], rows.map((row) => [row.label, row.count, row.percent]));
}

export function rankingTable(name: string, ranking: SummaryQuestion['ranking']): HTMLTableElement {
  return table(name, ['Option', 'Mean position'], ranking.map((item) => [item.label, item.mean_position]));
}
