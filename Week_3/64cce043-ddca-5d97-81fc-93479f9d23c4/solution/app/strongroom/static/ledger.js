// The ledger with its exposure column: /vault for the owner, /shared (read-only, masked) for the trusted contact.
import { announceExposure, app } from './app.js';
import { FAILED, Latest, call, errorCode, errorMessage, failedWithoutBody, get, listedHoldings } from './api.js';
import {
  Counter, LEVELS, LEVEL_LABEL, announce, busy, clearFieldErrors, formatRemaining, h, icon, levelBadge,
  nextId, reducedMotion, setText, showAlert, showFieldErrors, syncKeyed,
} from './dom.js';
import { openHoldingDialog } from './records.js';

const FILTER_KEYS = ['q', 'company', 'data_kind', 'level'];
const Q_LIMIT = 100;
const SEARCH_PAUSE_MS = 150;
const COMPANY_PAUSE_MS = 250;
const STAGGER_MS = 40;
const STAGGER_CAP = 11;
const SUGGESTION_MAX = 8;
const GRANT_REFRESH_MS = 15000;
const STEP_CONFLICT = 'This step was already changed in another window.';
const MISMATCH = 'The saved score differs from the preview. Showing the saved score.';

// --------------------------------------------------------------------------- filters in the address

function readFilters() {
  const params = new URLSearchParams(location.search);
  const kinds = new Set(app.kinds.map((k) => k.code));
  const filters = {};
  let dropped = false;
  for (const key of FILTER_KEYS) {
    const value = params.get(key) || '';
    const valid = key === 'q' ? value.length <= Q_LIMIT : key === 'data_kind' ? !value || kinds.has(value)
      : key === 'level' ? !value || LEVELS.includes(value) : true;
    filters[key] = valid ? value : '';
    dropped ||= !valid;
  }
  return { filters, dropped };
}

function filterQuery(filters) {
  return FILTER_KEYS.filter((key) => filters[key]).map((key) => `${key}=${encodeURIComponent(filters[key])}`).join('&');
}

// --------------------------------------------------------------------------- screen

