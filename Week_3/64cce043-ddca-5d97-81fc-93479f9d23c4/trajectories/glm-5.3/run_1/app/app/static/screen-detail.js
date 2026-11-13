/* Holding detail, breaches list, breach detail, rules, contact and account screens. */

(() => {
  'use strict';
  const { S, api, el, $, announce, showAlert, setScoreNumber, showPreviewTag,
    renderExposure, startStream, stopStream, storeDraft, loadDraft, discardDraft,
    remainingText, showFieldErrors, clearFieldErrors, REDUCED } = window.Strongroom;
  const { groupByCompany, badge, renderSteps, LEVEL_LABEL, KIND_LABEL, KINDS_ORDER } = window.Screens;

  // --- Holding detail ----------------------------------------------------------

  async function renderHoldingDetail(screen, id) {
    screen.replaceChildren(el('div', { id: 'alerts' }));
    const { status, data } = await api(`/api/holdings/${encodeURIComponent(id)}`);
    if (status === 404) return renderNotFound(screen);
    if (status !== 200) return showAlert('Something went wrong.');

    const h = data.holding;
    const wrap = el('div', { class: 'two-col' });
    const left = el('div');
    const right = el('div', { class: 'exposure-col' });

    const rules = await api('/api/rules');
    function ruleLabelFor(holding) {
      const rule = (rules.data ? rules.data.rules : []).find((r) => r.id === holding.rule_id);
      return rule ? rule.label : 'Graded by rule';
    }

    left.appendChild(el('h1', { class: 'screen-title', text: h.company }));
    const detail = el('dl');
    const rows = [
      ['Data kind', KIND_LABEL[h.data_kind] || h.data_kind],
      ['Level', LEVEL_LABEL[h.level]],
      ['Value', h.value],
      ['Notes', h.notes || '—'],
      ['Graded by', h.rule_id ? ruleLabelFor(h) : 'No rule matched'],
      ['Affected', h.affected ? 'yes' : 'no'],
    ];
    for (const [k, v] of rows) {
      detail.appendChild(el('dt', { text: k }));
      detail.appendChild(el('dd', { text: v }));
    }
    left.appendChild(detail);

    const editBtn = el('button', { type: 'button', text: 'Edit holding' });
    const deleteBtn = el('button', { type: 'button', class: 'danger', text: 'Delete holding' });
    const actions = el('div', { class: 'form-actions' });
    actions.append(editBtn, deleteBtn);
    left.appendChild(actions);

    renderExposurePanelMini(right);
    wrap.append(left, right);
    screen.appendChild(wrap);

    editBtn.addEventListener('click', () => window.Dialogs.openHoldingDialog(h, () => renderHoldingDetail(screen, id)));

    deleteBtn.addEventListener('click', () => {
      const dlg = el('dialog', { 'aria-label': 'Delete holding?' });
      const box = el('div');
      box.appendChild(el('h2', { class: 'section-title', text: 'Delete holding?' }));
      box.appendChild(el('p', { text: `Delete the ${KIND_LABEL[h.data_kind] || h.data_kind} holding at ${h.company}? This cannot be undone.` }));
      const actions2 = el('div', { class: 'form-actions' });
      const del = el('button', { type: 'button', class: 'danger', text: 'Delete' });
      const keep = el('button', { type: 'button', text: 'Keep' });
      actions2.append(del, keep);
      box.appendChild(actions2);
      dlg.appendChild(box);
      document.body.appendChild(dlg);
      dlg.showModal();
      keep.focus();
      keep.addEventListener('click', () => { dlg.close(); deleteBtn.focus(); });
      del.addEventListener('click', async () => {
        del.disabled = true;   // one delete per confirmation
        const { status: st } = await api(`/api/holdings/${encodeURIComponent(id)}`, { method: 'DELETE' });
        dlg.close();
        dlg.remove();
        if (st === 204) {
          history.pushState({}, '', '/vault');
          location.href = '/vault';
        } else if (st === 404) {
          history.pushState({}, '', '/vault');
          location.href = '/vault';
        } else if (st === 401) {
          location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        } else {
          showAlert('Something went wrong. Your change was not saved.');
          del.disabled = false;
        }
      });
      dlg.addEventListener('keydown', (e) => { if (e.key === 'Tab') window.Dialogs.trapFocus(dlg, e); });
    });

    const exposure = await api('/api/exposure');
    if (exposure.status === 200) {
      renderExposure(exposure.data, { animate: false });
      renderSteps($('#next-steps'), exposure.data.steps, { readOnly: false });
    }
  }

  function renderExposurePanelMini(container) {
    const panel = el('div', { class: 'exposure-panel' });
    panel.appendChild(el('h2', { class: 'section-title', text: 'Exposure score' }));
    const line = el('div', { class: 'score-line' });
    line.appendChild(el('span', { class: 'score-num', id: 'score-num', text: '0' }));
    line.appendChild(el('span', { class: 'preview-tag', id: 'preview-tag', text: 'Preview', hidden: true }));
    line.appendChild(el('span', { class: 'band-name', id: 'band-name' }));
    panel.appendChild(line);
    panel.appendChild(el('ul', { class: 'steps', id: 'next-steps', role: 'list', 'aria-label': 'Next steps' }));
    panel.appendChild(el('div', { id: 'exposure-updates', class: 'status-line', role: 'status', 'aria-live': 'polite' }));
    container.replaceChildren(panel);
  }

  function renderNotFound(screen) {
    const wrap = el('div', { class: 'empty-state' });
    wrap.appendChild(el('h1', { class: 'screen-title', text: 'Not found' }));
    wrap.appendChild(el('p', { text: 'This record does not exist or is not in your view.' }));
    wrap.appendChild(el('a', { href: '/vault', text: 'Back to ledger' }));
    screen.replaceChildren(wrap);
  }

  // --- Breaches list -------------------------------------------------------------

  async function renderBreachesScreen(screen) {
    screen.replaceChildren(el('div', { id: 'alerts' }));
    const { status, data } = await api('/api/breaches');
    if (status !== 200) return showAlert('Something went wrong.');
    const list = el('ul', { class: 'breach-list', role: 'list' });
    if (!data.breaches.length) {
      list.appendChild(el('li', { class: 'empty-state', text: 'No breaches logged.' }));
    }
    for (const b of data.breaches) {
      const li = el('li', { role: 'listitem' });
      const a = el('a', { href: `/vault/breaches/${b.id}`, text: `${b.company} — ${b.announced_on}` });
      li.appendChild(a);
      list.appendChild(li);
    }
    screen.appendChild(el('h1', { class: 'screen-title', text: 'Breaches' }));
    screen.appendChild(list);

    startStream(async () => { await renderBreachesScreen(screen); }, () => {});
  }

  // --- Breach detail ----------------------------------------------------------------

  async function renderBreachDetail(screen, id) {
    screen.replaceChildren(el('div', { id: 'alerts' }));
    const first = await api(`/api/breaches/${encodeURIComponent(id)}`);
    if (first.status === 404) return renderNotFound(screen);
    if (first.status !== 200) return showAlert('Something went wrong.');
    const breach = first.data.breach;
    let version = breach.version;
    const unsavedKinds = new Set(breach.data_kinds);

    async function draw({ keepTicks = true } = {}) {
      const { status, data } = await api(`/api/breaches/${encodeURIComponent(id)}`);
      if (status !== 200) return;
      version = data.breach.version;
      if (!keepTicks) {
        unsavedKinds.clear();
        for (const k of data.breach.data_kinds) unsavedKinds.add(k);
      }
      screen.replaceChildren();
      screen.appendChild(el('div', { id: 'alerts' }));
      const wrap = el('div', { class: 'two-col' });
      const left = el('div');
      const right = el('div', { class: 'exposure-col' });

      left.appendChild(el('h1', { class: 'screen-title', text: `Breach at ${data.breach.company}` }));
      left.appendChild(el('p', { text: `Announced on ${data.breach.announced_on}` }));

      const form = el('form', { 'aria-label': 'Edit breach kinds' });
      const group = el('fieldset');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Data kinds');
      group.appendChild(el('legend', { text: 'Data kinds' }));
      for (const code of KINDS_ORDER) {
        const row = el('label', { class: 'checkrow' });
        const cb = el('input', { type: 'checkbox', name: 'data_kinds', value: code });
        cb.checked = unsavedKinds.has(code);
        cb.addEventListener('change', () => {
          if (cb.checked) unsavedKinds.add(code); else unsavedKinds.delete(code);
          requestProjected();
        });
        row.append(cb, el('span', { text: KIND_LABEL[code] }));
        group.appendChild(row);
      }
      form.appendChild(group);

      const saveRow = el('div', { class: 'form-actions' });
      const save = el('button', { type: 'button', text: 'Save kinds' });
      const projected = el('span', { class: 'status-line', id: 'projected-score', role: 'status', 'aria-live': 'polite' });
      saveRow.append(save, projected);
      form.appendChild(saveRow);
      left.appendChild(form);

      const removeBtn = el('button', { type: 'button', class: 'danger', text: 'Remove breach' });
      left.appendChild(removeBtn);

      const affectedWrap = el('div');
      affectedWrap.appendChild(el('h2', { class: 'section-title', text: 'Affected holdings' }));
      const table = el('table', { class: 'ledger', 'aria-label': 'Affected holdings' });
      const thead = el('thead');
      const trh = el('tr');
      for (const label of ['Company', 'Data kind', 'Level']) trh.appendChild(el('th', { scope: 'col', text: label }));
      thead.appendChild(trh);
      table.appendChild(thead);
      const tbody = el('tbody');
      for (const h of data.holdings) {
        const tr = el('tr', { class: 'holding-row' });
        tr.append(
          el('td', { text: h.company }),
          el('td', { text: KIND_LABEL[h.data_kind] || h.data_kind }),
          el('td').appendChild(badge(h.level)).parentNode
        );
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      affectedWrap.appendChild(table);
      left.appendChild(affectedWrap);

      left.appendChild(el('h2', { class: 'section-title', text: 'Steps for this breach' }));
      const stepsEl = el('ul', { class: 'steps', role: 'list', 'aria-label': 'Steps for this breach' });
      for (const s of data.steps) {
        const li = el('li', { class: `step ${s.status}`, role: 'listitem' });
        li.appendChild(el('span', { class: 'step-text', text: s.text }));
        li.appendChild(el('span', { class: 'step-meta', text: `${s.company}` }));
        li.appendChild(el('span', { class: 'step-points num', text: `${s.points}` }));
        li.appendChild(el('span', { text: s.status === 'done' ? 'Done' : 'Open' }));
        stepsEl.appendChild(li);
      }
      left.appendChild(stepsEl);

      renderExposurePanelMini(right);
      wrap.append(left, right);
      screen.appendChild(wrap);

      const exposure = await api('/api/exposure');
      if (exposure.status === 200) {
        renderExposure(exposure.data, { animate: false });
        setScoreNumber(exposure.data.score, { animate: false });
      }

      async function requestProjected() {
        const { status: st, data: pd } = await api('/api/breaches/preview', {
          method: 'POST',
          body: { company: data.breach.company, data_kinds: [...unsavedKinds], breach_id: id },
        });
        if (st === 200) {
          projected.textContent = `Projected score ${pd.score}`;
          requestAnimationFrame(() => { projected.textContent = `Projected score ${pd.score}`; });
        }
      }
      requestProjected();

      save.addEventListener('click', async () => {
        save.disabled = true;
        save.textContent = 'Working...';
        const { status: st, data: sd } = await api(`/api/breaches/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { version, data_kinds: [...unsavedKinds] },
        });
        save.disabled = false;
        save.textContent = 'Save kinds';
        if (st === 200) {
          announce('exposure-updates', `Breach updated. Exposure score ${sd.exposure.score}.`);
          await draw({ keepTicks: false });
        } else if (st === 401) {
          storeDraft('breach-kinds', { id, version, data_kinds: [...unsavedKinds] });
          location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        } else if (st === 409 && sd && sd.error && sd.error.code === 'stale_version') {
          // The ticks are replaced by the server's current kinds.
          showAlert(sd.error.message);
          await draw({ keepTicks: false });
        } else if (st === 422) {
          showFieldErrors(form, (sd && sd.error && sd.error.fields) || {});
        } else {
          showAlert('Something went wrong. Your change was not saved.');
        }
      });

      removeBtn.addEventListener('click', () => {
        const dlg = el('dialog', { 'aria-label': 'Remove breach?' });
        const box = el('div');
        box.appendChild(el('h2', { class: 'section-title', text: 'Remove breach?' }));
        box.appendChild(el('p', { text: `Remove the breach at ${data.breach.company}?` }));
        const actions3 = el('div', { class: 'form-actions' });
        const rm = el('button', { type: 'button', class: 'danger', text: 'Remove' });
        const keep = el('button', { type: 'button', text: 'Keep' });
        actions3.append(rm, keep);
        box.appendChild(actions3);
        dlg.appendChild(box);
        document.body.appendChild(dlg);
        dlg.showModal();
        keep.focus();
        keep.addEventListener('click', () => { dlg.close(); dlg.remove(); removeBtn.focus(); });
        rm.addEventListener('click', async () => {
          rm.disabled = true;
          const { status: st } = await api(`/api/breaches/${encodeURIComponent(id)}`, { method: 'DELETE' });
          dlg.close();
          dlg.remove();
          if (st === 204) {
            history.pushState({}, '', '/vault/breaches');
            location.href = '/vault/breaches';
          } else if (st === 401) {
            location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
          } else {
            showAlert('Something went wrong. Your change was not saved.');
            rm.disabled = false;
          }
        });
      });
    }

    await draw();
    startStream(async (event) => {
      if (event.type && event.type.startsWith('breach.') && event.id === id) {
        await draw({ keepTicks: true });
      }
    }, () => {});
  }

  window.Screens.renderHoldingDetail = renderHoldingDetail;
  window.Screens.renderBreachesScreen = renderBreachesScreen;
  window.Screens.renderBreachDetail = renderBreachDetail;
  window.Screens.renderNotFound = renderNotFound;
})();
