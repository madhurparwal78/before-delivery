// The billing manager home: client picker, week statement, line breakdown, Close week and
// the Contract rates panel with its add-rate form.
import type { Contract, WeekStatement } from '../shared/api.js';
import { api, app, announceError, announceStatus, clearError, startRefresh, renderHeader, errorCopyFor } from './shell.js';
import { ApiFailure } from './api.js';
import { h, focusNode, formatCents } from './dom.js';
import { ERROR_COPY, PENDING_COPY, SUCCESS_COPY } from './copy.js';

interface BillingState {
  orgId: string;
  weekStart: string;
  contracts: Contract[];
  statement: WeekStatement | null;
  selectedLine: string | null;
}

const state: BillingState = {
  orgId: '',
  weekStart: '',
  contracts: [],
  statement: null,
  selectedLine: null,
};

export function renderBillingHome(): void {
  const main = app.main;
  main.replaceChildren(renderHeader());
  const layout = h('div', { class: 'layout' });
  const listPane = h('div', { class: 'list-pane', role: 'region', 'aria-label': 'Client picker' });
  const detailPane = h('div', { class: 'detail-pane' });
  layout.append(listPane, detailPane);
  main.append(layout);

  void init(listPane, detailPane);
}

async function init(listPane: HTMLElement, detailPane: HTMLElement): Promise<void> {
  try {
    const result = await api.call<{ contracts: Contract[] }>('/api/contracts', { tag: 'contracts' });
    state.contracts = result.contracts;
    if (state.orgId === '' && state.contracts.length > 0) {
      state.orgId = state.contracts[0].org_id;
    }
    if (state.weekStart === '') {
      state.weekStart = currentWeekMonday();
    }
  } catch {
    return;
  }
  renderListPane(listPane, detailPane);
  await loadStatement(listPane, detailPane);
  startRefresh(() => { void loadStatement(listPane, detailPane); });
}

function currentWeekMonday(): string {
  const today = app.agency?.today ?? '';
  if (today === '') return '';
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay();
  const monday = new Date(Date.UTC(y, m - 1, d - (weekday === 0 ? 6 : weekday - 1)));
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
}

function renderListPane(listPane: HTMLElement, detailPane: HTMLElement): void {
  listPane.replaceChildren();
  const client = h('select', { 'aria-label': 'Client' }) as unknown as HTMLSelectElement;
  for (const contract of state.contracts) {
    client.append(h('option', { value: contract.org_id }, contract.org_name));
  }
  client.value = state.orgId;
  const week = h('input', { type: 'date', 'aria-label': 'Week starting', value: state.weekStart }) as HTMLInputElement;
  const showWeek = h('button', {}, 'Show week');
  showWeek.addEventListener('click', () => {
    state.orgId = client.value;
    state.weekStart = week.value;
    state.selectedLine = null;
    void loadStatement(listPane, detailPane);
  });
  const controls = h('div', { class: 'list-controls' });
  controls.append(client, week, showWeek);
  listPane.append(controls);
  const linesRegion = h('div', { class: 'rows', id: 'billing-lines' });
  listPane.append(linesRegion);
}

async function loadStatement(listPane: HTMLElement, detailPane: HTMLElement): Promise<void> {
  if (state.orgId === '' || state.weekStart === '') return;
  let statement: WeekStatement;
  try {
    statement = await api.call<WeekStatement>(
      `/api/billing/weeks/${encodeURIComponent(state.orgId)}/${state.weekStart}`,
      { tag: 'week-statement' },
    );
  } catch {
    return;
  }
  state.statement = statement;
  renderLines(listPane);
  renderDetail(detailPane);
}

