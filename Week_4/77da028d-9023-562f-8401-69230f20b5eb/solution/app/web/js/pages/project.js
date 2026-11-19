import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { announce, liveRegion } from '../core/live.js';
import { createDialog } from '../core/dialog.js';
import { duration, FILTERS, stateWord } from '../core/format.js';
import { mountShell } from '../shell.js';
import { openShareDialog } from './project-share.js';
import { parseNumber } from './values.js';

const STATE_ACTIONS = {
  draft: [['Activate', 'active'], ['Archive', 'archived']],
  active: [['Pause', 'paused'], ['Mark complete', 'complete']],
  paused: [['Resume', 'active']],
  complete: [['Archive', 'archived']],
  archived: [],
};

const CLOSED = new Set(['complete', 'archived']);

function ledgerRow(entry) {
  return h('tr', {},
    h('td', { class: 'num' }, entry.movement_id.slice(0, 8)),
    h('td', {}, entry.movement_kind),
    h('td', {}, entry.filter),
    h('td', {}, entry.account),
    h('td', { class: 'num' }, String(entry.seconds)),
    h('td', { class: 'num' }, `${entry.created_at.slice(0, 16).replace('T', ' ')} UTC`));
}

async function openLedger(projectId, opener) {
  const { entries } = await api('GET', `/api/projects/${projectId}/ledger`);
  const sheet = createDialog({ name: 'Ledger', sheet: true });
  sheet.body.append(h('div', { class: 'table-scroll' },
    h('table', { 'aria-label': 'Ledger' },
      h('thead', {}, h('tr', {}, ['Movement', 'Kind', 'Filter', 'Account', 'Seconds', 'Time'].map((label) => h('th', {}, label)))),
      h('tbody', {}, entries.map(ledgerRow)))));
  sheet.actions.append(h('button', { type: 'button', class: 'btn', onclick: () => sheet.close() }, 'Close'));
  sheet.open(opener);
}

export async function mount({ params }) {
  const { main } = mountShell({ page: 'projects' });
  const projectId = params.id;
  let project = await api('GET', `/api/projects/${projectId}`);

  const updatesHome = h('div', { class: 'live-home' });
  const updates = liveRegion('Project updates');
  updatesHome.append(updates);
  const title = h('h1', { tabindex: '-1' });
  const stateChip = h('span', { class: 'chip' });
  const targetLine = h('p', { class: 'muted' });
  const stateButtons = h('div', { class: 'button-row' });
  const tbody = h('tbody');
  const total = h('p', { class: 'total-figure num' });
  const addFilter = h('select', { id: 'add-filter', 'aria-label': 'Add filter' },
    h('option', { value: '' }, 'Add a filter'), FILTERS.map((filter) => h('option', { value: filter }, filter)));
  const rows = new Map();

  function paintHeader() {
    title.textContent = project.name;
    stateChip.textContent = stateWord(project.state);
    targetLine.textContent = project.target_name;
    document.title = `${project.name} - Darkframe`;
    stateButtons.replaceChildren(...STATE_ACTIONS[project.state].map(([label, to]) =>
      h('button', { type: 'button', class: 'btn', onclick: () => transition(to) }, label)));
  }

  function ensureRow(filter) {
    if (rows.has(filter)) return rows.get(filter);
    const planned = h('input', {
      type: 'number', min: '0', max: '60000', step: '1', value: '0', 'aria-label': `Planned minutes ${filter}`,
      onchange: () => savePlanned(filter, planned),
    });
    const logged = h('td', { class: 'num' });
    const owed = h('td', { class: 'num' });
    const row = h('tr', { 'data-filter': filter }, h('td', {}, filter), h('td', {}, planned, h('span', { class: 'unit' }, ' min')), logged, owed);
    const entry = { row, planned, logged, owed };
    rows.set(filter, entry);
    const next = FILTERS.slice(FILTERS.indexOf(filter) + 1).map((later) => rows.get(later)).find(Boolean);
    tbody.insertBefore(row, next ? next.row : null);
    return entry;
  }

  function paintTable() {
    const closed = CLOSED.has(project.state);
    for (const figures of project.filters) {
      const entry = ensureRow(figures.filter);
      if (document.activeElement !== entry.planned) entry.planned.value = String(figures.planned_seconds / 60);
      entry.logged.textContent = duration(figures.logged_seconds);
      entry.owed.textContent = duration(figures.owed_seconds);
    }
    for (const entry of rows.values()) entry.planned.disabled = closed;
    total.textContent = `${duration(project.total_integration_seconds)} total`;
    addFilter.disabled = closed;
  }

  async function savePlanned(filter, input) {
    const minutes = parseNumber(input.value);
    const current = project.filters.find((figures) => figures.filter === filter);
    const restore = () => { input.value = String((current ? current.planned_seconds : 0) / 60); };
    if (minutes === null) { restore(); return; }
    try {
      project = await api('PUT', `/api/projects/${projectId}/allotments/${filter}`, {
        body: { planned_seconds: typeof minutes === 'number' ? minutes * 60 : minutes },
      });
      const figures = project.filters.find((row) => row.filter === filter) || { planned_seconds: 0, owed_seconds: 0 };
      paintTable();
      announce(updates, `Planned ${filter} set to ${duration(figures.planned_seconds)}. Owed now ${duration(figures.owed_seconds)}.`);
    } catch (error) {
      restore();
      announce(updates, error.message);
    }
  }

  async function transition(to) {
    try {
      project = await api('POST', `/api/projects/${projectId}/transition`, { body: { to } });
      paintHeader();
      paintTable();
      announce(updates, `Project is now ${project.state}.`);
      (stateButtons.querySelector('button') || title).focus();
    } catch (error) {
      announce(updates, error.message);
    }
  }

  addFilter.addEventListener('change', () => {
    const filter = addFilter.value;
    if (!filter) return;
    const entry = ensureRow(filter);
    paintTable();
    entry.planned.focus();
  });

  const share = h('button', { type: 'button', class: 'btn', onclick: () => openShareDialog({ projectId, opener: share, updates, updatesHome }) }, 'Share');
  const ledger = h('button', { type: 'button', class: 'btn', onclick: () => openLedger(projectId, ledger).catch((error) => announce(updates, error.message)) }, 'Show ledger');

  main.append(
    h('div', { class: 'page-head project-head' },
      h('div', {}, title, targetLine),
      stateChip),
    stateButtons,
    updatesHome,
    h('div', { class: 'project-layout' },
      h('section', { class: 'card hours-owed' },
        h('h2', {}, 'Hours owed'),
        h('div', { class: 'table-scroll' },
          h('table', { 'aria-label': 'Hours owed' },
            h('thead', {}, h('tr', {}, ['Filter', 'Planned', 'Logged', 'Owed'].map((label) => h('th', {}, label)))),
            tbody)),
        h('div', { class: 'field add-filter' }, h('label', { for: 'add-filter' }, 'Add filter'), addFilter)),
      h('section', { class: 'card total-integration', 'aria-label': 'Total integration' },
        h('h2', {}, 'Total integration'),
        total,
        h('p', { class: 'muted' }, `${project.session_count} ${project.session_count === 1 ? 'session' : 'sessions'}`))),
    h('div', { class: 'button-row' }, share, ledger));
  paintHeader();
  paintTable();
}
