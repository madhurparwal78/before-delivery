// The window board: every window the analyst holds, filtered in place.

import { get } from '../api.js';
import { PHONE, currentBand, onBandChange } from '../breakpoints.js';
import { Dialog } from '../dialog.js';
import { announce, clear, el, liveRegion } from '../dom.js';
import { percent } from '../format.js';
import { linkTo, pushQuery, replaceQuery } from '../router.js';
import { countdown, sharedWindowsReask } from '../timers.js';

const STATES = [
  'Awaiting meters',
  'Reconciling',
  'In review',
  'Returned',
  'Cancelling',
  'Cancelled',
  'Signed',
  'Sealed',
  'Restated',
];

const TIMEOUT_COPY = 'REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST.';

export async function mount({ container, query }) {
  let state = STATES.includes(query.state) ? query.state : 'All';
  let windows = [];
  const body = el('tbody');
  const table = el('table', { 'aria-label': 'Window board' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Window' }),
        el('th', { scope: 'col', text: 'State' }),
        el('th', { scope: 'col', text: 'Month' }),
        el('th', { scope: 'col', text: 'Week' }),
        el('th', { scope: 'col', text: 'Day' }),
        el('th', { scope: 'col', text: 'Hour' }),
        el('th', { scope: 'col', text: 'Target' }),
        el('th', { scope: 'col', text: 'Review time' }),
      ]),
    ]),
    body,
  ]);
  const empty = el('p', { className: 'word', text: 'NO WINDOWS MATCH.', hidden: true });
  const filterButton = el('button', { type: 'button', text: 'Filter windows' });
  const panel = el('div', { className: 'panel stack' }, [
    el('h1', { text: 'YOUR WINDOWS.' }),
    filterButton,
    liveRegion('Board status', 'status'),
    el('div', { className: 'table-wrap' }, [table]),
    empty,
  ]);
  container.append(panel);

  const timers = new Map();

  function paint() {
    const shown = state === 'All' ? windows : windows.filter((row) => row.state === state);
    clear(body);
    timers.clear();
    shown.forEach((row) => {
      const link = linkTo(`/windows/${row.id}`, `${row.site.name} ${row.month}`);
      const timerCell = el('td', {});
      if (row.state === 'In review') {
        const timer = countdown({
          label: 'Review time left',
          seconds: row.review_seconds_left,
          reask: () => sharedWindowsReask(onReask),
        });
        timers.set(row.id, timer);
        timerCell.append(timer.node);
      }
      const stateCell = el('td', {}, [el('span', { text: row.state })]);
      if (row.state === 'Returned' && row.returned_reason === TIMEOUT_COPY) {
        stateCell.append(el('div', { className: 'outage', text: TIMEOUT_COPY }));
      }
      body.append(
        el('tr', {}, [
          el('td', {}, [link]),
          stateCell,
          el('td', { text: `${percent(row.scores.month_bp)}%` }),
          el('td', { text: `${percent(row.scores.week_bp)}%` }),
          el('td', { text: `${percent(row.scores.day_bp)}%` }),
          el('td', { text: `${percent(row.scores.hour_bp)}%` }),
          el('td', { text: row.target.met ? 'On target' : 'Off target' }),
          timerCell,
        ])
      );
    });
    empty.hidden = shown.length > 0;
    return shown.length;
  }

  function onReask(answer) {
    if (answer.status !== 200) return;
    windows = answer.data.windows;
    paint();
  }

  async function load() {
    const answer = await get('/api/windows');
    if (answer.status !== 200) return 0;
    windows = answer.data.windows;
    return paint();
  }

  await load();

  filterButton.addEventListener('click', () => {
    const sheet =
      currentBand() === PHONE ? 'dialog--sheet-bottom' : 'dialog--sheet-right';
    const dialog = new Dialog({ name: 'Filter windows', sheet });
    const stopWatching = onBandChange((next) => {
      dialog.setSheet(next === PHONE ? 'dialog--sheet-bottom' : 'dialog--sheet-right');
    });
    dialog.onClose = stopWatching;
    const select = el(
      'select',
      { 'aria-label': 'State', dataset: { field: 'state' } },
      ['All', ...STATES].map((word) =>
        el('option', { value: word, text: word, selected: word === state || null })
      )
    );
    select.value = state;
    const label = el('div', { className: 'field' }, [
      el('label', { for: 'field-state', text: 'State' }),
      select,
    ]);
    select.id = 'field-state';
    select.removeAttribute('aria-label');
    const apply = el('button', { type: 'button', text: 'Apply' });
    const close = el('button', { type: 'button', text: 'Close' });
    apply.addEventListener('click', () => {
      state = select.value;
      const count = paint();
      pushQuery(state === 'All' ? '/windows' : `/windows?state=${encodeURIComponent(state)}`);
      announce('Board status', `${count} windows shown.`);
      dialog.close();
    });
    close.addEventListener('click', () => dialog.close());
    dialog.bodyNode.append(label);
    dialog.buttonsNode.append(apply, close);
  });

  if (query.state && !STATES.includes(query.state)) replaceQuery('/windows');

  return {
    refresh: load,
    query(next) {
      state = STATES.includes(next.state) ? next.state : 'All';
      paint();
    },
  };
}
