/* Strongroom Ledger screens: the ledger, rules, breaches, contact and account. */

(() => {
  'use strict';
  const { S, api, el, $, announce, showAlert, setScoreNumber, showPreviewTag,
    renderExposure, startStream, stopStream, storeDraft, loadDraft, discardDraft,
    remainingText, showFieldErrors, clearFieldErrors, REDUCED } = window.Strongroom;

  const LEVEL_LABEL = { critical: 'Critical', high: 'High', moderate: 'Moderate', low: 'Low' };
  const KIND_LABEL = {};
  const KINDS_ORDER = [];

  // --- Helpers ----------------------------------------------------------------

  function groupByCompany(items) {
    const groups = new Map();
    for (const h of items) {
      const key = h.company.trim().toLowerCase().split(/\s+/).join(' ');
      if (!groups.has(key)) groups.set(key, { display: h.company, holdings: [] });
      groups.get(key).holdings.push(h);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, g]) => ({ key, display: g.display, holdings: g.holdings }));
  }

  function badge(level) {
    return el('span', { class: `badge ${level}`, text: LEVEL_LABEL[level] || level });
  }

  function statusOf(h) {
    const p = document.createElement('td');
    if (h.affected) {
      p.appendChild(el('span', { class: 'touched-label', text: 'Affected' }));
    }
    return p;
  }

  // --- Filters in the address ---------------------------------------------

  function readFilters() {
    const params = new URLSearchParams(location.search);
    let q = params.get('q') || '';
    let company = params.get('company') || '';
    let data_kind = params.get('data_kind') || '';
    let level = params.get('level') || '';
    let changed = false;
    if (data_kind && !KIND_LABEL[data_kind]) { data_kind = ''; changed = true; }
    if (level && !LEVEL_LABEL[level]) { level = ''; changed = true; }
    if (q.length > 100) { q = ''; changed = true; }
    return { q, company, data_kind, level, changed };
  }

  function filtersToQuery(f) {
    const params = new URLSearchParams();
    if (f.q) params.set('q', f.q);
    if (f.company) params.set('company', f.company);
    if (f.data_kind) params.set('data_kind', f.data_kind);
    if (f.level) params.set('level', f.level);
    const entries = [];
    for (const key of ['q', 'company', 'data_kind', 'level']) {
      if (params.get(key)) entries.push(`${encodeURIComponent(key)}=${encodeURIComponent(params.get(key))}`);
    }
    return entries.length ? `?${entries.join('&')}` : '';
  }

  function applyFiltersToAddress(f, { replace = false } = {}) {
    const query = filtersToQuery(f);
    const target = `${location.pathname}${query}`;
    if (replace) history.replaceState({}, '', target);
    else history.pushState({}, '', target);
  }

  window.addEventListener('popstate', () => { renderRoute(true); });

  // --- Ledger screen ---------------------------------------------------------

  async function loadLedgerData(filters) {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.company) params.set('company', filters.company);
    if (filters.data_kind) params.set('data_kind', filters.data_kind);
    if (filters.level) params.set('level', filters.level);
    const qs = params.toString();
    const { status, data } = await api(`/api/holdings${qs ? `?${qs}` : ''}`);
    if (status !== 200) return { status, data };
    return { status, data };
  }

  function renderLedger(container, data, { readOnly = false, filters }) {
    const wrapper = el('div');
    const groups = groupByCompany(data.items);
    const table = el('table', { class: 'ledger', role: 'table' });
    table.setAttribute('aria-label', 'Holdings');
    const head = el('thead');
    const headRow = el('tr');
    for (const label of ['Data kind', 'Level', 'Value', 'Status']) {
      headRow.appendChild(el('th', { text: label, scope: 'col' }));
    }
    head.appendChild(headRow);
    table.appendChild(head);
    const body = el('tbody');

    if (!groups.length) {
      const row = el('tr');
      const cell = el('td', { colspan: '4' });
      cell.appendChild(el('div', {
        class: 'empty-state',
        text: data.total === 0 && !filters.q && !filters.company && !filters.data_kind && !filters.level
          ? 'Your ledger is empty. Add the first company that holds your data.'
          : 'No holdings match these filters.',
      }));
      row.appendChild(cell);
      body.appendChild(row);
    }

    for (const group of groups) {
      const gRow = el('tr', { class: 'company-row', role: 'row' });
      const gCell = el('th', { colspan: '4', scope: 'rowgroup', text: group.display });
      gRow.appendChild(gCell);
      body.appendChild(gRow);
      for (const h of group.holdings) {
        const tr = el('tr', { class: 'holding-row', role: 'row', 'data-holding-id': h.id });
        const kindCell = el('td', { class: 'kind' });
        kindCell.appendChild(el('span', { text: KIND_LABEL[h.data_kind] || h.data_kind }));
        if (S.touchedIds.has(h.id)) {
          tr.classList.add('touched');
          kindCell.appendChild(el('span', { class: 'touched-label', text: 'Touched' }));
        }
        const levelCell = el('td');
        levelCell.appendChild(badge(h.level));
        const valueCell = el('td', { class: 'value', text: h.value });
        const statusCell = statusOf(h);
        tr.append(kindCell, levelCell, valueCell, statusCell);
        if (!readOnly) {
          tr.style.cursor = 'pointer';
          tr.addEventListener('click', () => { location.href = `/vault/holdings/${h.id}`; });
        }
        body.appendChild(tr);
      }
    }
    table.appendChild(body);
    wrapper.appendChild(table);
    container.replaceChildren(wrapper);
  }

  function renderFilterBar(container, filters, facets, onFiltersChanged) {
    const bar = el('div', { class: 'filterbar' });
    const search = el('input', { type: 'search', id: 'search-holdings', placeholder: 'Search holdings',
      'aria-label': 'Search holdings', value: filters.q, name: 'q' });
    let debounce = null;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const f = { ...current, q: search.value };
        applyFiltersToAddress(f, { replace: true });
        onFiltersChanged(f, { fromTyping: true });
      }, 250);
    });
    bar.appendChild(el('div', { class: 'search' })).appendChild(search);

    // The selects keep in step with the live search text.
    let current = { ...filters };
    const selects = [
      { key: 'company', label: 'Company', options: facetCompanyOptions(facets.company), value: filters.company },
      { key: 'data_kind', label: 'Data kind', options: facetKindOptions(facets.data_kind), value: filters.data_kind },
      { key: 'level', label: 'Level', options: facetLevelOptions(facets.level), value: filters.level },
    ];
    for (const sel of selects) {
      const wrap = el('label');
      wrap.appendChild(el('span', { class: 'sr-only', text: sel.label }));
      const node = el('select', { 'aria-label': sel.label, name: sel.key });
      for (const opt of sel.options) {
        const o = el('option', { value: opt.value, text: opt.label });
        if (opt.value === sel.value) o.selected = true;
        node.appendChild(o);
      }
      node.addEventListener('change', () => {
        current = { ...current, [sel.key]: node.value };
        applyFiltersToAddress(current);
        onFiltersChanged(current);
      });
      wrap.appendChild(node);
      bar.appendChild(wrap);
    }
    container.replaceChildren(bar);
  }

  function facetCompanyOptions(counts) {
    const opts = [{ value: '', label: 'All' }];
    for (const name of Object.keys(counts || {}).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
      opts.push({ value: name, label: `${name} (${counts[name]})` });
    }
    return opts;
  }

  function facetKindOptions(counts) {
    const opts = [{ value: '', label: 'All' }];
    for (const code of KINDS_ORDER) {
      if (counts && counts[code]) opts.push({ value: code, label: `${KIND_LABEL[code]} (${counts[code]})` });
    }
    return opts;
  }

  function facetLevelOptions(counts) {
    const opts = [{ value: '', label: 'All' }];
    for (const code of ['critical', 'high', 'moderate', 'low']) {
      if (counts && counts[code]) opts.push({ value: code, label: `${LEVEL_LABEL[code]} (${counts[code]})` });
    }
    return opts;
  }

  // --- Exposure column -----------------------------------------------------------

  function renderExposurePanel(container, { readOnly = false } = {}) {
    const panel = el('div', { class: 'exposure-panel' });
    const line = el('div', { class: 'score-line' });
    line.appendChild(el('span', { class: 'score-num', id: 'score-num', text: '0', 'aria-live': 'off' }));
    line.appendChild(el('span', { class: 'preview-tag', id: 'preview-tag', text: 'Preview', hidden: true }));
    line.appendChild(el('span', { class: 'band-name', id: 'band-name', text: '' }));
    panel.appendChild(el('h2', { class: 'section-title', text: 'Exposure score' }));
    panel.appendChild(line);
    if (!readOnly) {
      const logBtn = el('button', { type: 'button', id: 'log-breach', text: 'Log breach' });
      panel.appendChild(logBtn);
      panel.appendChild(el('div', { id: 'breach-form-slot' }));
    }
    panel.appendChild(el('ul', { class: 'steps', id: 'next-steps', role: 'list', 'aria-label': 'Next steps' }));
    panel.appendChild(el('div', { class: 'status-line', id: 'exposure-updates', role: 'status', 'aria-live': 'polite' }));
    container.replaceChildren(panel);
  }

  function renderSteps(listEl, steps, { readOnly = false } = {}) {
    listEl.replaceChildren();
    if (!steps.length) {
      const li = el('li', { class: 'empty-state', text: 'Nothing to do. No logged breach touches your holdings.' });
      listEl.appendChild(li);
      return;
    }
    for (const step of steps) {
      const li = el('li', { class: `step ${step.status}`, role: 'listitem', 'data-step-id': step.id, tabindex: '-1' });
      const textWrap = el('span', { class: 'step-text' });
      textWrap.appendChild(el('span', { text: step.text }));
      textWrap.appendChild(el('span', { class: 'step-meta', text: `${step.company} · ${KIND_LABEL[step.data_kind] || step.data_kind}` }));
      const points = el('span', { class: 'step-points num', text: `${step.points}` });
      const status = el('span', { class: 'step-state', text: step.status === 'done' ? 'Done' : 'Open' });
      if (readOnly) {
        // The contact's list is read-only: a listitem per step showing Done or Open.
        li.append(textWrap, points, status);
      } else {
        const cb = el('input', { type: 'checkbox', 'aria-label': `${step.text}, ${step.company}` });
        cb.checked = step.status === 'done';
        cb.addEventListener('change', () => toggleStep(step, cb.checked, li, cb));
        li.append(cb, textWrap, points, status);
      }
      listEl.appendChild(li);
    }
  }

  async function toggleStep(step, toDone, li, cb) {
    // The toggle shows at once, then settles on the server's state.
    cb.disabled = true;
    const state = li.querySelector('.step-state');
    const prevState = state.textContent;
    state.textContent = 'Working...';
    const { status, data } = await api(`/api/steps/${encodeURIComponent(step.id)}/${toDone ? 'done' : 'reopen'}`, { method: 'POST', body: {} });
    if (status === 200) {
      li.classList.toggle('done', toDone);
      state.textContent = toDone ? 'Done' : 'Open';
      if (data && data.exposure) {
        renderExposure(data.exposure, { announceAs: toDone ? 'Step marked done.' : 'Step reopened.' });
      }
    } else if (status === 409) {
      const code = data && data.error ? data.error.code : '';
      if (code === 'step_already_done' || code === 'step_already_open') {
        const fresh = await api('/api/holdings');
        if (fresh.status === 200) {
          S.committedScore = fresh.data.exposure.score;
          setScoreNumber(fresh.data.exposure.score);
          window.Strongroom.syncBandScore(fresh.data.exposure.score);
          cb.checked = !toDone;
          li.classList.toggle('done', !toDone);
          state.textContent = !toDone ? 'Done' : 'Open';
        }
        showAlert('This step was already changed in another window.');
      } else if (code === 'step_out_of_order') {
        cb.checked = false;
        state.textContent = prevState;
        showAlert((data && data.error && data.error.message) || 'Finish the step before this one first.');
      } else {
        cb.checked = !toDone;
        state.textContent = prevState;
        showAlert('Something went wrong. Your change was not saved.');
      }
    } else if (status === 401) {
      location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    } else {
      cb.checked = !toDone;
      state.textContent = prevState;
      showAlert('Something went wrong. Your change was not saved.');
    }
    cb.disabled = false;
    li.focus();
  }

  /** Make the next-steps list a single Tab stop with arrow-key navigation. */
  function setupStepListKeyboard(listEl) {
    const items = () => [...listEl.querySelectorAll('.step')];
    listEl.tabIndex = 0;
    listEl.addEventListener('keydown', (e) => {
      const list = items();
      if (!list.length) return;
      const current = document.activeElement;
      const index = list.indexOf(current);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        let target = 0;
        if (e.key === 'ArrowDown') target = Math.min(index + 1, list.length - 1);
        else if (e.key === 'ArrowUp') target = Math.max(index - 1, 0);
        else if (e.key === 'End') target = list.length - 1;
        if (list[target]) list[target].focus();
      } else if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        const cb = current && current.querySelector('input[type="checkbox"]');
        if (cb && !cb.disabled) {
          e.preventDefault();
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        }
      }
    });
  }

  window.Screens = { groupByCompany, badge, readFilters, filtersToQuery, applyFiltersToAddress,
    loadLedgerData, renderLedger, renderFilterBar, renderExposurePanel, renderSteps, toggleStep,
    setupStepListKeyboard, LEVEL_LABEL, KIND_LABEL, KINDS_ORDER, remainingText };
})();
