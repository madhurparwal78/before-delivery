// /compartments: the caller's totals, exhibit search, compartments list and a case lead's break-glass entry.

import {
  api, CONNECTION_LOST, ConnectionLost, canonicalTime, clearFieldError, emptyState, field, figure, h, newKey, refusalCopy, session, setFieldError, setFigure,
  syncRows,
} from '../core.js';
import { openDialog, stepUp } from '../dialogs.js';
import { actionStatus, docketPanes, noRecordCopy, refreshDrawer, refreshSession } from '../shell.js';

const REFRESH_MS = 4000;
const SEARCH_PAUSE_MS = 250;
const TOTALS = [
  ['Compartments', 'compartments'],
  ['In quarantine', 'quarantined'],
  ['Held', 'held'],
  ['Releases in review', 'releases_in_review'],
  ['Bytes in releases', 'release_bytes'],
];

function totalsRegion() {
  const values = new Map(TOTALS.map(([, key]) => [key, h('dd', { class: 'mono' })]));
  const region = h('section', { role: 'region', 'aria-label': 'Totals', class: 'sheet-section' },
    h('dl', { class: 'totals' }, TOTALS.map(([label, key]) => h('div', {}, h('dt', {}, label), values.get(key)))));
  const update = (dashboard) => {
    for (const [key, value] of values) {
      const text = String(dashboard[key]);
      if (value.textContent !== text) value.textContent = text;
    }
  };
  return { region, update };
}

function searchSection(screen) {
  const box = h('input', { type: 'search', autocomplete: 'off' });
  const results = h('ul', { role: 'list', 'aria-label': 'Search results', class: 'ruled-list' });
  const none = emptyState('No exhibits match.');
  none.hidden = true;
  let timer = null;
  let inFlight = null;

  const show = (rows, query) => {
    syncRows(results, rows, {
      key: (row) => row.exhibit_id,
      signature: (row) => JSON.stringify(row),
      render: (row) => h('li', {},
        h('a', { href: `/exhibits/${row.exhibit_id}`, class: 'row-link mono' }, row.exhibit_id),
        h('span', { class: 'row-name' }, row.name),
        h('span', { class: 'row-meta' }, h('span', { class: 'state-word' }, row.state), ' ', h('span', { class: 'mono' }, row.compartment_id))),
    });
    none.hidden = rows.length > 0 || !query;
  };

  const search = async () => {
    inFlight?.abort();
    const query = box.value.trim();
    if (!query) {
      show([], '');
      return;
    }
    inFlight = new AbortController();
    try {
      const answer = await api('GET', `/api/search?q=${encodeURIComponent(query)}`, { signal: inFlight.signal });
      if (answer.ok) show(answer.data.results, query);
    } catch (error) {
      if (!(error instanceof ConnectionLost) && error.name !== 'AbortError') throw error;
    }
  };

  box.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, SEARCH_PAUSE_MS);
  });
  screen.onCleanup(() => {
    clearTimeout(timer);
    inFlight?.abort();
  });
  return h('section', { class: 'sheet-section stack' }, field('Search exhibits', box), results, none);
}

function compartmentsList() {
  const list = h('ul', { role: 'list', 'aria-label': 'Your compartments', class: 'ruled-list' });
  const update = (compartments) => syncRows(list, compartments, {
    key: (row) => row.id,
    signature: (row) => JSON.stringify(row),
    render: (row) => h('li', {},
      h('a', { href: `/compartments/${row.id}`, class: 'row-link' }, row.name),
      h('span', { class: 'row-meta mono row-facts' },
        h('span', {}, row.id),
        h('span', {}, `${row.exhibit_count} ${row.exhibit_count === 1 ? 'exhibit' : 'exhibits'}`),
        h('span', {}, `${row.quarantine_count} in quarantine`),
        h('span', {}, `${row.release_bytes} bytes`))),
  });
  return { list, update };
}

