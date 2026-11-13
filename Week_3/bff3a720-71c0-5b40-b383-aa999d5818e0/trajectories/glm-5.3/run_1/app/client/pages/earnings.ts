import { h, clear } from '../lib/els.js';
import { router } from '../lib/router.js';
import { api } from '../lib/api.js';
import { money, hhmm, shortDate } from '../lib/fmt.js';
import { store } from '../lib/store.js';
import type { EarningsRow } from '../lib/types.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export async function earningsPage(): Promise<HTMLElement> {
  const root = h('div');
  const parts = store.serverNow.slice(0, 7);
  const defaultMonth = parts;
  const month = /^\d{4}-\d{2}$/.test(router.query.get('month') ?? '') ? router.query.get('month')! : defaultMonth;

  const select = h('select', { class: 'field', 'aria-label': 'Month' }) as HTMLSelectElement;
  const [y0, m0] = defaultMonth.split('-').map(Number);
  for (let i = -3; i <= 3; i++) {
    const d = new Date(Date.UTC(y0, m0 - 1 + i, 1));
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const opt = h('option', { value: val }, `${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
    if (val === month) opt.setAttribute('selected', 'selected');
    select.append(opt);
  }
  select.addEventListener('change', () => { router.go('/earnings', { month: select.value }, true); void render(select.value); });

  const table = h('table');
  const render = async (m: string): Promise<void> => {
    clear(table);
    try {
      const data = await api<{ month: string; rows: EarningsRow[]; total_earned_cents: number }>('GET', `/api/driver/earnings?month=${m}`);
      const head = h('tr', null,
        h('th', { scope: 'col' }, 'Departure'), h('th', { scope: 'col' }, 'From'), h('th', { scope: 'col' }, 'To'),
        h('th', { scope: 'col' }, 'Passenger'), h('th', { scope: 'col' }, 'Seats'), h('th', { scope: 'col' }, 'Paid'),
        h('th', { scope: 'col' }, 'Refunded'), h('th', { scope: 'col' }, 'Earned'), h('th', { scope: 'col' }, 'Status'));
      const thead = h('thead', null, head);
      const tbody = h('tbody');
      for (const r of data.rows) {
        tbody.append(h('tr', { 'data-id': r.booking_id },
          h('td', { 'data-label': 'Departure' }, `${shortDate(r.departure)} ${hhmm(r.departure)}`),
          h('td', { 'data-label': 'From' }, r.from),
          h('td', { 'data-label': 'To' }, r.to),
          h('td', { 'data-label': 'Passenger' }, r.passenger),
          h('td', { 'data-label': 'Seats' }, String(r.seats)),
          h('td', { 'data-label': 'Paid' }, money(r.paid_cents)),
          h('td', { 'data-label': 'Refunded' }, money(r.refunded_cents)),
          h('td', { 'data-label': 'Earned' }, money(r.earned_cents)),
          h('td', { 'data-label': 'Status' }, r.status.replace(/_/g, ' ')),
        ));
      }
      if (data.rows.length === 0) {
        root.querySelector('.empty');
      }
      tbody.append(h('tr', { class: 'total' }, h('td', { colspan: '7', 'data-label': '' }, 'Total earned'), h('td', { 'data-label': 'Total earned' }, money(data.total_earned_cents)), h('td')));
      table.append(thead, tbody);
      const empty = root.querySelector('.earnings-empty');
      if (empty) empty.textContent = data.rows.length === 0 ? 'No bookings on rides in this month.' : '';
    } catch {
      table.append(h('tbody', null, h('tr', null, h('td', null, 'You do not have access to this.'))));
    }
  };

  const csvLink = h('a', { class: 'btn', href: `/api/driver/earnings.csv?month=${month}`, download: '' }, 'Export earnings CSV');

  root.append(
    h('h1', null, 'Earnings'),
    h('p', null, select),
    h('p', { class: 'earnings-empty' }, ''),
    table,
    h('p', null, csvLink),
  );
  table.setAttribute('aria-label', 'Earnings');
  await render(month);
  return root;
}
