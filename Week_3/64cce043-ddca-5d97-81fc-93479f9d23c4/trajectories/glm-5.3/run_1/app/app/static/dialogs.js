/* Dialogs: Add/Edit holding, Log breach, Add/Edit rule, Grant access. */

(() => {
  'use strict';
  const { S, api, el, $, announce, showAlert, setScoreNumber, showPreviewTag,
    renderExposure, storeDraft, loadDraft, discardDraft, remainingText,
    showFieldErrors, clearFieldErrors, REDUCED } = window.Strongroom;
  const { LEVEL_LABEL, KIND_LABEL, KINDS_ORDER } = window.Screens;

  function focusFirst(dialog) {
    const first = dialog.querySelector('input, select, textarea, button');
    if (first) first.focus();
  }

  function trapFocus(dialog, event) {
    const focusables = dialog.querySelectorAll('input, select, textarea, button, a[href]');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openDialog(dialog, opener) {
    dialog.showModal();
    focusFirst(dialog);
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') trapFocus(dialog, e);
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog(dialog, opener);
      }
    });
    dialog._opener = opener || null;
  }

  function closeDialog(dialog, opener) {
    dialog.close();
    if (opener && document.body.contains(opener)) opener.focus();
    else if (dialog._opener && document.body.contains(dialog._opener)) dialog._opener.focus();
  }

  // --- Add / Edit holding ---------------------------------------------------

  async function openHoldingDialog(existing, refresh) {
    const dlg = el('dialog', { 'aria-label': existing ? 'Edit holding' : 'Add holding' });
    const form = el('form', { 'aria-label': existing ? 'Edit holding' : 'Add holding' });
    form.appendChild(el('h2', { class: 'section-title', text: existing ? 'Edit holding' : 'Add holding' }));

    const grid = el('div', { class: 'form-grid' });
    const company = el('input', { type: 'text', name: 'company', id: 'holding-company', value: existing ? existing.company : '' });
    const companyLabel = el('label', { for: 'holding-company', text: 'Company' });
    grid.append(companyLabel, company);

    const kindWrap = el('label');
    kindWrap.appendChild(el('span', { text: 'Data kind' }));
    const kind = el('select', { name: 'data_kind', id: 'holding-kind' });
    for (const code of KINDS_ORDER) {
      const o = el('option', { value: code, text: KIND_LABEL[code] });
      if (existing && existing.data_kind === code) o.selected = true;
      kind.appendChild(o);
    }
    kindWrap.appendChild(kind);
    grid.appendChild(kindWrap);

    const value = el('input', { type: 'text', name: 'value', id: 'holding-value', value: existing ? existing.value : '' });
    grid.append(el('label', { for: 'holding-value', text: 'Value' }), value);

    const notes = el('textarea', { name: 'notes', id: 'holding-notes' });
    if (existing) notes.value = existing.notes || '';
    grid.append(el('label', { for: 'holding-notes', text: 'Notes' }), notes);

    form.appendChild(grid);

    const actions = el('div', { class: 'form-actions' });
    const save = el('button', { type: 'submit', text: 'Save holding' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    actions.append(save, cancel);
    form.appendChild(actions);
    dlg.appendChild(form);
    document.body.appendChild(dlg);

    cancel.addEventListener('click', () => { closeDialog(dlg); dlg.remove(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      save.disabled = true;
      save.textContent = 'Working...';
      const body = {
        company: company.value,
        data_kind: kind.value,
        value: value.value,
        notes: notes.value,
      };
      const payload = existing ? { version: existing.version, ...body } : body;
      const { status, data } = await api(existing ? `/api/holdings/${existing.id}` : '/api/holdings', {
        method: existing ? 'PATCH' : 'POST',
        body: payload,
      });
      save.disabled = false;
      save.textContent = 'Save holding';
      if (status === 201 || status === 200) {
        closeDialog(dlg);
        dlg.remove();
        announce('exposure-updates', `Holding saved. Exposure score ${data.exposure.score}.`);
        await refresh();
        if (!existing) document.getElementById('add-holding')?.focus();
      } else if (status === 401) {
        storeDraft(existing ? 'edit-holding' : 'add-holding', { ...payload, id: existing ? existing.id : null });
        location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      } else if (status === 422 || status === 409) {
        const err = data && data.error ? data.error : {};
        if (err.code === 'stale_version') {
          showAlert(err.message || 'This record changed in another window. Reload it and try again.');
          return;
        }
        showFieldErrors(form, err.fields || {});
      } else {
        showAlert('Something went wrong. Your change was not saved.');
      }
    });

    openDialog(dlg, document.activeElement);
    dlg.addEventListener('close', () => dlg.remove());
  }

  // --- Log breach ------------------------------------------------------------

  let breachIdempotencyKey = null;
  let previewSeq = 0;

  async function openBreachForm(refresh) {
    const dlg = el('form', { 'aria-label': 'Log breach', id: 'log-breach-form' });
    dlg.classList.add('breach-form');
    breachIdempotencyKey = `brk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    S.breachForm = { open: true, kinds: new Set(), company: '' };

    dlg.appendChild(el('h2', { class: 'section-title', text: 'Log breach' }));
    const grid = el('div', { class: 'form-grid' });

    // Company combobox with suggestions.
    const comboWrap = el('div', { class: 'combobox' });
    const combo = el('input', { type: 'text', name: 'company', id: 'breach-company',
      role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'company-suggestions',
      'aria-autocomplete': 'list', autocomplete: 'off' });
    const listbox = el('div', { id: 'company-suggestions', role: 'listbox', 'aria-label': 'Company suggestions', hidden: true });
    comboWrap.append(combo, listbox);
    grid.append(el('label', { for: 'breach-company', text: 'Company' }), comboWrap);

    const dateWrap = el('label');
    dateWrap.appendChild(el('span', { text: 'Announced on' }));
    const dateInput = el('input', { type: 'date', name: 'announced_on', id: 'breach-date' });
    dateWrap.appendChild(dateInput);
    grid.appendChild(dateWrap);

    const kindsWrap = el('fieldset');
    kindsWrap.appendChild(el('legend', { text: 'Data kinds' }));
    kindsWrap.setAttribute('role', 'group');
    kindsWrap.setAttribute('aria-label', 'Data kinds');
    for (const code of KINDS_ORDER) {
      const row = el('label', { class: 'checkrow' });
      const cb = el('input', { type: 'checkbox', name: 'data_kinds', value: code });
      cb.addEventListener('change', () => {
        if (cb.checked) S.breachForm.kinds.add(code);
        else S.breachForm.kinds.delete(code);
        requestBreachPreview();
      });
      row.append(cb, el('span', { text: KIND_LABEL[code] }));
      kindsWrap.appendChild(row);
    }
    grid.appendChild(kindsWrap);
    dlg.appendChild(grid);

    dlg.appendChild(el('div', { class: 'status-line', id: 'breach-preview-status', role: 'status', 'aria-live': 'polite' }));
    const actions = el('div', { class: 'form-actions' });
    const save = el('button', { type: 'submit', text: 'Save breach' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    actions.append(save, cancel);
    dlg.appendChild(actions);

    const slot = document.getElementById('breach-form-slot');
    slot.replaceChildren(dlg);

    // Suggestions behaviour.
    let activeIndex = -1;
    let companies = [];

    async function loadCompanies() {
      const { data } = await api('/api/holdings');
      companies = [...new Set((data ? data.items : []).map((h) => h.company))]
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }
    await loadCompanies();

    function renderSuggestions(text) {
      const needle = (text || '').trim().toLowerCase();
      const matches = companies
        .filter((c) => !needle || c.toLowerCase().includes(needle))
        .slice(0, 8)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      listbox.replaceChildren();
      for (const c of matches) {
        const opt = el('div', { role: 'option', 'aria-selected': 'false', text: c, tabindex: '-1' });
        opt.addEventListener('mousedown', (e) => e.preventDefault());
        opt.addEventListener('click', () => {
          combo.value = c;
          S.breachForm.company = c;
          closeSuggestions();
          requestBreachPreview();
        });
        listbox.appendChild(opt);
      }
      activeIndex = -1;
      if (matches.length) {
        listbox.hidden = false;
        combo.setAttribute('aria-expanded', 'true');
      } else {
        closeSuggestions();
      }
    }

    function closeSuggestions() {
      listbox.hidden = true;
      combo.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    }

    let comboDebounce = null;
    combo.addEventListener('input', () => {
      S.breachForm.company = combo.value;
      renderSuggestions(combo.value);
      clearTimeout(comboDebounce);
      comboDebounce = setTimeout(() => requestBreachPreview(), 250);
    });
    combo.addEventListener('keydown', (e) => {
      const options = listbox.querySelectorAll('[role="option"]');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (listbox.hidden) { renderSuggestions(combo.value); return; }
        activeIndex = Math.min(activeIndex + 1, options.length - 1);
        options.forEach((o, i) => o.classList.toggle('active', i === activeIndex));
        if (options[activeIndex]) {
          combo.setAttribute('aria-activedescendant', options[activeIndex].id || '');
          options[activeIndex].id = 'sug-active';
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!listbox.hidden) {
          activeIndex = Math.max(activeIndex - 1, -1);
          options.forEach((o, i) => o.classList.toggle('active', i === activeIndex));
        }
      } else if (e.key === 'Enter') {
        if (!listbox.hidden && activeIndex >= 0 && options[activeIndex]) {
          e.preventDefault();
          combo.value = options[activeIndex].textContent;
          S.breachForm.company = combo.value;
          closeSuggestions();
          requestBreachPreview();
        }
      } else if (e.key === 'Escape') {
        if (!listbox.hidden) {
          e.preventDefault();
          closeSuggestions();
        }
      }
    });

    // The blast preview.
    async function requestBreachPreview(fromLive = false) {
      const seq = ++previewSeq;
      const company = S.breachForm.company || combo.value;
      const kinds = [...S.breachForm.kinds];
      const { status, data } = await api('/api/breaches/preview', {
        method: 'POST',
        body: { company, data_kinds: kinds },
      });
      if (seq !== previewSeq) return;   // a late answer to older input never paints
      if (status !== 200) return;
      applyPreview(data);
    }

    function applyPreview(data) {
      const touchedNow = new Set(data.affected_holding_ids || []);
      const rows = document.querySelectorAll('[data-holding-id]');
      const ledgerOrder = [...rows].map((r) => r.getAttribute('data-holding-id'));

      const newlyTouched = ledgerOrder.filter((id) => touchedNow.has(id) && !S.touchedIds.has(id));
      const cleared = ledgerOrder.filter((id) => !touchedNow.has(id) && S.touchedIds.has(id));

      // Rows leaving the touched set clear in reverse ledger order.
      cleared.reverse().forEach((id, i) => {
        const row = document.querySelector(`[data-holding-id="${CSS.escape(id)}"]`);
        if (!row) return;
        const delay = REDUCED() ? 0 : i * 40;
        setTimeout(() => {
          row.classList.remove('touched');
          row.querySelector('.touched-label')?.remove();
        }, delay);
      });

      newlyTouched.forEach((id, i) => {
        const row = document.querySelector(`[data-holding-id="${CSS.escape(id)}"]`);
        if (!row) return;
        // From the 12th newly touched row on, all remaining rows light together.
        const step = REDUCED() ? 0 : Math.min(i, 11) * 40;
        setTimeout(() => {
          row.classList.add('touched');
          if (!row.querySelector('.touched-label')) {
            row.querySelector('td')?.appendChild(el('span', { class: 'touched-label', text: 'Touched' }));
          }
        }, step);
      });

      S.touchedIds = touchedNow;
      showPreviewTag(true);
      setScoreNumber(data.score, { animate: true });
      window.Strongroom.syncBandScore(data.score);
      announce('breach-preview-status', `Preview: holdings touched ${touchedNow.size}, projected score ${data.score}.`);
    }

    save.addEventListener('click', async (e) => {
      e.preventDefault();
      clearFieldErrors(dlg);
      save.disabled = true;
      save.textContent = 'Working...';
      const body = {
        company: combo.value,
        announced_on: dateInput.value,
        data_kinds: [...S.breachForm.kinds],
      };
      const { status, data } = await api('/api/breaches', {
        method: 'POST',
        body,
        idempotencyKey: breachIdempotencyKey,
      });
      save.disabled = false;
      save.textContent = 'Save breach';
      if (status === 201) {
        const previewScore = Number(($('#score-num') || {}).textContent || 0);
        showPreviewTag(false);
        S.touchedIds = new Set();
        S.breachForm = null;
        slot.replaceChildren();
        announce('exposure-updates', `Breach logged. Holdings touched: ${(data.breach.affected_holding_ids || []).length}. Exposure score ${data.exposure.score}.`);
        if (data.exposure.score !== previewScore) {
          showAlert('The saved score differs from the preview. Showing the saved score.');
        }
        setScoreNumber(data.exposure.score, { animate: false });
        document.getElementById('log-breach')?.focus();
        await refresh();
      } else if (status === 401) {
        storeDraft('log-breach', { ...body, idempotencyKey: breachIdempotencyKey });
        location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      } else if (status === 422) {
        showFieldErrors(dlg, (data && data.error && data.error.fields) || {});
      } else if (status === 409) {
        showAlert((data && data.error && data.error.message) || 'Something went wrong.');
      } else {
        showAlert('Something went wrong. Your change was not saved.');
      }
    });

    cancel.addEventListener('click', () => {
      // Clear the lit rows in reverse order and return to the committed score.
      const rows = [...document.querySelectorAll('.holding-row.touched')].reverse();
      rows.forEach((row, i) => {
        setTimeout(() => {
          row.classList.remove('touched');
          row.querySelector('.touched-label')?.remove();
        }, REDUCED() ? 0 : i * 40);
      });
      S.touchedIds = new Set();
      S.breachForm = null;
      showPreviewTag(false);
      setScoreNumber(S.committedScore, { animate: false });
      window.Strongroom.syncBandScore(S.committedScore);
      slot.replaceChildren();
      document.getElementById('log-breach')?.focus();
    });

    // The date starts at the server's date for today.
    const todayResp = await api('/api/holdings');
    if (todayResp.status === 200) dateInput.value = new Date().toISOString().slice(0, 10);
    combo.focus();
    renderSuggestions('');
  }

  window.Dialogs = { openHoldingDialog, openBreachForm, openDialog, closeDialog, focusFirst, trapFocus };
})();
