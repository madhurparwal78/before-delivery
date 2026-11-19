import { setAlert } from '../announce.js';
import { api } from '../api.js';
import { copy } from '../copy.js';
import { clear, h } from '../dom.js';
import { MONTHS_LONG } from '../../shared/format.js';
import { money } from '../../shared/format.js';
import { plate } from '../plates.js';
import { connectLive } from '../live.js';
import { navigate, onLeave, replaceQuery, type RouteContext } from '../router.js';
import { mainRegion } from '../shell.js';
import { currentMember, serverToday } from '../state.js';
import { combobox } from '../components/combobox.js';
import type { EarningsRow } from '../types.js';

interface EarningsBody {
  month: string;
  rows: EarningsRow[];
  total_earned_cents: number;
}

function monthLabel(month: string): string {
  const [year, index] = month.split('-');
  return `${MONTHS_LONG[Number(index) - 1]} ${year}`;
}

function monthOptions(): string[] {
  const today = serverToday();
  const year = Number(today.slice(0, 4));
  const index = Number(today.slice(5, 7));
  const months: string[] = [];
  for (let offset = -6; offset <= 6; offset += 1) {
    const total = year * 12 + index - 1 + offset;
    months.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`);
  }
  return months;
}

export function renderEarnings(ctx: RouteContext): void {
  const main = mainRegion();
  clear(main);
  if (!currentMember()) {
    navigate('/sign-in?next=%2Fearnings');
    return;
  }
  let month = ctx.query.get('month') ?? serverToday().slice(0, 7);
  const tableBox = h('div', { class: 'earnings-box' });
  const slot = h('div', { class: 'alert-slot' });

  const chooser = combobox({
    label: 'Month',
    value: monthLabel(month),
    choices: () => monthOptions().map(monthLabel),
    onSelect: (label) => {
      const found = monthOptions().find((candidate) => monthLabel(candidate) === label);
      if (!found) return;
      month = found;
      replaceQuery(`/earnings?month=${month}`);
      void load();
    },
  });

  const exportLink = h('a', {
    class: 'secondary',
    text: 'Export earnings CSV',
    download: '',
  });

  const paint = (body: EarningsBody) => {
    clear(tableBox);
    if (body.rows.length === 0) {
      tableBox.append(
        plate({
          seed: `earnings-${body.month}`,
          leg: 'Tollemarch to Corrandy',
          kind: 'ferry',
          ratio: 1,
          className: 'plate-empty',
        }),
        h('p', { class: 'empty-line', text: copy.emptyEarnings }),
      );
      return;
    }
    const table = h('table', { 'aria-label': 'Earnings', class: 'table' });
    const head = h('tr', {});
    for (const column of [
      'Departure',
      'From',
      'To',
      'Passenger',
      'Seats',
      'Paid',
      'Refunded',
      'Earned',
      'Status',
    ]) {
      head.appendChild(h('th', { scope: 'col', text: column }));
    }
    table.appendChild(h('thead', {}, head));
    const body_ = h('tbody', {});
    for (const row of body.rows) {
      const tr = h('tr', { 'data-id': row.booking_id });
      const cells: Array<[string, string]> = [
        ['Departure', row.departure],
        ['From', row.from],
        ['To', row.to],
        ['Passenger', row.passenger],
        ['Seats', String(row.seats)],
        ['Paid', money(row.paid_cents)],
        ['Refunded', money(row.refunded_cents)],
        ['Earned', money(row.earned_cents)],
        ['Status', row.status],
      ];
      for (const [label, value] of cells) {
        tr.appendChild(h('td', { 'data-label': label, text: value }));
      }
      body_.appendChild(tr);
    }
    table.appendChild(body_);
    table.appendChild(
      h(
        'tfoot',
        {},
        h(
          'tr',
          { class: 'totals' },
          h('td', {
            colspan: '9',
            text: `Total earned ${money(body.total_earned_cents)}`,
          }),
        ),
      ),
    );
    tableBox.appendChild(table);
  };

  const load = async () => {
    exportLink.setAttribute('href', `/api/driver/earnings.csv?month=${month}`);
    const result = await api<EarningsBody>('GET', `/api/driver/earnings?month=${month}`);
    if (!result.ok) {
      setAlert(slot, result.failure.message);
      clear(tableBox);
      return;
    }
    setAlert(slot, null);
    paint(result.data);
  };

  main.append(
    h('h1', { text: 'Earnings' }),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Month' }), chooser.element),
    tableBox,
    exportLink,
    slot,
  );
  void load();

  const connection = connectLive({
    onHello: () => void load(),
    onEvent: () => void load(),
  });
  onLeave(() => connection.close());
}
