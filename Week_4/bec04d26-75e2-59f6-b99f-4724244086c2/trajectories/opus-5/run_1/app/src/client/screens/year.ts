import { ReturnRecord, STATUS_LABELS, STATUS_ORDER } from '../../shared/types';
import { longDateString } from '../../shared/dates';
import type { App } from '../app';
import { el } from '../dom';
import { emptyState, returnData } from '../components/tile';

const STATUS_FILTERS: readonly { value: string; label: string }[] = [
  ...STATUS_ORDER.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
  { value: 'overdue', label: 'Overdue' },
];

const COLUMNS: readonly string[] = [
  'Client',
  'State',
  'Period',
  'Status',
  'Due',
  'Zone',
  'Gross sales',
  'Tax due',
  'Rate',
  'Edition',
];

function cell(label: string, value: string, extra: Record<string, string> = {}): HTMLElement {
  return el(
    'td',
    extra,
    el('span', { class: 'row-label' }, `${label}:`),
    el('span', {}, value),
  );
}

function row(record: ReturnRecord): HTMLElement {
  const statusText = record.overdue
    ? `${record.status_label} · Overdue`
    : record.status_label;
  return el(
    'tr',
    returnData(record),
    cell(
      'Client',
      record.client.name,
    ),
    cell('State', record.state),
    cell('Period', record.period),
    cell('Status', statusText),
    cell('Due', longDateString(record.due_date)),
    cell('Zone', record.zone_label),
    cell('Gross sales', record.gross_sales ?? '—'),
    cell('Tax due', record.tax_due ?? '—'),
    cell('Rate', record.edition.rate),
    cell('Edition', record.edition.effective_date),
  );
}

export function renderYear(app: App, year: string): HTMLElement {
  const query = app.query();
  const activeStatus = query.get('status');
  const activeState = query.get('state');
  const exportQuery = new URLSearchParams();
  if (activeStatus) exportQuery.set('status', activeStatus);
  if (activeState) exportQuery.set('state', activeState);
  const exportSearch = exportQuery.toString();

  const filters = el(
    'div',
    { class: 'filters' },
    ...STATUS_FILTERS.map((filter) =>
      el(
        'button',
        {
          type: 'button',
          class: 'filter-chip',
          'aria-pressed': activeStatus === filter.value ? 'true' : 'false',
          'data-focus-key': `status-filter:${filter.value}`,
          onClick: () => app.toggleFilter('status', filter.value),
        },
        `Status: ${filter.label}`,
      ),
    ),
    ...app.state.states.map((state) =>
      el(
        'button',
        {
          type: 'button',
          class: 'filter-chip',
          'aria-pressed': activeState === state.code ? 'true' : 'false',
          'data-focus-key': `state-filter:${state.code}`,
          onClick: () => app.toggleFilter('state', state.code),
        },
        `State: ${state.code}`,
      ),
    ),
  );

  const table = el(
    'table',
    { class: 'returns-table', 'aria-label': 'Returns' },
    el(
      'thead',
      {},
      el('tr', {}, ...COLUMNS.map((name) => el('th', { scope: 'col' }, name))),
    ),
    el('tbody', {}, ...app.state.returns.map((record) => row(record))),
  );

  return el(
    'main',
    { class: 'screen' },
    el('h1', {}, `Returns in ${year}`),
    filters,
    el(
      'div',
      { class: 'section-head' },
      el(
        'p',
        { role: 'status', 'aria-label': 'Result count', class: 'count' },
        `${app.state.counts.total} returns`,
      ),
      el(
        'a',
        {
          href: `/api/year/${year}/export.csv${exportSearch ? `?${exportSearch}` : ''}`,
          'data-focus-key': 'export-csv',
        },
        'Export CSV',
      ),
    ),
    el('div', { class: 'table-scroll' }, table),
    app.state.returns.length === 0 ? emptyState('No returns due this year.') : null,
  );
}
