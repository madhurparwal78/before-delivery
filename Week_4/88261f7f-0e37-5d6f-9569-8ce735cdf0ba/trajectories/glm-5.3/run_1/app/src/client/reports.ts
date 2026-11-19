import { ApiRequest, errorText } from './api.js';
import { el, status } from './ui.js';
import type { App } from './main.js';
import { navigate } from './main.js';
import type { ReportData } from './types.js';
import { formatMoney } from './types.js';

export async function renderReports(app: App): Promise<void> {
  const fromInput = el('input', { type: 'text', 'aria-label': 'From' }) as HTMLInputElement;
  const toInput = el('input', { type: 'text', 'aria-label': 'To' }) as HTMLInputElement;
  const showBtn = el('button', { text: 'Show figures' }) as HTMLButtonElement;

  const roomsAvailable = status('—');
  const roomsSold = status('—');
  const roomRevenue = status('—');
  const occupancy = status('—');
  const adr = status('—');
  const revpar = status('—');
  for (const [node, label] of [[roomsAvailable, 'Rooms available'], [roomsSold, 'Rooms sold'], [roomRevenue, 'Room revenue'],
    [occupancy, 'Occupancy'], [adr, 'Average daily rate'], [revpar, 'Revenue per available room']] as Array<[HTMLElement, string]>) {
    node.setAttribute('role', 'status');
    node.setAttribute('aria-label', label);
  }

  const nightlyWrap = el('div', {});

  const load = async () => {
    if (!fromInput.value || !toInput.value) return;
    const res = await ApiRequest.get(`/api/reports?from=${fromInput.value}&to=${toInput.value}`);
    if (res.status !== 200) return;
    const data = res.data as ReportData;
    roomsAvailable.textContent = String(data.roomsAvailable);
    roomsSold.textContent = String(data.roomsSold);
    roomRevenue.textContent = formatMoney(data.roomRevenueCents);
    occupancy.textContent = data.occupancy;
    adr.textContent = data.averageDailyRate;
    revpar.textContent = data.revenuePerAvailableRoom;
    const table = el('table', { class: 'data', 'aria-label': 'Nightly figures' });
    table.append(el('thead', {}, el('tr', {},
      el('th', { text: 'Date' }), el('th', { class: 'num', text: 'Rooms available' }), el('th', { class: 'num', text: 'Rooms sold' }),
      el('th', { class: 'num', text: 'Room revenue' }), el('th', { class: 'num', text: 'Occupancy' }),
      el('th', { class: 'num', text: 'Average daily rate' }), el('th', { class: 'num', text: 'Revenue per available room' }))));
    for (const night of data.nights) {
      table.append(el('tr', {},
        el('td', { text: night.date }),
        el('td', { class: 'num', text: String(night.roomsAvailable) }),
        el('td', { class: 'num', text: String(night.roomsSold) }),
        el('td', { class: 'num', text: formatMoney(night.roomRevenueCents) }),
        el('td', { class: 'num', text: night.occupancy }),
        el('td', { class: 'num', text: night.averageDailyRate }),
        el('td', { class: 'num', text: night.revenuePerAvailableRoom })));
    }
    nightlyWrap.replaceChildren(table);
  };

  showBtn.addEventListener('click', load);

  const signOutBtn = el('button', { text: 'Sign out' });
  signOutBtn.addEventListener('click', async () => {
    await ApiRequest.del('/api/session');
    app.user = null;
    navigate('/');
  });
  const nav = el('nav', { 'aria-label': 'Main' });
  for (const [label, path, roles] of [
    ['Desk', '/desk', ['owner']],
    ['Guests', '/guests', ['owner', 'front_desk']],
    ['Rates', '/rates', ['owner']],
    ['Reports', '/reports', ['owner']],
    ['Board', '/board', ['owner', 'front_desk', 'housekeeper']]
  ] as Array<[string, string, string[]]>) {
    if (!app.user || !roles.includes(app.user.role)) continue;
    const a = el('a', { href: path, text: label });
    if (window.location.pathname === path) a.classList.add('current');
    a.addEventListener('click', ev => { ev.preventDefault(); navigate(path); });
    nav.append(a);
  }

  const content = el('div', { class: 'two-col' },
    el('div', {},
      el('h1', { text: 'Reports' }),
      el('div', { class: 'form-row' }, el('label', { text: 'From' }), fromInput),
      el('div', { class: 'form-row' }, el('label', { text: 'To' }), toInput),
      el('div', {}, showBtn)),
    el('div', {},
      el('div', {},
        el('div', {}, el('b', { text: 'Rooms available ' }), roomsAvailable),
        el('div', {}, el('b', { text: 'Rooms sold ' }), roomsSold),
        el('div', {}, el('b', { text: 'Room revenue ' }), roomRevenue),
        el('div', {}, el('b', { text: 'Occupancy ' }), occupancy),
        el('div', {}, el('b', { text: 'Average daily rate ' }), adr),
        el('div', {}, el('b', { text: 'Revenue per available room ' }), revpar)),
      el('h2', { text: 'Nightly figures' }),
      nightlyWrap));
  app.root.replaceChildren(el('div', {},
    el('div', { class: 'topbar' }, el('span', { class: 'brand', text: 'Nightroll' }), nav,
      el('span', { class: 'spacer' }), el('span', { text: app.user?.name ?? '' }), signOutBtn),
    el('main', {}, content)));

  // default range starts on the business date for both fields
  const deskRes = await ApiRequest.get('/api/desk');
  if (deskRes.status === 200) {
    const bd = deskRes.data.hotel.businessDate;
    fromInput.value = bd;
    toInput.value = bd;
    await load();
  }
  app.refreshReports = load;
}