function newCompartmentButton(refresh) {
  const opener = h('button', { type: 'button', class: 'btn' }, 'New compartment');
  opener.addEventListener('click', () => {
    const name = h('input', { type: 'text', autocomplete: 'off' });
    const create = h('button', { type: 'submit', class: 'btn' }, 'Create compartment');
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    const form = h('form', { class: 'stack', novalidate: true },
      field('Compartment name', name), h('div', { class: 'button-row' }, create, cancel));
    const dialog = openDialog({ name: 'New compartment', content: form, opener });
    cancel.addEventListener('click', () => dialog.close());
    name.focus();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (create.disabled) return;
      create.disabled = true;
      clearFieldError(name);
      try {
        const answer = await api('POST', '/api/compartments', { body: { name: name.value } });
        if (answer.ok) {
          dialog.close();
          await Promise.all([refresh(), refreshDrawer()]);
        } else if (answer.errors?.name) {
          setFieldError(name, answer.errors.name);
          name.focus();
        } else if (answer.status !== 401) {
          actionStatus(refusalCopy(answer), 'refusal');
        }
      } catch (error) {
        if (!(error instanceof ConnectionLost)) throw error;
        actionStatus(CONNECTION_LOST);
      } finally {
        create.disabled = false;
      }
    });
  });
  return opener;
}

function breakGlassSection(refresh) {
  const reference = h('input', { type: 'text', class: 'mono', autocomplete: 'off', spellcheck: 'false' });
  const reason = h('textarea', { rows: 3 });
  const open = h('button', { type: 'submit', class: 'btn' }, 'Open break-glass');
  const form = h('form', { class: 'stack', novalidate: true },
    field('Compartment reference', reference), field('Break-glass reason', reason), h('div', { class: 'button-row' }, open));
  let key = newKey();
  form.addEventListener('input', () => {
    key = newKey();
  });

  const onAnswer = async (answer) => {
    if (answer.ok) {
      const { ends_at: endsAt, notice } = answer.data;
      const tail = notice === 'held' ? 'Notice held. It will send when the mail relay returns.' : 'Owner notice queued.';
      actionStatus(`Break-glass open until ${canonicalTime(endsAt)}. ${tail}`, 'done');
      form.reset();
      key = newKey();
      await Promise.all([refresh(), refreshDrawer(), refreshSession()]);
    } else if (answer.errors?.reason) {
      setFieldError(reason, answer.errors.reason);
      actionStatus(answer.errors.reason, 'refusal');
      reason.focus();
    } else {
      actionStatus(refusalCopy(answer), 'refusal');
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldError(reference);
    clearFieldError(reason);
    const compartment = reference.value.trim();
    if (!compartment) {
      setFieldError(reference, 'This field is required.');
      reference.focus();
      return;
    }
    stepUp({
      opener: open,
      run: (proof) => {
        actionStatus('Opening break-glass.');
        return api('POST', `/api/compartments/${encodeURIComponent(compartment)}/break-glass`, { body: { reason: reason.value }, proof, key });
      },
      onAnswer,
      onFailure: () => actionStatus(CONNECTION_LOST),
    });
  });
  return h('section', { class: 'sheet-section stack' }, h('h3', {}, 'Break-glass'), form);
}

export async function mount(screen) {
  const panes = docketPanes(screen, 'docket');
  noRecordCopy(panes.inspector);
  panes.docket.append(h('div', { class: 'skeleton' }, h('div'), h('div'), h('div')));

  const load = async () => {
    const [dashboard, compartments] = await Promise.all([
      api('GET', '/api/dashboard', { background: true, signal: screen.signal }),
      api('GET', '/api/compartments', { background: true, signal: screen.signal }),
    ]);
    return dashboard.ok && compartments.ok ? { dashboard: dashboard.data, compartments: compartments.data.compartments } : null;
  };

  const first = await load();
  if (screen.stopped || !first) return;
  const total = figure('Total exhibits', first.dashboard.exhibits);
  const totals = totalsRegion();
  const list = compartmentsList();
  const noGrants = emptyState('No compartments on your grants.');
  const apply = ({ dashboard, compartments }) => {
    setFigure(total, dashboard.exhibits);
    totals.update(dashboard);
    list.update(compartments);
    noGrants.hidden = compartments.length > 0;
  };
  const refresh = async () => {
    const data = await load();
    if (data && !screen.stopped) apply(data);
  };

  const lead = session.me.role === 'case_lead';
  panes.docket.replaceChildren(
    total,
    totals.region,
    searchSection(screen),
    h('section', { class: 'sheet-section stack' },
      h('div', { class: 'sheet-head' }, h('h3', {}, 'Compartments'), lead ? newCompartmentButton(refresh) : null),
      list.list,
      noGrants),
    ...(lead ? [breakGlassSection(refresh)] : []),
  );
  apply(first);
  screen.every(REFRESH_MS, refresh, { now: false });
}
