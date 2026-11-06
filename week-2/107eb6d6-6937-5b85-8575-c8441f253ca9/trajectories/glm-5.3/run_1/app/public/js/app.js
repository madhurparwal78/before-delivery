'use strict';

// Client behaviour for the dispatch desk. The page never decides a status,
// count or truck state: every write is checked again on the server and the
// redrawn fragments come from stored rows.

(function () {
  const DRAFT_KEY = 'gigfreight.draft';

  // Refused writes (400, 403, 409, 422) and outages (503) still swap their
  // fragment, so the redrawn region shows the server's message and the rows
  // stored at that moment.
  if (window.htmx && window.htmx.config) {
    window.htmx.config.responseHandling = [
    { code: '204', swap: false },
    { code: '400', swap: true, error: false },
    { code: '403', swap: true, error: false },
    { code: '404', swap: true, error: false },
    { code: '409', swap: true, error: false },
    { code: '422', swap: true, error: false },
    { code: '503', swap: true, error: false },
    { code: '2..', swap: true },
    { code: '3..', swap: false },
    { code: '[45]..', swap: false, error: true },
    ];
  }

  function readDraft() {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeDraft(draft) {
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage unavailable */ }
  }

  function clearDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
  }

  function newDraft() {
    return {
      draft_id: null,
      tour_name: '',
      transport_type: '',
      trucks_requested: '',
      notes: '',
      stops: {
        pickup: emptyStop(), delivery: emptyStop(),
        first_show: emptyStop(), last_show: emptyStop(),
      },
    };
  }

  function emptyStop() {
    return { date: '', address: '', city: '', region: '', postal_code: '', country: '' };
  }

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  }

  function apiBody(draft) {
    return {
      draft_id: draft.draft_id,
      tour_name: draft.tour_name,
      transport_type: draft.transport_type,
      trucks_requested: draft.trucks_requested === '' ? null : Number(draft.trucks_requested),
      notes: draft.notes || '',
      stops: {
        pickup: stopBody(draft.stops.pickup),
        delivery: stopBody(draft.stops.delivery),
        first_show: stopBody(draft.stops.first_show),
        last_show: stopBody(draft.stops.last_show),
      },
    };
  }

  function stopBody(stop) {
    return {
      date: stop.date || null,
      address: stop.address || '',
      city: stop.city || '',
      region: stop.region || '',
      postal_code: stop.postal_code || '',
      country: stop.country || '',
    };
  }

  async function postJSON(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await response.json(); } catch { /* non-JSON */ }
    return { status: response.status, data };
  }

  function showDeskNotice(message) {
    const region = document.getElementById('desk-notices');
    if (!region) return;
    region.hidden = false;
    region.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'notice';
    p.textContent = message;
    region.appendChild(p);
  }

  function clearDeskNotice() {
    const region = document.getElementById('desk-notices');
    if (region) {
      region.hidden = true;
      region.innerHTML = '';
    }
  }

  function setBusy(button, busy) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      const busyText = button.dataset.busyText;
      if (busyText) button.textContent = busyText;
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    }
  }

  // Field reasons from a 422, keyed exactly as the API keys them.
  function showFieldErrors(container, fields) {
    container.querySelectorAll('.field-error').forEach((el) => { el.hidden = true; el.textContent = ''; });
    container.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    Object.entries(fields || {}).forEach(([key, reason]) => {
      const el = fieldErrorFor(container, key);
      if (el) {
        el.hidden = false;
        el.textContent = reason;
        const input = container.querySelector(`[name="${fieldNameFor(key)}"]`);
        if (input) {
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', el.id);
        }
      }
    });
  }

  function fieldNameFor(key) {
    const parts = key.split('.');
    if (parts[0] === 'stops' && parts.length === 3) return `${parts[1]}.${parts[2]}`;
    return key;
  }

  function fieldErrorFor(container, key) {
    const name = fieldNameFor(key);
    const input = container.querySelector(`[name="${name}"]`);
    if (input && input.id) {
      return container.querySelector(`#${CSS.escape(input.id)}-error, #${CSS.escape(name.replace(/\./g, '-') + '-error')}`);
    }
    return container.querySelector(`#${CSS.escape(key.replace(/\./g, '-') + '-error')}`);
  }

  // ---------- Motion ----------

  const MOTION_KEY = 'gigfreight.reduceMotion';

  function systemReduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function rememberedReduced() {
    try { return window.localStorage.getItem(MOTION_KEY) === '1'; } catch { return false; }
  }

  function applyMotionPreference() {
    const reduced = rememberedReduced() || systemReduced();
    document.documentElement.classList.toggle('reduced-motion', reduced);
    document.querySelectorAll('.reduce-motion').forEach((button) => {
      button.setAttribute('aria-pressed', reduced ? 'true' : 'false');
    });
    document.body.dataset.reduceMotion = reduced ? 'on' : 'off';
  }

  function toggleReduceMotion() {
    let reduced;
    try {
      reduced = rememberedReduced();
      window.localStorage.setItem(MOTION_KEY, reduced ? '0' : '1');
    } catch { reduced = !systemReduced(); }
    applyMotionPreference();
  }

  window.addEventListener('pageshow', () => applyMotionPreference());
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyMotionPreference);

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.reduce-motion');
    if (button) toggleReduceMotion();
  });

  // ---------- Menu ----------

  document.addEventListener('click', (event) => {
    const menuButton = event.target.closest('#menu-button');
    if (menuButton) {
      const nav = document.getElementById('topbar-nav');
      const open = nav.hasAttribute('hidden');
      if (open) {
        nav.removeAttribute('hidden');
        menuButton.setAttribute('aria-expanded', 'true');
        const first = nav.querySelector('a');
        if (first) first.focus();
      } else {
        closeMenu();
      }
    }
  });

  function closeMenu() {
    const nav = document.getElementById('topbar-nav');
    const menuButton = document.getElementById('menu-button');
    if (nav) nav.setAttribute('hidden', '');
    if (menuButton) {
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.focus();
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const dialog = document.querySelector('dialog[open]');
      if (dialog) { dialog.close(); return; }
      const nav = document.getElementById('topbar-nav');
      if (nav && !nav.hasAttribute('hidden')) closeMenu();
    }
  });

  // ---------- htmx: pending buttons, error swaps, focus ----------

  document.body.addEventListener('htmx:beforeRequest', (event) => {
    const source = event.detail.elt;
    const button = source.closest('button');
    if (button) setBusy(button, true);
  });

  document.body.addEventListener('htmx:afterRequest', (event) => {
    const source = event.detail.elt;
    const button = source.closest('button');
    if (button) setBusy(button, false);
  });

  // Focus the first appended row after Show more requests.
  document.body.addEventListener('htmx:afterSwap', (event) => {
    if (event.detail.target && event.detail.target.id === 'request-rows' && event.detail.requestConfig && String(event.detail.requestConfig.parameters.cursor || '') !== '') {
      const rows = event.detail.target.querySelectorAll('tr[data-request-id]');
      if (rows.length) {
        const first = rows[0];
        first.setAttribute('tabindex', '-1');
        first.focus({ preventScroll: false });
      }
    }
    // The request list refreshed: keep the address in step.
    if (event.detail.elt && event.detail.elt.closest && event.detail.elt.closest('.filters')) {
      const form = event.detail.elt.closest('.filters');
      const q = form.querySelector('[name="q"]') ? form.querySelector('[name="q"]').value : '';
      const status = form.querySelector('[name="status"]') ? form.querySelector('[name="status"]').value : '';
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      const suffix = params.toString();
      window.history.replaceState({}, '', suffix ? `${window.location.pathname}?${suffix}` : window.location.pathname);
    }
  });

  document.addEventListener('click', (event) => {
    const clear = event.target.closest('[data-clear-search]');
    if (!clear) return;
    const input = document.querySelector('#q');
    if (input) {
      input.value = '';
      if (window.htmx) window.htmx.trigger(input, 'input');
      else window.location.reload();
    }
  });

  // ---------- New request steps ----------

  function stepRoot() {
    return document.querySelector('.steps');
  }

  function collectStep1(form) {
    const draft = readDraft() || newDraft();
    draft.tour_name = form.querySelector('[name="tour_name"]').value;
    const checked = form.querySelector('input[name="transport_type"]:checked');
    draft.transport_type = checked ? checked.value : '';
    draft.trucks_requested = form.querySelector('[name="trucks_requested"]').value;
    return draft;
  }

  function collectStep2(form) {
    const draft = readDraft() || newDraft();
    form.querySelectorAll('.stop-fieldset').forEach((fieldset) => {
      const kind = fieldset.dataset.stopKind;
      const stop = draft.stops[kind] || emptyStop();
      fieldset.querySelectorAll('input').forEach((input) => {
        const field = input.name.split('.')[1];
        stop[field] = input.value;
      });
      draft.stops[kind] = stop;
    });
    return draft;
  }

  function fillStepFromDraft(root, draft) {
    if (!root || !draft) return;
    const form = root.querySelector('form');
    if (!form) return;
    if (root.dataset.step === '1') {
      form.querySelector('[name="tour_name"]').value = draft.tour_name || '';
      const checked = form.querySelector(`input[name="transport_type"][value="${draft.transport_type}"]`);
      if (checked) checked.checked = true;
      form.querySelector('[name="trucks_requested"]').value = draft.trucks_requested || '';
    } else if (root.dataset.step === '2') {
      Object.entries(draft.stops).forEach(([kind, stop]) => {
        Object.entries(stop).forEach(([field, value]) => {
          const input = form.querySelector(`[name="${kind}.${field}"]`);
          if (input) input.value = value || '';
        });
      });
    } else if (root.dataset.step === '3') {
      form.querySelector('[name="notes"]').value = draft.notes || '';
      renderReview(root.querySelector('#review-block'), draft);
    }
  }

  function renderReview(block, draft) {
    if (!block) return;
    const types = { tour: 'Tour', show: 'Show', show_freight: 'Show freight' };
    const kinds = { pickup: 'Pickup', delivery: 'Delivery', first_show: 'First Show', last_show: 'Last Show' };
    const reviewHTML = [];
    reviewHTML.push(`<div class="review-tour fade-rise">`);
    reviewHTML.push(`<dl class="review-list">`);
    reviewHTML.push(`<div><dt>Tour name</dt><dd>${escapeHTML(draft.tour_name)}</dd></div>`);
    reviewHTML.push(`<div><dt>Type of transportation</dt><dd>${escapeHTML(types[draft.transport_type] || '')}</dd></div>`);
    reviewHTML.push(`<div><dt>Number of trucks</dt><dd>${escapeHTML(String(draft.trucks_requested))}</dd></div>`);
    reviewHTML.push(`</dl></div>`);
    reviewHTML.push(`<div class="stop-grid review-grid fade-rise">`);
    Object.keys(kinds).forEach((kind, index) => {
      const stop = draft.stops[kind] || emptyStop();
      reviewHTML.push(`<article class="stop-card" data-stop-kind="${kind}">`);
      reviewHTML.push(`<h3 class="stop-number">( ${index + 1} ) ${kinds[kind]}</h3>`);
      reviewHTML.push(`<p class="stop-date">${escapeHTML(stop.date || 'No date')}</p>`);
      reviewHTML.push(`<p class="stop-line">${escapeHTML(stop.address)}</p>`);
      reviewHTML.push(`<p class="stop-line">${escapeHTML(stop.city)}</p>`);
      reviewHTML.push(`<p class="stop-line">${escapeHTML(stop.region)}</p>`);
      reviewHTML.push(`<p class="stop-line">${escapeHTML(stop.postal_code)}</p>`);
      reviewHTML.push(`<p class="stop-line">${escapeHTML(stop.country)}</p>`);
      reviewHTML.push(`</article>`);
    });
    reviewHTML.push(`</div>`);
    block.innerHTML = reviewHTML.join('');
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function draftIsEmpty(draft) {
    if (!draft) return true;
    if (draft.tour_name || draft.transport_type || draft.trucks_requested || draft.notes) return false;
    return Object.values(draft.stops).every((stop) => Object.values(stop).every((v) => !v));
  }

  function guardStepAccess(root) {
    if (!root) return;
    const draft = readDraft();
    const step = root.dataset.step;
    if (step === '2' || step === '3') {
      const promise = postJSON('/requests/new/validate', apiBody(draft || newDraft()));
      promise.then(({ data }) => {
        if (!data || data.ok) return;
        const fields = data.fields || {};
        const stepOneKeys = ['tour_name', 'transport_type', 'trucks_requested'];
        const stepOneBad = stepOneKeys.some((k) => fields[k]);
        if (stepOneBad) { window.location.replace('/requests/new'); return; }
        if (step === '3') {
          const stepTwoBad = Object.keys(fields).some((k) => k.startsWith('stops.'));
          if (stepTwoBad) window.location.replace('/requests/new/stops');
        }
      }).catch(() => { /* server unreachable: leave the step open */ });
    }
  }

  async function validateStep(draft) {
    const { status, data } = await postJSON('/requests/new/validate', apiBody(draft));
    if (status === 503) {
      showDeskNotice('The desk cannot reach its records right now. Try again shortly.');
      return null;
    }
    return data && data.ok ? {} : (data && data.fields) || {};
  }

  function initSteps() {
    const root = stepRoot();
    if (!root) return;
    const draft = readDraft();
    fillStepFromDraft(root, draft);
    guardStepAccess(root);

    if (root.dataset.step === '1') {
      const form = document.getElementById('step-1-form');
      const next = document.getElementById('step-1-next');
      next.addEventListener('click', async () => {
        const collected = collectStep1(form);
        setBusy(next, true);
        const fields = await validateStep(collected);
        if (fields === null) { setBusy(next, false); return; }
        const stepOneFields = Object.keys(fields).filter((k) => ['tour_name', 'transport_type', 'trucks_requested'].includes(k));
        if (stepOneFields.length) {
          setBusy(next, false);
          showFieldErrors(root, fields);
          return;
        }
        if (!collected.draft_id) collected.draft_id = uuid();
        writeDraft(collected);
        window.location.assign('/requests/new/stops');
      });
    }

    if (root.dataset.step === '2') {
      const form = document.getElementById('step-2-form');
      document.getElementById('step-2-back').addEventListener('click', () => {
        const collected = collectStep2(form);
        writeDraft(collected);
        window.location.assign('/requests/new');
      });
      const next = document.getElementById('step-2-next');
      next.addEventListener('click', async () => {
        const collected = collectStep2(form);
        writeDraft(collected);
        setBusy(next, true);
        const fields = await validateStep(collected);
        if (fields === null) { setBusy(next, false); return; }
        const stepTwoFields = Object.keys(fields).filter((k) => k.startsWith('stops.'));
        if (stepTwoFields.length) {
          setBusy(next, false);
          showFieldErrors(root, fields);
          return;
        }
        window.location.assign('/requests/new/review');
      });
    }

    if (root.dataset.step === '3') {
      const form = document.getElementById('step-3-form');
      document.getElementById('step-3-back').addEventListener('click', () => {
        const draft = readDraft() || newDraft();
        draft.notes = form.querySelector('[name="notes"]').value;
        writeDraft(draft);
        window.location.assign('/requests/new/stops');
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = document.getElementById('step-3-submit');
        const draft = readDraft() || newDraft();
        draft.notes = form.querySelector('[name="notes"]').value;
        writeDraft(draft);
        setBusy(submitButton, true);
        const { status, data } = await postJSON('/requests/new/submit', apiBody(draft));
        if (data && data.ok) {
          clearDraft();
          window.location.assign(data.redirect_url);
          return;
        }
        setBusy(submitButton, false);
        if (status === 422 && data && data.fields) {
          showFieldErrors(root, data.fields);
          showDeskNotice('Check the highlighted fields and try again.');
        } else {
          showDeskNotice('The desk cannot reach its records right now. Try again shortly.');
        }
      });
    }

    initDiscardDialog();
  }

  function initDiscardDialog() {
    const dialog = document.getElementById('discard-dialog');
    if (!dialog || dialog.dataset.wired) return;
    dialog.dataset.wired = '1';
    document.querySelectorAll('[data-cancel-step]').forEach((button) => {
      button.addEventListener('click', () => {
        const draft = readDraft();
        if (draftIsEmpty(draft)) {
          clearDraft();
          window.location.assign('/requests');
          return;
        }
        dialog.showModal();
        const keep = document.getElementById('discard-keep');
        if (keep) keep.focus();
      });
    });
    const keep = document.getElementById('discard-keep');
    const discard = document.getElementById('discard-confirm');
    if (keep) {
      keep.addEventListener('click', () => dialog.close());
    }
    if (discard) {
      discard.addEventListener('click', () => {
        clearDraft();
        window.location.assign('/requests');
      });
    }
    dialog.addEventListener('close', () => {
      const cancel = document.querySelector('[data-cancel-step]');
      if (cancel) cancel.focus();
    });
  }

  // ---------- Login form pending state ----------

  function initLoginForm() {
    const form = document.querySelector('.login-form');
    if (!form || form.dataset.wired) return;
    form.dataset.wired = '1';
    form.addEventListener('submit', () => {
      const button = form.querySelector('button[type="submit"]');
      setBusy(button, true);
    });
  }

  // ---------- Button label roll ----------
  // Every action button rolls its label on hover and focus: the label slides up
  // and out while a copy slides in from below.
  function rollLabels(scope) {
    (scope || document).querySelectorAll('.btn').forEach((button) => {
      const nodes = Array.from(button.childNodes);
      const textNode = nodes.find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
      if (!textNode) return;
      const span = document.createElement('span');
      span.className = 'roll';
      const inner = document.createElement('span');
      inner.dataset.label = textNode.textContent.trim();
      inner.textContent = textNode.textContent;
      span.appendChild(inner);
      button.replaceChild(span, textNode);
    });
  }

  // ---------- Boot ----------

  function boot() {
    applyMotionPreference();
    rollLabels(document);
    initSteps();
    initLoginForm();
  }

  document.body.addEventListener('htmx:afterSwap', () => rollLabels(document));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