function renderLines(listPane: HTMLElement): void {
  const container = listPane.querySelector('#billing-lines');
  if (container === null) return;
  container.replaceChildren();
  const table = h('table', { class: 'billing-table', 'aria-label': 'Invoice lines' });
  const thead = h('thead', {});
  const headRow = h('tr', {});
  for (const label of ['Line', 'Booking', 'Date', 'Billable time', 'Interpreters', 'Amount', 'Billing amount', 'Sync']) {
    headRow.append(h('th', {}, label));
  }
  thead.append(headRow);
  table.append(thead);
  const tbody = h('tbody', {});
  if (state.statement === null || state.statement.lines.length === 0) {
    const row = h('tr', {});
    row.append(h('td', { colspan: '8' }, `No invoice lines for this week.`));
    tbody.append(row);
  }
  for (const line of state.statement?.lines ?? []) {
    const row = h('tr', { 'data-line-ref': line.line_ref });
    if (line.line_ref === state.selectedLine) row.setAttribute('data-selected', 'true');
    row.addEventListener('click', () => {
      state.selectedLine = line.line_ref;
      renderLines(listPane);
      const pane = document.querySelector<HTMLElement>('.detail-pane');
      if (pane) renderDetail(pane);
    });
    row.append(h('td', { class: 'ref' }, line.line_ref));
    row.append(h('td', {}, line.booking_ref));
    row.append(h('td', { class: 'mono' }, line.assignment_date));
    row.append(h('td', { class: 'num' }, `${line.billable_minutes} min`));
    row.append(h('td', { class: 'num' }, String(line.interpreter_count)));
    row.append(h('td', { class: 'num' }, formatCents(line.amount_cents)));
    const billingCell = h('td', { class: 'num' }, line.billing_amount_cents === null ? '—' : formatCents(line.billing_amount_cents));
    row.append(billingCell);
    const syncCell = h('td', { class: 'sync-cell' }, line.sync_status === 'synced' ? 'Synced' : 'Pending sync');
    if (line.billing_amount_cents !== null && line.billing_amount_cents !== line.amount_cents) {
      syncCell.append(h('span', { class: 'differs' }, 'Differs'));
    }
    row.append(syncCell);
    tbody.append(row);
  }
  table.append(tbody);
  container.append(table);
}

