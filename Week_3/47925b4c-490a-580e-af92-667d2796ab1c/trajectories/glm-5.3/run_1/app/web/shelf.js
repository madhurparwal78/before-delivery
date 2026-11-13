// The shelf: kit table, movement form, history and show hours (DP-13 to DP-17).

import { h, clear, announce, showProblem, hideProblem, statusRegion, fieldError, COPY } from './ui.js';
import { api, idempotencyKey } from './app.js';
import { route } from './main.js';

const MOVEMENTS = [
  { value: 'bought', label: 'Bought' },
  { value: 'sent_to_site', label: 'Sent to site' },
  { value: 'returned', label: 'Returned' },
  { value: 'retired', label: 'Retired' },
];

export async function renderShelf(shell, band) {
  const shelf = await api.get('/api/kit/shelf');
  shell.append(nav('/kit'));

  const heading = h('h1', { class: 'sentence' });
  const slot = h('span', { class: 'slot', 'aria-hidden': 'true' }, `${shelf.freeBodies} free`);
  heading.append(
    shelf.freeBodies === 1 ? 'THE SHELF HOLDS 1 FREE BODY' : `THE SHELF HOLDS ${shelf.freeBodies} FREE BODIES`,
    slot);
  shell.append(heading);

  const evidence = h('div', { class: 'two-col' });
  const left = h('div');
  const right = h('div');

  const table = h('table', { 'aria-label': 'Kit' });
  table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Serial'), h('th', {}, 'Model'), h('th', {}, 'Location'), h('th', {}, 'Hours'), h('th', {}, 'Lumens'), h('th', {}, 'Free'))));
  const body = h('tbody');
  for (const item of shelf.items) {
    body.append(h('tr', {},
      h('td', {}, item.serial),
      h('td', {}, item.model),
      h('td', {}, item.location),
      h('td', {}, item.loggedHours),
      h('td', {}, item.effectiveLumens === null ? '—' : String(item.effectiveLumens)),
      h('td', {}, item.free ? 'free' : 'busy')));
  }
  table.append(body);
  left.append(table);

  const kitStatus = statusRegion('Kit');
  const movement = h('select', { 'aria-label': 'Movement' }, MOVEMENTS.map((m) => h('option', { value: m.value }, m.label)));
  const serial = h('input', { type: 'text', 'aria-label': 'Serial', placeholder: 'NW-B06' });
  const model = h('input', { type: 'text', 'aria-label': 'Model', placeholder: 'VK-20' });
  const hours = h('input', { type: 'text', 'aria-label': 'Starting hours', placeholder: '0' });
  const destination = h('select', { 'aria-label': 'Destination site' });
  const sites = await api.get('/api/sites');
  for (const site of sites.items) destination.append(h('option', { value: site.id }, site.name));

  const moveError = fieldError('movement-error', null);
  const moveForm = h('form', {
    'aria-label': 'Record a movement',
    onsubmit: async (event) => {
      event.preventDefault();
      hideProblem(band);
      clear(kitStatus);
      moveError.hidden = true;
      const input = { kind: movement.value, serial: serial.value };
      if (movement.value === 'bought') input.model = model.value;
      if (movement.value === 'sent_to_site') input.siteId = destination.value;
      if (movement.value === 'bought' && hours.value !== '') input.loggedHours = hours.value;
      try {
        await api.post('/api/kit/movements', input, { headers: { 'Idempotency-Key': idempotencyKey('move', movement.value + serial.value + Date.now()) } });
        announce(kitStatus, COPY.kitSuccess);
        route('/kit');
      } catch (err) {
        showProblem(band, err.problem ?? err);
      }
    },
  },
    h('div', {}, h('label', {}, 'Movement'), movement),
    h('div', {}, h('label', {}, 'Serial'), serial),
    h('div', {}, h('label', {}, 'Model (for Bought)'), model),
    h('div', {}, h('label', {}, 'Starting hours (optional)'), hours),
    h('div', {}, h('label', {}, 'Destination site'), destination),
    h('button', { type: 'submit' }, 'Record movement'), kitStatus, moveError);
  right.append(moveForm);

  // movement history with keyset pagination
  const history = h('table', { 'aria-label': 'Movement history' });
  history.append(h('thead', {}, h('tr', {}, h('th', {}, 'At'), h('th', {}, 'Serial'), h('th', {}, 'Kind'), h('th', {}, 'From'), h('th', {}, 'To'), h('th', {}, ''))));
  const historyBody = h('tbody');
  history.append(historyBody);
  let cursor = null;
  const older = h('button', { onclick: async () => {
    const page = await api.get(`/api/kit/movements?limit=20${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
    for (const item of page.items) {
      const reverseButton = h('button', {
        onclick: async () => {
          hideProblem(band);
          try {
            await api.post(`/api/kit/movements/${item.id}/reverse`, {}, { headers: { 'Idempotency-Key': idempotencyKey('reverse', item.id) } });
            route('/kit');
          } catch (err) {
            showProblem(band, err.problem ?? err);
          }
        },
      }, `Reverse ${item.id}`);
      historyBody.append(h('tr', {},
        h('td', {}, item.at.replace('T', ' ').slice(0, 16)),
        h('td', {}, item.serial),
        h('td', {}, item.kind),
        h('td', {}, item.entries[0]?.location ?? ''),
        h('td', {}, item.entries[1]?.location ?? ''),
        h('td', {}, reverseButton)));
    }
    cursor = page.nextCursor;
    if (cursor === null) older.hidden = true;
  } }, 'Older movements');
  older.click();

  // show hours form
  const hoursStatus = statusRegion('Hours');
  const bodySerial = h('select', { 'aria-label': 'Body serial' }, shelf.items.filter((i) => i.kind === 'body').map((i) => h('option', { value: i.serial }, i.serial)));
  const showHours = h('input', { type: 'text', 'aria-label': 'Show hours', placeholder: '12,5' });
  const hoursForm = h('form', {
    'aria-label': 'Log show hours',
    onsubmit: async (event) => {
      event.preventDefault();
      hideProblem(band);
      try {
        await api.post(`/api/kit/bodies/${bodySerial.value}/hours`, { hours: showHours.value }, { headers: { 'Idempotency-Key': idempotencyKey('hours', bodySerial.value + showHours.value) } });
        route('/kit');
      } catch (err) {
        showProblem(band, err.problem ?? err);
      }
    },
  },
    h('div', {}, h('label', {}, 'Body serial'), bodySerial),
    h('div', {}, h('label', {}, 'Show hours'), showHours),
    h('button', { type: 'submit' }, 'Log hours'), hoursStatus);
  right.append(hoursForm);

  evidence.append(left, right);
  shell.append(evidence);
  shell.append(h('div', {}, history, h('div', { class: 'row' }, older)));
}

function nav(current) {
  const links = [
    { href: '/sites', label: 'Walls' },
    { href: '/kit', label: 'Shelf' },
    { href: '/hire', label: 'Hire' },
  ];
  return h('nav', { class: 'landmark', 'aria-label': 'Workspace' },
    links.map((link) => h('a', { href: link.href, 'data-link': '', 'aria-current': link.href === current ? 'page' : null }, link.label)));
}
