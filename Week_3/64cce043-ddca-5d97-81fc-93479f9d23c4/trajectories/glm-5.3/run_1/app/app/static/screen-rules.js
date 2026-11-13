/* Rules screen with the Preview region, drag and keyboard reorder. */

(() => {
  'use strict';
  const { S, api, el, $, announce, showAlert, setScoreNumber, showPreviewTag,
    renderExposure, startStream, stopStream, storeDraft, loadDraft, discardDraft,
    showFieldErrors, clearFieldErrors, REDUCED } = window.Strongroom;
  const { LEVEL_LABEL, KIND_LABEL, KINDS_ORDER } = window.Screens;

  let rules = [];
  let draftOrder = null;      // candidate order while dragging
  let previewSeq = 0;
  let previewThrottle = 0;
  let dragCancelled = false;

  async function renderRulesScreen(screen) {
    screen.replaceChildren();
    screen.appendChild(el('div', { id: 'alerts' }));
    const layout = el('div', { class: 'two-col' });
    const left = el('div');
    const right = el('div', { class: 'exposure-col' });

    left.appendChild(el('h1', { class: 'screen-title', text: 'Grading rules' }));
    const addBtn = el('button', { type: 'button', id: 'add-rule', text: 'Add rule' });
    addBtn.addEventListener('click', () => openRuleDialog(null, refreshAll));
    left.appendChild(addBtn);
    const list = el('ul', { class: 'rule-list', id: 'rules-list', role: 'list', 'aria-label': 'Rules' });
    left.appendChild(list);
    left.appendChild(el('div', { id: 'rule-order-status', class: 'status-line', role: 'status', 'aria-live': 'polite' }));

    right.appendChild(el('div', { class: 'exposure-panel', role: 'region', 'aria-label': 'Preview' }));
    const previewPanel = right.firstChild;
    previewPanel.appendChild(el('h2', { class: 'section-title', text: 'Preview' }));
    const previewTableWrap = el('div', { id: 'preview-table-wrap' });
    previewPanel.appendChild(previewTableWrap);
    const scoreLine = el('div', { class: 'score-line' });
    scoreLine.appendChild(el('span', { class: 'score-num', id: 'score-num', text: '0' }));
    scoreLine.appendChild(el('span', { class: 'band-name', id: 'band-name' }));
    previewPanel.appendChild(scoreLine);
    previewPanel.appendChild(el('div', { id: 'projected-score-line', class: 'status-line', role: 'status', 'aria-live': 'polite' }));
    previewPanel.appendChild(el('div', { id: 'exposure-updates', class: 'status-line', role: 'status', 'aria-live': 'polite' }));

    layout.append(left, right);
    screen.appendChild(layout);

    let savedOrder = [];
    let savedExposure = null;

    async function refreshAll({ fromDrop = false } = {}) {
      const { status, data } = await api('/api/rules');
      if (status !== 200) return;
      rules = data.rules;
      savedOrder = rules.map((r) => r.id);
      draftOrder = null;
      renderRuleList();
      const exposure = await api('/api/exposure');
      if (exposure.status === 200) {
        savedExposure = exposure.data;
        renderExposure(exposure.data, { animate: fromDrop });
      }
      await requestPreview(savedOrder, { live: true });
    }

    function renderRuleList() {
      const order = draftOrder || savedOrder;
      const byId = new Map(rules.map((r) => [r.id, r]));
      list.replaceChildren();
      order.forEach((rid, index) => {
        const rule = byId.get(rid);
        if (!rule) return;
        const li = el('li', { class: 'rule-item', role: 'listitem', 'data-rule-id': rid });
        const grip = el('button', { type: 'button', class: 'grip', 'aria-label': `Move rule: ${rule.label}`,
          'data-grip-id': rid, text: '⠿' });
        const pri = el('span', { class: 'rule-priority num', text: String(index + 1) });
        const label = el('span', { class: 'rule-label', text: rule.label });
        const edit = el('button', { type: 'button', 'aria-label': `Edit rule: ${rule.label}`, text: 'Edit' });
        const del = el('button', { type: 'button', class: 'danger', 'aria-label': `Delete rule: ${rule.label}`, text: 'Delete' });
        edit.addEventListener('click', () => openRuleDialog(rule, refreshAll));
        del.addEventListener('click', async () => {
          const { status } = await api(`/api/rules/${encodeURIComponent(rid)}`, { method: 'DELETE' });
          if (status === 204) {
            announce('exposure-updates', 'Rules updated.');
            await refreshAll();
          } else if (status === 401) {
            location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
          } else {
            showAlert('Something went wrong. Your change was not saved.');
          }
        });
        li.append(grip, pri, label, edit, del);
        list.appendChild(li);
        setupGrip(grip, rule, index, order);
      });
    }

    function setupGrip(grip, rule, index, order) {
      let dragging = false;
      let startIndex = 0;
      let currentIndex = 0;

      function announceOrder(text) {
        announce('rule-order-status', text);
      }

      function preview(orderNow) {
        const now = performance.now();
        if (now - previewThrottle < 150) return;
        previewThrottle = now;
        requestPreview(orderNow, { live: false });
      }

      function startDrag() {
        dragging = true;
        dragCancelled = false;
        startIndex = order.indexOf(rule.id);
        currentIndex = startIndex;
        grip.closest('.rule-item').classList.add('dragging');
        announceOrder(`Picked up ${rule.label}. Position ${currentIndex + 1} of ${order.length}.`);
        preview(order.slice());
      }

      function moveBy(delta) {
        if (!dragging) return;
        const target = Math.max(0, Math.min(order.length - 1, currentIndex + delta));
        if (target === currentIndex) return;
        const next = order.slice();
        next.splice(currentIndex, 1);
        next.splice(target, 0, rule.id);
        currentIndex = target;
        draftOrder = next;
        renderRuleList();
        document.querySelector(`[data-grip-id="${CSS.escape(rule.id)}"]`)?.focus();
        announceOrder(`Position ${currentIndex + 1} of ${order.length}.`);
        preview(next);
      }

      async function drop() {
        if (!dragging) return;
        dragging = false;
        const orderNow = draftOrder || order;
        announceOrder(`Dropped ${rule.label}. Position ${currentIndex + 1} of ${order.length}.`);
        const { status, data } = await api('/api/rules/order', {
          method: 'PUT',
          body: { rule_ids: orderNow },
        });
        if (status === 200) {
          announce('exposure-updates', `Rule order saved. Exposure score ${data.exposure.score}.`);
          draftOrder = null;
          await refreshAll({ fromDrop: true });
          document.querySelector(`[data-grip-id="${CSS.escape(rule.id)}"]`)?.focus();
        } else if (status === 422 || status >= 500 || !status) {
          // The server refused: snap back to its state with the published alert.
          showAlert('The rules changed in another window. The order was not saved.');
          draftOrder = null;
          await refreshAll();
          document.querySelector(`[data-grip-id="${CSS.escape(rule.id)}"]`)?.focus();
        } else if (status === 401) {
          location.href = `/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        }
      }

      function cancelDrag() {
        if (!dragging) return;
        dragging = false;
        draftOrder = null;
        dragCancelled = true;
        renderRuleList();
        announceOrder('Move cancelled.');
        document.querySelector(`[data-grip-id="${CSS.escape(rule.id)}"]`)?.focus();
        requestPreview(savedOrder, { live: true });
      }

      grip.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          if (!dragging) startDrag();
          else drop();
        } else if (e.key === 'Enter' && dragging) {
          e.preventDefault();
          drop();
        } else if (e.key === 'ArrowUp' && dragging) {
          e.preventDefault();
          moveBy(-1);
        } else if (e.key === 'ArrowDown' && dragging) {
          e.preventDefault();
          moveBy(1);
        } else if (e.key === 'Escape' && dragging) {
          e.preventDefault();
          cancelDrag();
        }
      });

      // Pointer drag.
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startDrag();
        const onMove = (ev) => {
          const items = [...list.querySelectorAll('.rule-item')];
          const mid = ev.clientY;
          let target = items.length - 1;
          for (let i = 0; i < items.length; i++) {
            const rect = items[i].getBoundingClientRect();
            if (mid < rect.top + rect.height / 2) { target = i; break; }
          }
          if (target !== currentIndex) {
            const next = order.slice();
            next.splice(currentIndex, 1);
            next.splice(target, 0, rule.id);
            currentIndex = target;
            draftOrder = next;
            renderRuleList();
            preview(next);
          }
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('keydown', onEsc);
          drop();
        };
        const onEsc = (ev) => {
          if (ev.key === 'Escape') {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            cancelDrag();
          }
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('keydown', onEsc);
      });
    }

    async function requestPreview(orderIds, { live = false } = {}) {
      const seq = ++previewSeq;
      const { status, data } = await api('/api/rules/preview', {
        method: 'POST',
        body: { rule_ids: orderIds },
      });
      if (seq !== previewSeq) return;   // latest input wins
      if (status !== 200) return;
      renderPreviewLevels(data.levels || []);
      setScoreNumber(data.score, { animate: !REDUCED() && !live });
      window.Strongroom.syncBandScore(data.score);
      const line = document.getElementById('projected-score-line');
      if (line) line.textContent = `Projected score ${data.score}`;
    }

    function renderPreviewLevels(levels) {
      const wrap = document.getElementById('preview-table-wrap');
      if (!wrap) return;
      const table = el('table', { class: 'ledger', 'aria-label': 'Preview levels' });
      const thead = el('thead');
      const trh = el('tr');
      for (const label of ['Company', 'Data kind', 'Level']) trh.appendChild(el('th', { scope: 'col', text: label }));
      thead.appendChild(trh);
      table.appendChild(thead);
      const tbody = el('tbody');
      for (const lv of levels) {
        const holding = (S.holdingsById || {})[lv.holding_id];
        const tr = el('tr', { class: 'holding-row' });
        tr.append(
          el('td', { text: holding ? holding.company : '' }),
          el('td', { text: holding ? (KIND_LABEL[holding.data_kind] || '') : '' }),
          el('td').appendChild(el('span', { class: `badge ${lv.level}`, text: LEVEL_LABEL[lv.level] })).parentNode
        );
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.replaceChildren(table);
    }

    // Holdings for the preview table's labels.
    const holdingsResp = await api('/api/holdings');
    if (holdingsResp.status === 200) {
      S.holdingsById = {};
      for (const h of holdingsResp.data.items) S.holdingsById[h.id] = h;
    }

    await refreshAll();

    // A live rule.* event during a pick-up cancels it before the redraw.
    startStream(async (event) => {
      if (event.type && event.type.startsWith('rule.')) {
        if ($('.rule-item.dragging')) {
          draftOrder = null;
          announce('rule-order-status', 'Move cancelled.');
        }
        await refreshAll();
      } else if (event.type && event.type.startsWith('holding.')) {
        const holdingsResp2 = await api('/api/holdings');
        if (holdingsResp2.status === 200) {
          S.holdingsById = {};
          for (const h of holdingsResp2.data.items) S.holdingsById[h.id] = h;
        }
        await requestPreview(draftOrder || savedOrder, { live: true });
      }
    }, () => {});
  }

  async function openRuleDialog(existing, refresh) {
    const dlg = el('dialog', { 'aria-label': existing ? 'Edit rule' : 'Add rule' });
    const form = el('form', {});
    form.appendChild(el('h2', { class: 'section-title', text: existing ? 'Edit rule' : 'Add rule' }));

    const grid = el('div', { class: 'form-grid' });
    const kindWrap = el('label');
    kindWrap.appendChild(el('span', { text: 'Data kind' }));
    const kind = el('select', { name: 'data_kind' });
    const anyOpt = el('option', { value: 'any', text: 'Any kind' });
    kind.appendChild(anyOpt);
    for (const code of KINDS_ORDER) {
      const o = el('option', { value: code, text: KIND_LABEL[code] });
      if (existing && existing.data_kind === code) o.selected = true;
      kind.appendChild(o);
    }
    if (existing && existing.data_kind === 'any') anyOpt.selected = true;
    kindWrap.appendChild(kind);
    grid.appendChild(kindWrap);

    const contains = el('input', { type: 'text', name: 'company_contains', value: existing ? existing.company_contains : '' });
    grid.append(el('label', { text: 'Company contains' }), contains);

    const levelWrap = el('label');
    levelWrap.appendChild(el('span', { text: 'Level' }));
    const level = el('select', { name: 'level' });
    for (const code of ['critical', 'high', 'moderate', 'low']) {
      const o = el('option', { value: code, text: LEVEL_LABEL[code] });
      if (existing && existing.level === code) o.selected = true;
      level.appendChild(o);
    }
    levelWrap.appendChild(level);
    grid.appendChild(levelWrap);

    const priority = el('input', { type: 'number', name: 'priority', min: '1', max: '999',
      value: existing ? String(existing.priority) : '' });
    grid.append(el('label', { text: 'Priority' }), priority);

    form.appendChild(grid);
    const actions = el('div', { class: 'form-actions' });
    const save = el('button', { type: 'submit', text: 'Save rule' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    actions.append(save, cancel);
    form.appendChild(actions);
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    cancel.addEventListener('click', () => { dlg.close(); dlg.remove(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      save.disabled = true;
      save.textContent = 'Working...';
      const body = {
        data_kind: kind.value,
        company_contains: contains.value,
        level: level.value,
      };
      if (priority.value !== '') body.priority = Number(priority.value);
      const payload = existing ? { version: existing.version, ...body } : body;
      const { status, data } = await api(existing ? `/api/rules/${existing.id}` : '/api/rules', {
        method: existing ? 'PATCH' : 'POST',
        body: payload,
      });
      save.disabled = false;
      save.textContent = 'Save rule';
      if (status === 201 || status === 200) {
        dlg.close();
        dlg.remove();
        announce('exposure-updates', `Rules updated. Exposure score ${data.exposure.score}.`);
        await refresh();
      } else if (status === 409 && data && data.error && data.error.code === 'stale_version') {
        const alert = showAlert(data.error.message);
        if (alert) alert.focus?.();
      } else if (status === 422) {
        showFieldErrors(form, (data && data.error && data.error.fields) || {});
      } else {
        showAlert('Something went wrong. Your change was not saved.');
      }
    });

    dlg.showModal();
    const first = dlg.querySelector('select');
    if (first) first.focus();
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') window.Dialogs.trapFocus(dlg, e);
      if (e.key === 'Escape') { e.preventDefault(); dlg.close(); dlg.remove(); }
    });
  }

  window.Screens.renderRulesScreen = renderRulesScreen;
})();