export function mountLedger(main) {
  const owner = app.isOwner;
  const path = location.pathname;
  const initial = readFilters();
  const s = {
    filters: initial.filters, listing: null, exposure: null, ended: false, alive: true,
    lit: new Set(), timers: [], previewing: false, committed: 0, inflight: new Set(), focusAddWanted: false,
  };
  if (initial.dropped) history.replaceState(null, '', filterQuery(s.filters) ? `${path}?${filterQuery(s.filters)}` : path);
  document.title = owner ? 'Ledger · Strongroom Ledger' : 'Shared view · Strongroom Ledger';
  const listingRequest = new Latest();

  // ---------------------------------------------------------------- exposure column
  const numeral = h('span', { class: 'numeral', 'aria-live': 'off' });
  const counter = new Counter(numeral);
  const bandName = h('span', { class: 'band-name' });
  const previewTag = h('span', { class: 'preview-tag', hidden: true, text: 'Preview' });
  const previewSpoken = h('p', { class: 'sr-only', role: 'status', 'aria-label': 'Score preview' });
  const logBreach = owner ? h('button', { type: 'button', class: 'button button-primary log-breach', onclick: () => openForm() },
    icon('plus'), h('span', { text: 'Log breach' })) : null;
  const scoreband = h('div', { class: 'scoreband' },
    h('div', { class: 'score' }, h('h2', { class: 'score-label', id: 'exposure-heading', text: 'Exposure score' }),
      h('div', { class: 'score-figure' }, numeral, h('div', { class: 'score-meta' }, bandName, previewTag))),
    logBreach, previewSpoken);
  const formSlot = h('div', { class: 'form-slot' });
  const columnAlerts = h('div', { class: 'alert-slot' });
  const stepsList = h('ul', { class: 'steps', role: 'list', 'aria-label': 'Next steps' });
  const stepsEmpty = h('p', { class: 'empty', hidden: true, text: 'Nothing to do. No logged breach touches your holdings.' });
  const exposure = h('section', { class: 'exposure', 'aria-label': 'Exposure' },
    scoreband, formSlot, columnAlerts,
    h('div', { class: 'steps-block' }, h('h3', { class: 'section-label', text: 'Next steps' }), stepsList, stepsEmpty));

  // ---------------------------------------------------------------- ledger pane
  const searchId = nextId('search');
  const search = h('input', { id: searchId, type: 'search', class: 'input', value: s.filters.q, autocomplete: 'off', spellcheck: 'false' });
  const selects = {
    company: h('select', { id: nextId('f-company'), class: 'select' }),
    data_kind: h('select', { id: nextId('f-kind'), class: 'select' }),
    level: h('select', { id: nextId('f-level'), class: 'select' }),
  };
  const field = (input, label, extra = '') => h('div', { class: `filter ${extra}` },
    h('label', { for: input.id, class: 'filter-label', text: label }), input);
  const filterBar = h('div', { class: 'filterbar' },
    field(search, 'Search holdings', 'filter-search'), field(selects.company, 'Company'),
    field(selects.data_kind, 'Data kind'), field(selects.level, 'Level'));
  const results = h('p', { class: 'results', role: 'status', 'aria-label': 'Results' });
  const tbody = h('tbody', { role: 'rowgroup' });
  const table = h('table', { class: 'ledger', role: 'table', 'aria-label': 'Holdings' },
    h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' },
      h('th', { role: 'columnheader', scope: 'col', text: 'Data kind' }),
      h('th', { role: 'columnheader', scope: 'col', text: 'Level' }),
      h('th', { role: 'columnheader', scope: 'col', text: 'Value' }),
      h('th', { role: 'columnheader', scope: 'col', class: 'col-touch' }, h('span', { class: 'sr-only', text: 'Breach preview' })))),
    tbody);
  const ledgerEmpty = h('td', { role: 'cell', colspan: '4', class: 'empty empty-ledger' });
  const emptyRow = h('tr', { role: 'row', class: 'row-empty' }, ledgerEmpty);
  const addHolding = owner ? h('button', {
    type: 'button', class: 'button button-secondary', id: 'add-holding',
    onclick: () => openHoldingDialog({ mode: 'add', opener: addHolding, saved: refresh }),
  }, icon('plus'), h('span', { text: 'Add holding' })) : null;
  const heading = h('h1', { class: 'pane-title', text: owner ? 'Ledger' : 'Shared view' });
  const accessTime = owner ? null : h('p', { class: 'access-time', role: 'status', 'aria-label': 'Access time' });
  const sharedUpdates = owner ? null : h('p', { class: 'ticker', role: 'status', 'aria-label': 'Shared updates' });
  const breachesBlock = owner ? null : h('section', { class: 'shared-breaches', 'aria-labelledby': 'shared-breaches-title' });
  const head = h('div', { class: 'pane-head' }, h('div', {}, heading, accessTime), addHolding);
  const pane = h('section', { class: 'ledger-pane', 'aria-labelledby': 'ledger-title' },
    owner ? head : null, filterBar, results, h('div', { class: 'table-wrap' }, table), breachesBlock);
  heading.id = 'ledger-title';
  // The contact's screen says whose ledger it is above both columns.
  // The screen paints once its first data is in, so nothing moves under the pointer after it appears.
  const screen = h('div', { class: 'screen screen-ledger', hidden: true }, owner ? null : head, sharedUpdates,
    h('div', { class: 'layout layout-ledger' }, exposure, pane));
  main.replaceChildren(screen);

  // ---------------------------------------------------------------- rendering

  function renderOptions(facets) {
    const sets = {
      company: Object.keys(facets.company).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map((name) => [name, name, facets.company[name]]),
      data_kind: app.kinds.filter((k) => facets.data_kind[k.code]).map((k) => [k.code, k.label, facets.data_kind[k.code]]),
      level: LEVELS.filter((lv) => facets.level[lv]).map((lv) => [lv, LEVEL_LABEL[lv], facets.level[lv]]),
    };
    for (const [key, select] of Object.entries(selects)) {
      const options = [['', 'All', null], ...sets[key]];
      const chosen = s.filters[key];
      if (chosen && !options.some(([value]) => value === chosen)) {
        const name = key === 'data_kind' ? app.kindLabel[chosen] : key === 'level' ? LEVEL_LABEL[chosen] : chosen;
        options.push([chosen, name, 0]);
      }
      select.replaceChildren(...options.map(([value, name, count]) =>
        h('option', { value, text: count === null ? name : `${name} (${count})` })));
      select.value = chosen;
    }
  }

  function renderRows(holdings) {
    const rows = [];
    let group = null;
    for (const holding of holdings) {
      const key = holding.company.toLowerCase().split(/\s+/).join(' ');
      if (key !== group) {
        group = key;
        rows.push({ type: 'company', key: `c:${key}`, name: s.listing.facets.company ? companyName(holding) : holding.company });
      }
      rows.push({ type: 'holding', key: `h:${holding.id}`, holding });
    }
    syncKeyed(tbody, rows, (row) => row.key, createRow, updateRow);
    const filtered = FILTER_KEYS.some((k) => s.filters[k]);
    // The table stays in place when empty; its one row says why.
    if (!holdings.length) {
      setText(ledgerEmpty, filtered ? 'No holdings match these filters.'
        : owner ? 'Your ledger is empty. Add the first company that holds your data.' : 'Nothing is shared with you yet.');
      tbody.append(emptyRow);
    }
  }

  function companyName(holding) {
    // A group's heading uses the spelling of its earliest-created holding, which is the facet key.
    const key = holding.company.toLowerCase().split(/\s+/).join(' ');
    return Object.keys(s.listing.facets.company).find((name) => name.toLowerCase().split(/\s+/).join(' ') === key) || holding.company;
  }

  function createRow(row) {
    if (row.type === 'company') {
      return h('tr', { role: 'row', class: 'row-company' }, h('th', { role: 'rowheader', colspan: '4', scope: 'colgroup' }));
    }
    const kindCell = owner ? h('a', { class: 'row-link' }) : h('span', { class: 'row-kind' });
    // The spaces between cells keep each cell a separate word in the row's text.
    return h('tr', { role: 'row', class: 'row-holding' },
      h('td', { role: 'cell', class: 'cell-kind' }, kindCell), ' ',
      h('td', { role: 'cell', class: 'cell-level' }), ' ',
      h('td', { role: 'cell', class: 'cell-value' }, h('span', { class: 'value' })), ' ',
      h('td', { role: 'cell', class: 'cell-touch' }));
  }

  function updateRow(el, row) {
    if (row.type === 'company') {
      setText(el.firstElementChild, row.name);
      return;
    }
    const { holding } = row;
    el.dataset.id = holding.id;
    const kind = el.querySelector('.cell-kind').firstElementChild;
    setText(kind, app.kindLabel[holding.data_kind]);
    if (owner) kind.setAttribute('href', `/vault/holdings/${holding.id}`);
    const levelCell = el.querySelector('.cell-level');
    if (levelCell.dataset.level !== holding.level) {
      levelCell.dataset.level = holding.level;
      levelCell.replaceChildren(levelBadge(holding.level));
    }
    setText(el.querySelector('.value'), holding.value);
    paintTouched(el, s.lit.has(holding.id));
  }

  function paintTouched(el, on) {
    el.classList.toggle('touched', on);
    const cell = el.querySelector('.cell-touch');
    if (on && !cell.firstChild) cell.append(h('span', { class: 'touched-tag', text: 'Touched' }));
    if (!on) cell.replaceChildren();
  }

  function rowFor(id) {
    return tbody.querySelector(`tr[data-id="${id}"]`);
  }

  function renderExposure(data, { animate }) {
    s.exposure = data;
    s.committed = data.score;
    if (!s.previewing) {
      counter.set(data.score, { animate });
      setText(bandName, data.band);
      exposure.dataset.band = data.band.toLowerCase();
    }
    renderSteps(data.steps);
  }

  function renderSteps(steps) {
    stepsEmpty.hidden = steps.length > 0;
    stepsList.hidden = steps.length === 0;
    syncKeyed(stepsList, steps, (step) => step.id, owner ? createStep : createSharedStep, owner ? updateStep : updateSharedStep);
    if (owner && !stepsList.contains(document.activeElement)) rove(defaultStep());
  }

  function createSharedStep() {
    // The same row template as the owner's steps, without the checkbox.
    return h('li', { class: 'step step-readonly' },
      h('span', { class: 'step-body' }, h('span', { class: 'step-text' }), ' ', h('span', { class: 'step-meta' })), ' ',
      h('span', { class: 'step-points' }), ' ', h('span', { class: 'step-state' }));
  }

  function updateSharedStep(el, step) {
    el.classList.toggle('done', step.status === 'done');
    setText(el.querySelector('.step-text'), step.text);
    setText(el.querySelector('.step-meta'), `${step.company} · ${app.kindLabel[step.data_kind]}`);
    setText(el.querySelector('.step-points'), `${step.points} pts`);
    setText(el.querySelector('.step-state'), step.status === 'done' ? 'Done' : 'Open');
  }

  function createStep() {
    const box = h('div', { class: 'step-box', role: 'checkbox', tabindex: '-1' },
      h('span', { class: 'step-check', 'aria-hidden': 'true' }),
      h('span', { class: 'step-body' }, h('span', { class: 'step-text' }), h('span', { class: 'step-meta' })),
      h('span', { class: 'step-points' }), h('span', { class: 'step-state' }));
    box.addEventListener('click', () => toggleStep(box.closest('li')));
    return h('li', { class: 'step' }, box);
  }

  function updateStep(el, step) {
    const box = el.firstElementChild;
    box.setAttribute('aria-label', `${step.text}, ${step.company}`);
    setText(el.querySelector('.step-text'), step.text);
    setText(el.querySelector('.step-meta'), `${step.company} · ${app.kindLabel[step.data_kind]}`);
    setText(el.querySelector('.step-points'), `${step.points} pts`);
    if (s.inflight.has(step.id)) return;
    paintStep(el, step.status === 'done');
  }

  function paintStep(el, done, working = false) {
    const box = el.firstElementChild;
    box.setAttribute('aria-checked', String(done));
    el.classList.toggle('done', done);
    setText(el.querySelector('.step-state'), working ? 'Working...' : done ? 'Done' : 'Open');
  }

  // ---------------------------------------------------------------- next steps by keyboard and pointer

  function stepElements() {
    return [...stepsList.children];
  }

  function defaultStep() {
    const stepRows = stepElements();
    return stepRows.find((li) => li.firstElementChild.getAttribute('aria-checked') !== 'true') || stepRows[0];
  }

  function rove(target) {
    for (const li of stepElements()) li.firstElementChild.tabIndex = li === target ? 0 : -1;
  }

  if (owner) {
    stepsList.addEventListener('focusin', (event) => rove(event.target.closest('li')));
    stepsList.addEventListener('focusout', (event) => {
      if (!stepsList.contains(event.relatedTarget)) rove(defaultStep());
    });
    stepsList.addEventListener('keydown', (event) => {
      const stepRows = stepElements();
      const index = stepRows.indexOf(event.target.closest('li'));
      if (index < 0) return;
      const move = { ArrowDown: Math.min(index + 1, stepRows.length - 1), ArrowUp: Math.max(index - 1, 0), Home: 0, End: stepRows.length - 1 }[event.key];
      if (move !== undefined) {
        event.preventDefault();
        stepRows[move].firstElementChild.focus();
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        toggleStep(stepRows[index]);
      }
    });
  }

  async function toggleStep(li) {
    const id = li.dataset.key;
    if (s.inflight.has(id)) return;
    const box = li.firstElementChild;
    box.focus();
    const wasDone = box.getAttribute('aria-checked') === 'true';
    s.inflight.add(id);
    paintStep(li, !wasDone, true);
    const answer = await call('POST', `/api/steps/${id}/${wasDone ? 'reopen' : 'done'}`);
    s.inflight.delete(id);
    const focused = li.contains(document.activeElement);
    if (answer.status === 200) {
      paintStep(li, answer.body.step.status === 'done');
      renderExposure(answer.body.exposure, { animate: true });
      announceExposure(`${wasDone ? 'Step reopened' : 'Step marked done'}. Exposure score ${answer.body.exposure.score}.`);
    } else if (answer.status === 401) {
      paintStep(li, wasDone);
      app.sessionEnded();
      return;
    } else if (['step_already_done', 'step_already_open'].includes(errorCode(answer))) {
      const fresh = await get('/api/exposure');
      if (fresh.status === 200) renderExposure(fresh.body, { animate: true });
      showAlert(columnAlerts, STEP_CONFLICT);
    } else {
      paintStep(li, wasDone);
      showAlert(columnAlerts, errorCode(answer) === 'step_out_of_order' ? errorMessage(answer) : FAILED);
    }
    const again = stepsList.querySelector(`li[data-key="${id}"]`);
    if (focused && again) again.firstElementChild.focus();
  }

  // ---------------------------------------------------------------- data

  async function loadListing() {
    const query = filterQuery(s.filters);
    const answer = await listingRequest.run('GET', `/api/holdings${query ? `?${query}` : ''}`);
    if (!answer || !s.alive) return;
    if (answer.status !== 200) {
      handleBackground(answer);
      return;
    }
    s.listing = answer.body;
    renderOptions(answer.body.facets);
    renderRows(listedHoldings(answer.body));
    setText(results, `Holdings shown: ${answer.body.total}.`);
  }

  async function loadExposure({ animate }) {
    const answer = await get('/api/exposure');
    if (!s.alive) return;
    if (answer.status === 200) renderExposure(answer.body, { animate });
    else handleBackground(answer);
  }

  async function loadShared() {
    const grant = await get('/api/contact/grant', { keepalive: true });
    if (!s.alive) return false;
    if (grant.status !== 200) {
      handleBackground(grant);
      return false;
    }
    if (grant.body.status !== 'active') {
      showEnded();
      return false;
    }
    setText(heading, `Shared by ${grant.body.owner_name}`);
    document.title = `Shared by ${grant.body.owner_name} · Strongroom Ledger`;
    setText(accessTime, `Access ends in ${formatRemaining(grant.body.remaining_seconds)}`);
    return true;
  }

  async function loadSharedBreaches() {
    const answer = await get('/api/breaches');
    if (!s.alive || answer.status !== 200) {
      if (answer.status !== 200) handleBackground(answer);
      return;
    }
    const breachRows = answer.body.breaches.map((b) => h('li', { class: 'shared-breach' },
      h('span', { class: 'shared-breach-name', text: `${b.company} — ${b.announced_on}` }),
      h('span', { class: 'shared-breach-kinds', text: b.data_kinds.map((k) => app.kindLabel[k]).join(', ') })));
    breachesBlock.replaceChildren(h('h2', { class: 'section-label', id: 'shared-breaches-title', text: 'Breaches touching what you can see' }),
      breachRows.length ? h('ul', { class: 'shared-breach-list' }, breachRows) : h('p', { class: 'empty', text: 'No breaches logged.' }));
  }

  /** Background answers leave the screen as it is; a contact whose access ended sees the Access ended screen. */
  function handleBackground(answer) {
    if (!owner && errorCode(answer) === 'access_ended') showEnded();
    else if (!owner && answer.status === 401 && !s.ended) location.assign('/');
  }

  async function refresh({ animate = true } = {}) {
    if (!owner) {
      if (!(await loadShared())) return;
      await Promise.all([loadListing(), loadExposure({ animate }), loadSharedBreaches()]);
      return;
    }
    await Promise.all([loadListing(), loadExposure({ animate }), form ? form.refresh() : null]);
  }

  function showEnded() {
    if (s.ended) return;
    s.ended = true;
    clearInterval(grantTimer);
    document.title = 'Access ended · Strongroom Ledger';
    const status = h('p', { class: 'ticker', role: 'status', 'aria-label': 'Shared updates', text: 'Access ended.' });
    main.replaceChildren(h('section', { class: 'notice notice-ended' },
      h('h1', { text: 'Access ended' }), h('p', { text: 'This shared view has ended. Ask the vault owner for a new grant.' }), status));
  }

  // ---------------------------------------------------------------- filtering

  let searchTimer = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      s.filters.q = search.value.trim().slice(0, Q_LIMIT);
      writeAddress(false);
      loadListing();
    }, SEARCH_PAUSE_MS);
  });
  for (const [key, select] of Object.entries(selects)) {
    select.addEventListener('change', () => {
      clearTimeout(searchTimer);
      s.filters.q = search.value.trim().slice(0, Q_LIMIT);
      s.filters[key] = select.value;
      writeAddress(true);
      loadListing();
    });
  }

  function writeAddress(push) {
    const query = filterQuery(s.filters);
    const url = query ? `${path}?${query}` : path;
    if (url === location.pathname + location.search) return;
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }

  // ---------------------------------------------------------------- the Log breach form

  let form = null;

  function openForm(draft = null) {
    if (form) return;
    form = breachForm({ draft });
    formSlot.replaceChildren(form.el);
    logBreach.setAttribute('aria-expanded', 'true');
    form.start();
  }

  function setPreviewing(on) {
    s.previewing = on;
    previewTag.hidden = !on;
  }

  function clearTimers() {
    for (const timer of s.timers) clearTimeout(timer);
    s.timers = [];
  }

  function ledgerPosition(id) {
    return form?.order.get(id) ?? Number.MAX_SAFE_INTEGER;
  }

  /** The blast preview: rows join one by one in ledger order, leave in reverse, while the numeral counts. */
  function blast(target, score) {
    clearTimers();
    const goal = new Set(target);
    const joining = target.filter((id) => !s.lit.has(id));
    const leaving = [...s.lit].filter((id) => !goal.has(id)).sort((a, b) => ledgerPosition(b) - ledgerPosition(a));
    const still = reducedMotion.matches;
    const light = (id, on) => {
      if (on) s.lit.add(id);
      else s.lit.delete(id);
      const row = rowFor(id);
      if (row) paintTouched(row, on);
    };
    for (const list of [joining.map((id) => [id, true]), leaving.map((id) => [id, false])]) {
      list.forEach(([id, on], index) => {
        const delay = Math.min(index, STAGGER_CAP) * STAGGER_MS;
        if (still || delay === 0) light(id, on);
        else s.timers.push(setTimeout(() => light(id, on), delay));
      });
    }
    counter.set(score, { animate: true });
    if (still) announce(previewSpoken, `Projected score ${score}.`);
  }

  function closeForm({ restoreScore = true, instant = false } = {}) {
    if (!form) return;
    form.destroy();
    form = null;
    formSlot.replaceChildren();
    logBreach.setAttribute('aria-expanded', 'false');
    setPreviewing(false);
    if (instant) {
      clearTimers();
      for (const id of [...s.lit]) {
        s.lit.delete(id);
        const row = rowFor(id);
        if (row) paintTouched(row, false);
      }
    } else {
      blast([], s.committed);
    }
    if (restoreScore) counter.set(s.committed, { animate: !instant });
    setText(bandName, s.exposure?.band || '');
  }

  function breachForm({ draft }) {
    const preview = new Latest();
    const key = draft?.key || crypto.randomUUID();
    const order = new Map();
    let companies = [];
    let loaded = false;
    let listWanted = false;
    let companyTimer = 0;
    let lastPreview = null;
    const formId = nextId('breach');
    const company = h('input', {
      id: `${formId}-company`, class: 'input', type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
      'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `${formId}-suggestions`, 'data-field': 'company',
      value: draft?.company || '',
    });
    const listbox = h('ul', { id: `${formId}-suggestions`, class: 'suggestions', role: 'listbox', 'aria-label': 'Company suggestions', popover: 'manual' });
    const announced = h('input', {
      id: `${formId}-date`, class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-field': 'announced_on',
      value: draft?.announced_on || app.today, 'aria-describedby': `${formId}-date-hint`,
    });
    const boxes = app.kinds.map((kind) => h('input', {
      type: 'checkbox', class: 'checkbox', value: kind.code, id: `${formId}-k-${kind.code}`,
      checked: Boolean(draft?.data_kinds?.includes(kind.code)),
    }));
    const kindsGroup = h('fieldset', { class: 'kinds', 'data-field': 'data_kinds', id: `${formId}-kinds` },
      h('legend', { class: 'field-label', text: 'Data kinds' }),
      h('div', { class: 'kinds-grid' }, app.kinds.map((kind, i) => h('label', { class: 'check-row', for: boxes[i].id },
        boxes[i], h('span', { text: kind.label })))));
    const status = h('p', { class: 'breach-preview', role: 'status', 'aria-label': 'Breach preview' });
    const save = h('button', { type: 'submit', class: 'button button-primary', text: 'Save breach' });
    const cancel = h('button', { type: 'button', class: 'button button-secondary', text: 'Cancel', onclick: () => cancelForm() });
    const summary = h('div', { class: 'summary-slot' });
    const alerts = h('div', { class: 'alert-slot' });
    const el = h('form', { class: 'breach-form', 'aria-label': 'Log breach', novalidate: true },
      h('h3', { class: 'form-title', text: 'Log breach' }), summary, alerts,
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: company.id, text: 'Company' }), company, listbox),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: announced.id, text: 'Announced on' }), announced,
        h('p', { class: 'hint', id: `${formId}-date-hint`, text: 'YYYY-MM-DD' })),
      kindsGroup, status, h('div', { class: 'actions' }, save, cancel));

    const ticked = () => boxes.filter((box) => box.checked).map((box) => box.value);

    async function requestPreview() {
      const body = { company: company.value, data_kinds: ticked() };
      const answer = await preview.run('POST', '/api/breaches/preview', body);
      if (!answer || !s.alive || !form || form.el !== el) return;
      if (answer.status === 401) return;
      if (answer.status !== 200) return;
      lastPreview = answer.body;
      setPreviewing(true);
      blast(answer.body.affected_holding_ids, answer.body.score);
      setText(status, `Preview: holdings touched ${answer.body.affected_holding_ids.length}, projected score ${answer.body.score}.`);
    }

    async function loadCompanies() {
      const answer = await get('/api/holdings');
      if (answer.status !== 200) return;
      companies = Object.keys(answer.body.facets.company).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      order.clear();
      listedHoldings(answer.body).forEach((holding, index) => order.set(holding.id, index));
      loaded = true;
      if (listWanted && document.activeElement === company) {
        listWanted = false;
        openList();
      }
    }

    // -------------------------------------------------------------- suggestions
    let active = -1;
    const options = () => [...listbox.children];
    function openList() {
      if (!loaded) {
        listWanted = true;
        return;
      }
      const needle = company.value.trim().toLowerCase();
      const matches = companies.filter((name) => name.toLowerCase().includes(needle)).slice(0, SUGGESTION_MAX);
      listbox.replaceChildren(...matches.map((name, i) => h('li', {
        id: `${formId}-opt-${i}`, role: 'option', class: 'option', 'aria-selected': 'false', text: name,
        onmousedown: (event) => event.preventDefault(),
        onclick: () => pick(name),
      })));
      active = -1;
      company.removeAttribute('aria-activedescendant');
      if (!matches.length) {
        closeList();
        return;
      }
      if (!listbox.matches(':popover-open')) listbox.showPopover();
      company.setAttribute('aria-expanded', 'true');
      place();
    }
    function closeList() {
      if (listbox.matches(':popover-open')) listbox.hidePopover();
      company.setAttribute('aria-expanded', 'false');
      company.removeAttribute('aria-activedescendant');
      active = -1;
    }
    function place() {
      if (!listbox.matches(':popover-open')) return;
      const rect = company.getBoundingClientRect();
      const below = innerHeight - rect.bottom - 8;
      const above = rect.top - 8;
      const wanted = listbox.scrollHeight;
      const down = below >= Math.min(wanted, 220) || below >= above;
      listbox.style.left = `${Math.max(8, rect.left)}px`;
      listbox.style.width = `${Math.min(rect.width, innerWidth - 16)}px`;
      listbox.style.maxHeight = `${Math.max(88, down ? below : above)}px`;
      listbox.style.top = down ? `${rect.bottom + 4}px` : 'auto';
      listbox.style.bottom = down ? 'auto' : `${innerHeight - rect.top + 4}px`;
    }
    function setActive(index) {
      const suggestionOptions = options();
      active = index;
      suggestionOptions.forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
      if (suggestionOptions[index]) {
        company.setAttribute('aria-activedescendant', suggestionOptions[index].id);
        suggestionOptions[index].scrollIntoView({ block: 'nearest' });
      }
    }
    function pick(name) {
      company.value = name;
      closeList();
      clearTimeout(companyTimer);
      company.focus();
      requestPreview();
    }
    company.addEventListener('input', () => {
      openList();
      clearTimeout(companyTimer);
      companyTimer = setTimeout(requestPreview, COMPANY_PAUSE_MS);
    });
    company.addEventListener('keydown', (event) => {
      const open = listbox.matches(':popover-open');
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!open) openList();
        if (!loaded) return;
        if (listbox.matches(':popover-open')) setActive(Math.min(active + 1, options().length - 1));
      } else if (event.key === 'ArrowUp' && open) {
        event.preventDefault();
        setActive(Math.max(active - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (open && active >= 0) pick(options()[active].textContent);
      } else if (event.key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        closeList();
      }
    });
    company.addEventListener('blur', () => closeList());
    const reposition = () => place();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    // -------------------------------------------------------------- ticks, save, cancel
    for (const box of boxes) box.addEventListener('change', () => requestPreview());
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        cancelForm();
      }
    });

    function cancelForm() {
      preview.cancel();
      closeForm();
      logBreach.focus();
    }

    let saving = false;
    el.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      busy(save, true);
      alerts.replaceChildren();
      const body = { company: company.value, announced_on: announced.value, data_kinds: ticked() };
      const answer = await call('POST', '/api/breaches', body, { key });
      saving = false;
      busy(save, false);
      if (answer.status === 201) {
        const committed = answer.body.exposure.score;
        const mismatch = lastPreview !== null && lastPreview.score !== committed;
        preview.cancel();
        s.committed = committed;
        closeForm({ restoreScore: false, instant: true });
        counter.set(committed, { animate: false });
        setText(bandName, answer.body.exposure.band);
        renderSteps(answer.body.exposure.steps);
        if (mismatch) showAlert(columnAlerts, MISMATCH);
        announceExposure(`Breach logged. Holdings touched: ${answer.body.breach.affected_holding_ids.length}. Exposure score ${committed}.`);
        logBreach.focus();
        loadListing();
      } else if (answer.status === 401) {
        app.sessionEnded({ kind: 'breach', key, ...body });
      } else if (answer.status === 422) {
        showFieldErrors(el, summary, answer.body.error.fields || {},
          { company: 'Company', announced_on: 'Announced on', data_kinds: 'Data kinds' });
      } else if (failedWithoutBody(answer)) {
        showAlert(alerts, FAILED, { focus: true });
      } else {
        showAlert(alerts, errorMessage(answer) || FAILED, { focus: true });
      }
    });

    return {
      el,
      order,
      async start() {
        clearFieldErrors(el, summary);
        await loadCompanies();
        if (draft) {
          save.focus();
          announce(app.draftStatus, 'Your session ended. Your unsaved entries were kept; check them and save again.');
        } else {
          company.focus();
        }
        if (draft) requestPreview();
      },
      async refresh() {
        await loadCompanies();
        if (listbox.matches(':popover-open')) openList();
        requestPreview();
      },
      destroy() {
        clearTimeout(companyTimer);
        closeList();
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
      },
    };
  }

  // ---------------------------------------------------------------- live updates and timers

  let grantTimer = 0;
  if (!owner) {
    grantTimer = setInterval(async () => {
      if (s.ended) return;
      const grant = await get('/api/contact/grant', { keepalive: true });
      if (!s.alive) return;
      if (grant.status !== 200) handleBackground(grant);
      else if (grant.body.status !== 'active') showEnded();
      else setText(accessTime, `Access ends in ${formatRemaining(grant.body.remaining_seconds)}`);
    }, GRANT_REFRESH_MS);
  }

  (async () => {
    await refresh({ animate: false });
    screen.hidden = false;
    if (s.focusAddWanted) addHolding.focus();
    if (owner && s.alive) {
      const draft = app.takeDraft('breach');
      if (draft) openForm(draft);
      const holdingDraft = app.takeDraft('holding-add');
      if (holdingDraft) openHoldingDialog({ mode: 'add', opener: addHolding, saved: refresh, draft: holdingDraft });
    }
  })();

  return {
    samePath: (pathname) => pathname === path,
    popstate() {
      s.filters = readFilters().filters;
      search.value = s.filters.q;
      clearTimeout(searchTimer);
      loadListing();
    },
    live(change) {
      if (s.ended) return;
      if (!owner) {
        announce(sharedUpdates, change.type === 'grant.updated' ? 'The owner narrowed what you can see.' : 'Shared view updated.');
      }
      refresh();
    },
    accessEnded() {
      if (!owner) showEnded();
    },
    focusAddHolding() {
      if (screen.hidden) s.focusAddWanted = true;
      else addHolding?.focus();
    },
    destroy() {
      s.alive = false;
      clearTimers();
      clearTimeout(searchTimer);
      clearInterval(grantTimer);
      listingRequest.cancel();
      form?.destroy();
    },
  };
}

