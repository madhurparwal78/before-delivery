// The wall list: sites table and the new site form (DP-06, DP-01).

import { h, clear, announce, showProblem, hideProblem, statusRegion, fieldError } from './ui.js';
import { api, idempotencyKey, formatCents } from './app.js';
import { route } from './main.js';
import { COPY } from './ui.js';

const LENGTH_UNITS = ['m', 'ft'];

export async function renderWallList(shell, band) {
  const sites = await api.get('/api/sites');
  shell.append(nav('/sites'));
  const heading = h('h1', { class: 'sentence' });
  const slot = h('span', { class: 'slot', 'aria-hidden': 'true' }, wallFragment(sites.items[0]));
  const count = sites.items.length;
  heading.append(`${count === 1 ? '1 WALL ON FILE' : `${count} WALLS ON FILE`}`, slot);
  shell.append(heading);

  const evidence = h('div', { class: 'two-col' });
  const table = h('table', { 'aria-label': 'Walls' });
  const head = h('thead', {}, h('tr', {}, h('th', {}, 'Site'), h('th', {}, 'Wall'), h('th', {}, 'Cells'), h('th', {}, 'Rectified'), h('th', {}, 'Stale')));
  const body = h('tbody');
  for (const site of sites.items) {
    const target = site.rectified
      ? `/sites/${site.id}/layouts/${site.layouts[0].id}`
      : `/sites/${site.id}/survey`;
    body.append(h('tr', {},
      h('td', {}, h('a', { href: target, 'data-link': '' }, site.name)),
      h('td', {}, `${site.widthMetres} x ${site.heightMetres} m`),
      h('td', {}, `${site.columns} x ${site.rows}`),
      h('td', {}, site.rectified ? `to ${site.residualMetres} m` : 'no'),
      h('td', {}, site.stale ? COPY.stale : 'no')));
  }
  table.append(head, body);

  const nameError = fieldError('site-name-error', null);
  const widthError = fieldError('site-width-error', null);
  const heightError = fieldError('site-height-error', null);
  const showError = fieldError('site-show-error', null);
  const status = statusRegion('Sites');

  const name = h('input', { type: 'text', 'aria-label': 'Site name', id: 'site-name' });
  const width = h('input', { type: 'text', 'aria-label': 'Wall width', id: 'wall-width', placeholder: '12,5' });
  const widthUnit = h('select', { 'aria-label': 'Length unit', id: 'wall-width-unit' }, LENGTH_UNITS.map((unit) => h('option', { value: unit }, unit)));
  const height = h('input', { type: 'text', 'aria-label': 'Wall height', id: 'wall-height', placeholder: '8' });
  const heightUnit = h('select', { 'aria-label': 'Length unit', id: 'wall-height-unit' }, LENGTH_UNITS.map((unit) => h('option', { value: unit }, unit)));
  const showAt = h('input', { type: 'text', 'aria-label': 'Show time', id: 'show-time', placeholder: '2027-02-12T19:30' });
  const save = h('button', { type: 'submit' }, 'Save site');

  const form = h('form', {
    'aria-label': 'New site',
    onsubmit: async (event) => {
      event.preventDefault();
      hideProblem(band);
      for (const error of [nameError, widthError, heightError, showError]) {
        error.hidden = true;
        clear(error);
      }
      const body = {
        name: name.value,
        width: { text: width.value, unit: widthUnit.value },
        height: { text: height.value, unit: heightUnit.value },
        showAtLocal: showAt.value,
      };
      try {
        const created = await api.post('/api/sites', body, { headers: { 'Idempotency-Key': idempotencyKey('site', name.value + width.value + height.value) } });
        route(`/sites/${created.id}/survey`);
      } catch (err) {
        const problem = err.problem ?? err;
        if (problem.errors) {
          for (const [pointer, copy] of Object.entries(problem.errors)) {
            const target = pointer.startsWith('/width') ? widthError : pointer.startsWith('/height') ? heightError : pointer.startsWith('/show') ? showError : nameError;
            target.textContent = copy;
            target.hidden = false;
          }
        } else {
          showProblem(band, problem);
        }
      }
    },
  },
    h('div', {}, h('label', { for: 'site-name' }, 'Site name'), name, nameError),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('label', { for: 'wall-width' }, 'Wall width'), width, widthError),
      h('div', {}, h('label', { for: 'wall-width-unit' }, 'Length unit'), widthUnit)),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('label', { for: 'wall-height' }, 'Wall height'), height, heightError),
      h('div', {}, h('label', { for: 'wall-height-unit' }, 'Length unit'), heightUnit)),
    h('div', {}, h('label', { for: 'show-time' }, 'Show time'), showAt, showError),
    save, status);

  evidence.append(h('div', {}, table), h('div', {}, form));
  shell.append(evidence);
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

function wallFragment(site) {
  if (!site) return 'no wall yet';
  return `${site.widthMetres} m x ${site.heightMetres} m`;
}
