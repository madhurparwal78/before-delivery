// My bookings and the public PNR status lookup.

import { api, ApiFail } from './api.js';
import { el, setStatus, currentAccount, loadAccount, setAlert, clearAlert } from './ui.js';
import { renderShell, setTitle, lucideIcon } from './shell.js';
import { stampWords } from './format.js';

export async function renderMyBookings(): Promise<void> {
  setTitle('My bookings');
  const account = currentAccount() ?? (await loadAccount());
  if (!account) {
    location.href = `/signin?next=${encodeURIComponent(location.pathname)}`;
    return;
  }
  const main = el('main', { id: 'main' });
  renderShell(main);
  const h1 = el('h1', {}, 'My bookings');
  h1.appendChild(lucideIcon('ticket'));
  main.appendChild(h1);
  try {
    const d = await api<{ bookings: { pnr: string; train: { number: string; name: string }; run_date: string; from: string; to: string; class: string; state: string; summary: string }[] }>(
      'GET', '/api/bookings',
    );
    const list = el('ul', { 'aria-label': 'My bookings', class: 'plain' });
    for (const b of d.bookings) {
      const li = el('li');
      const a = el('a', { href: `/bookings/${b.pnr}` }, `PNR ${b.pnr}`);
      li.appendChild(a);
      li.appendChild(el('span', { class: 'small' },
        ` — ${b.train.number} ${b.train.name} · ${b.run_date} · ${b.from} to ${b.to} · ${b.class} · ${b.summary}`));
      list.appendChild(li);
    }
    if (d.bookings.length === 0) {
      main.appendChild(el('p', {}, 'No bookings yet.'));
    }
    main.appendChild(list);
  } catch (e) {
    if (e instanceof ApiFail && e.status === 401) {
      location.href = `/signin?next=${encodeURIComponent(location.pathname)}`;
      return;
    }
    throw e;
  }
}

export async function renderPnrStatus(initialPnr: string | null): Promise<void> {
  setTitle('PNR status');
  const main = el('main', { id: 'main' });
  renderShell(main);
  main.appendChild(el('h1', {}, 'PNR status'));

  const form = el('form', { class: 'search-form', novalidate: 'novalidate' });
  const input = el('input', { type: 'text', id: 'pnr-input', value: initialPnr ?? '', inputmode: 'numeric', maxlength: '10', pattern: '[1-9][0-9]{9}' });
  input.setAttribute('aria-label', 'PNR number');
  const label = el('label', { for: 'pnr-input' }, 'PNR number');
  form.appendChild(label);
  form.appendChild(input);
  const btn = el('button', { class: 'btn-primary', type: 'submit' }, 'Check status');
  form.appendChild(btn);
  main.appendChild(form);

  const statusHost = el('div', { class: 'status-line' });
  statusHost.setAttribute('role', 'status');
  statusHost.setAttribute('aria-label', 'PNR lookup');
  statusHost.setAttribute('data-status', 'PNR lookup');
  main.appendChild(statusHost);

  const resultHost = el('div', {});
  main.appendChild(resultHost);

  const lookup = async (pnr: string) => {
    clearAlert('PNR lookup');
    if (!/^[1-9]\d{9}$/.test(pnr)) {
      setStatus('PNR lookup', `No booking has PNR ${pnr}.`);
      return;
    }
    try {
      const d = await api<{
        pnr: string; train: { number: string; name: string }; run_date: string;
        from: string; to: string; class: string; chart_prepared: boolean;
        passengers: { number: number; booking_status: string; current_status: string }[];
      }>('GET', `/api/pnr/${pnr}`);
      resultHost.innerHTML = '';
      const table = el('div', { class: 'pnr-table' });
      const tbl = el('table');
      tbl.setAttribute('aria-label', 'PNR status');
      const thead = el('thead');
      const headRow = el('tr');
      for (const col of ['Passenger', 'Booking status', 'Current status']) {
        headRow.appendChild(el('th', { scope: 'col' }, col));
      }
      thead.appendChild(headRow);
      tbl.appendChild(thead);
      const tbody = el('tbody');
      for (const p of d.passengers) {
        const row = el('tr');
        const tdP = el('td', { 'data-col': 'Passenger' }, `Passenger ${p.number}`);
        const tdB = el('td', { 'data-col': 'Booking status' }, p.booking_status);
        const tdC = el('td', { 'data-col': 'Current status' }, p.current_status);
        row.appendChild(tdP);
        row.appendChild(tdB);
        row.appendChild(tdC);
        tbody.appendChild(row);
      }
      tbl.appendChild(tbody);
      table.appendChild(tbl);
      resultHost.appendChild(table);
      setStatus('PNR lookup', '');
    } catch (e) {
      if (e instanceof ApiFail && e.status === 404) {
        resultHost.innerHTML = '';
        setStatus('PNR lookup', `No booking has PNR ${pnr}.`);
      }
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const pnr = input.value.trim();
    history.replaceState(null, '', pnr ? `/pnr/${pnr}` : '/pnr');
    void lookup(pnr);
  });

  if (initialPnr) await lookup(initialPnr);
}

export function renderPageNotFound(): void {
  setTitle('Page not found');
  const main = el('main', { id: 'main' });
  renderShell(main);
  main.appendChild(el('h1', {}, 'Page not found'));
  main.appendChild(el('p', {}, 'The page you asked for does not exist.'));
}

export function renderBookingNotFound(): void {
  setTitle('Booking not found');
  const main = el('main', { id: 'main' });
  renderShell(main);
  main.appendChild(el('h1', {}, 'Booking not found'));
  main.appendChild(el('p', {}, 'This booking does not exist.'));
  void setAlert;
}