function renderDetail(detailPane: HTMLElement): void {
  detailPane.replaceChildren();
  if (state.statement === null) return;
  const statement = state.statement;
  const breakdown = h('section', { class: 'panel', 'aria-label': 'Line breakdown' });
  breakdown.append(h('h3', {}, 'Line breakdown'));
  const selected = statement.lines.find((l) => l.line_ref === state.selectedLine) ?? statement.lines[0] ?? null;
  if (selected) {
    const rows = h('div', { class: 'facts' });
    const add = (key: string, value: string) => {
      const fact = h('div', { class: 'fact' });
      fact.append(h('span', { class: 'k' }, key));
      fact.append(h('span', { class: 'mono' }, value));
      rows.append(fact);
    };
    add('Line', selected.line_ref);
    add('Booking', selected.booking_ref);
    add('Kind', selected.kind === 'completed' ? 'Completed' : 'Late cancellation');
    add('Assignment date', selected.assignment_date);
    add('Rate effective from', selected.rate_effective_from);
    add('Hourly rate', formatCents(selected.hourly_rate_cents));
    add('Team surcharge', `${(selected.team_surcharge_bp / 100).toFixed(0)}%`);
    add('Basis minutes', `${selected.basis_minutes}`);
    add('Billable minutes', `${selected.billable_minutes}`);
    add('Interpreters', `${selected.interpreter_count}`);
    add('Time amount', formatCents(selected.time_amount_cents));
    add('Mileage', `${selected.mileage_miles} miles`);
    add('Mileage rate', `${selected.mileage_cents_per_mile} cents/mile`);
    add('Mileage amount', formatCents(selected.mileage_amount_cents));
    add('Amount', formatCents(selected.amount_cents));
    breakdown.append(rows);
  } else {
    breakdown.append(h('div', { class: 'empty-row' }, 'No line selected.'));
  }
  detailPane.append(breakdown);

  const totals = h('section', { class: 'panel', 'aria-label': 'Week totals' });
  totals.append(h('h3', {}, 'Week totals'));
  const totalText = statement.billing_total_cents === null
    ? `Relayline ${formatCents(statement.relayline_total_cents)} · billing not yet confirmed`
    : `Relayline ${formatCents(statement.relayline_total_cents)} · billing ${formatCents(statement.billing_total_cents)}`;
  totals.append(h('div', { class: 'totals-line' }, totalText));
  if (!statement.billing_reachable) {
    totals.append(h('div', { class: 'inline-status' }, 'Billing amounts are unavailable right now.'));
  }
  const closeWeek = h('button', {}, 'Close week');
  closeWeek.disabled = statement.status === 'closed';
  closeWeek.addEventListener('click', async () => {
    closeWeek.disabled = true;
    closeWeek.textContent = PENDING_COPY.closeWeek;
    announceStatus(PENDING_COPY.closeWeek);
    clearError();
    try {
      const closed = await api.call<WeekStatement>(
        `/api/billing/weeks/${encodeURIComponent(statement.org_id)}/${statement.week_start}/close`,
        { method: 'POST', tag: 'close-week' },
      );
      announceStatus(SUCCESS_COPY.closeWeek(closed.week_start, closed.org_name, closed.relayline_total_cents, closed.billing_total_cents ?? 0));
      const pane = document.querySelector<HTMLElement>('.detail-pane');
      state.statement = closed;
      if (pane) renderDetail(pane);
      const listPane = document.querySelector<HTMLElement>('.list-pane');
      if (listPane) renderLines(listPane);
    } catch (err) {
      closeWeek.disabled = false;
      closeWeek.textContent = 'Close week';
      if (err instanceof ApiFailure && err.code === 'total_mismatch') {
        const relayline = err.body.relayline_total_cents;
        const billing = err.body.billing_total_cents;
        announceError(`${ERROR_COPY.total_mismatch} Relayline ${formatCents(relayline ?? 0)}, billing ${formatCents(billing ?? 0)}.`);
        return;
      }
      if (err instanceof ApiFailure) {
        announceError(errorCopyFor(err));
        return;
      }
      announceError(ERROR_COPY.network);
    }
  });
  if (statement.status === 'closed') {
    totals.append(h('div', { class: 'inline-status' }, `Week closed.`));
  } else {
    totals.append(closeWeek);
  }
  detailPane.append(totals);

  // Contract rates panel.
  const contract = state.contracts.find((c) => c.org_id === state.orgId) ?? null;
  const rates = h('section', { class: 'panel', 'aria-label': 'Contract rates' });
  rates.append(h('h3', {}, 'Contract rates'));
  if (contract) {
    for (const rate of contract.rates) {
      const row = h('div', { class: 'seat-row' });
      row.append(h('span', { class: 'mono' }, rate.effective_from));
      row.append(h('span', { class: 'num mono' }, formatCents(rate.hourly_rate_cents)));
      row.append(h('span', { class: 'num mono' }, `${(rate.team_surcharge_bp / 100).toFixed(0)}%`));
      row.append(h('span', { class: 'num mono' }, `${rate.mileage_cents_per_mile}c`));
      rates.append(row);
    }
    const form = h('form', { 'aria-label': 'Add rate' });
    const from = h('input', { type: 'date', 'aria-label': 'Effective from' }) as HTMLInputElement;
    const hourly = h('input', { type: 'number', 'aria-label': 'Hourly rate (dollars)', step: '0.01', min: '0.01', max: '1000' }) as HTMLInputElement;
    const surcharge = h('input', { type: 'number', 'aria-label': 'Team surcharge (percent)', step: '1', min: '0', max: '100' }) as HTMLInputElement;
    const mileageRate = h('input', { type: 'number', 'aria-label': 'Mileage rate (cents per mile)', step: '1', min: '0', max: '1000' }) as HTMLInputElement;
    const addRate = h('button', { type: 'submit' }, 'Add rate');
    const error = h('div', { class: 'field-error' });
    form.append(from, hourly, surcharge, mileageRate, error, addRate);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      addRate.disabled = true;
      addRate.textContent = PENDING_COPY.addRate;
      announceStatus(PENDING_COPY.addRate);
      clearError();
      try {
        const updated = await api.call<Contract>(`/api/contracts/${encodeURIComponent(contract.id)}/rates`, {
          method: 'POST',
          body: {
            effective_from: from.value,
            hourly_rate_cents: Math.round(Number(hourly.value) * 100),
            team_surcharge_bp: Math.round(Number(surcharge.value) * 100),
            mileage_cents_per_mile: Number(mileageRate.value),
          },
          tag: 'add-rate',
        });
        announceStatus(SUCCESS_COPY.addRate(updated.rates[updated.rates.length - 1].effective_from));
        const index = state.contracts.findIndex((c) => c.id === contract.id);
        if (index !== -1) state.contracts[index] = updated;
        const pane = document.querySelector<HTMLElement>('.detail-pane');
        if (pane) renderDetail(pane);
      } catch (err) {
        addRate.disabled = false;
        addRate.textContent = 'Add rate';
        if (err instanceof ApiFailure && err.code === 'validation' && err.body.fields) {
          announceError(errorCopyFor(err));
          error.textContent = Object.values(err.body.fields)[0] ?? '';
          return;
        }
        if (err instanceof ApiFailure) {
          announceError(errorCopyFor(err));
          return;
        }
        announceError(ERROR_COPY.network);
      }
    });
    rates.append(form);
  }
  detailPane.append(rates);
}
