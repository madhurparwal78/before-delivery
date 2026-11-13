/* Ledger, holding detail, breach screens, rules, contact and account screens. */

(() => {
  'use strict';
  const { S, api, el, $, announce, showAlert, setScoreNumber, showPreviewTag,
    renderExposure, startStream, stopStream, storeDraft, loadDraft, discardDraft,
    remainingText, showFieldErrors, clearFieldErrors, REDUCED } = window.Strongroom;
  const { groupByCompany, badge, readFilters, filtersToQuery, applyFiltersToAddress,
    renderLedger, renderFilterBar, renderExposurePanel, renderSteps, LEVEL_LABEL,
    KIND_LABEL, KINDS_ORDER } = window.Screens;

  // --- Ledger screen ----------------------------------------------------------

  async function renderLedgerScreen(screen) {
    const isOwner = S.role === 'owner';
    const route = isOwner ? '/vault' : '/shared';

    const layout = el('div', { class: 'two-col' });
    const left = el('div', { class: 'ledger-col' });
    const right = el('div', { class: 'exposure-col' });

    const alerts = el('div', { id: 'alerts' });
    screen.appendChild(alerts);

    if (!isOwner) {
      // The pinned score band on narrow screens.
      const band = el('div', { class: 'score-band' });
      band.appendChild(el('span', { class: 'score-num', id: 'band-score', text: String(S.committedScore ?? 0) }));
      band.appendChild(el('span', { class: 'band-name', id: 'band-name-band', text: '' }));
      const accessTime = el('div', { class: 'status-line', id: 'access-time', role: 'status', 'aria-live': 'polite' });
      band.appendChild(accessTime);
      left.appendChild(band);
      left.appendChild(el('div', { id: 'shared-updates', class: 'status-line', role: 'status', 'aria-live': 'polite' }));
    } else {
      // Owners get the pinned score band too: it holds the Log breach button.
      const band = el('div', { class: 'score-band' });
      band.appendChild(el('span', { class: 'score-num', id: 'band-score', text: String(S.committedScore ?? 0) }));
      band.appendChild(el('span', { class: 'band-name', id: 'band-name-band', text: '' }));
      left.appendChild(band);
    }

    const title = el('h1', { class: 'screen-title', text: isOwner ? 'Ledger' : `Shared by ${S.me.name}` });
    left.appendChild(title);
    if (isOwner) {
      const addBtn = el('button', { type: 'button', id: 'add-holding', text: 'Add holding' });
      addBtn.addEventListener('click', () => window.Dialogs.openHoldingDialog(null, refresh));
      left.appendChild(addBtn);
    }
    left.appendChild(el('div', { id: 'filter-slot' }));
    left.appendChild(el('div', { id: 'ledger-slot' }));
    left.appendChild(el('div', { class: 'status-line', id: 'results-status', role: 'status', 'aria-live': 'polite' }));

    renderExposurePanel(right, { readOnly: !isOwner });
    if (!isOwner) {
      right.prepend(el('div', { class: 'status-line', id: 'access-time-panel', role: 'status', 'aria-live': 'polite' }));
    }
    layout.append(left, right);
    screen.appendChild(layout);

    let currentFilters = readFilters();
    if (currentFilters.changed) {
      applyFiltersToAddress(currentFilters, { replace: true });
    }

    async function refresh({ fromTyping = false } = {}) {
      const query = filtersToQuery(currentFilters);
      const { status, data } = await api(`/api/holdings${query}`);
      if (status === 401) return;
      if (status === 403 && data && data.error && data.error.code === 'access_ended') {
        renderAccessEnded(screen);
        return;
      }
      if (status !== 200) return;
      renderFilterBar($('#filter-slot'), currentFilters, data.facets, (f, opts) => {
        currentFilters = f;
        refresh(opts);
      });
      renderLedger($('#ledger-slot'), data, { readOnly: !isOwner, filters: currentFilters });
      announce('results-status', `Holdings shown: ${data.total}.`);
      renderExposure(data.exposure, { animate: !fromTyping });
      renderSteps($('#next-steps'), data.exposure.steps, { readOnly: !isOwner });
      if (isOwner) window.Screens.setupStepListKeyboard($('#next-steps'));
      if (!isOwner) {
        refreshAccessTime();
      }
    }

    async function refreshAccessTime() {
      const { status, data } = await api('/api/contact/grant');
      const line1 = document.getElementById('access-time');
      const line2 = document.getElementById('access-time-panel');
      if (status === 200 && data) {
        const text = data.status === 'active'
          ? `Access ends in ${remainingText(data.remaining_seconds)}`
          : 'Access ended.';
        if (line1) line1.textContent = text;
        if (line2) line2.textContent = text;
      }
    }

    if (isOwner) {
      const logBtn = document.getElementById('log-breach');
      logBtn.addEventListener('click', () => window.Dialogs.openBreachForm(refresh));
    }

    await refresh();

    if (!isOwner) {
      setInterval(() => { if (!S.streamStopped) refreshAccessTime(); }, 15000);
      startStream(async (event) => {
        if (event.type === 'grant.updated') {
          announce('shared-updates', 'The owner narrowed what you can see.');
        } else {
          announce('shared-updates', 'Shared view updated.');
        }
        await refresh();
        refreshAccessTime();
      }, () => { renderAccessEnded(screen); });
    } else {
      startStream(async () => {
        // Live redraws wait until the breach form is closed.
        if (S.breachForm && S.breachForm.open) {
          requestBreachPreview(true);
          return;
        }
        await refresh();
      }, () => {});
    }
  }

  function renderAccessEnded(screen) {
    stopStream();
    S.streamStopped = true;
    screen.replaceChildren();
    const wrap = el('div', { class: 'empty-state' });
    wrap.appendChild(el('h1', { class: 'screen-title', text: 'Access ended' }));
    wrap.appendChild(el('p', { text: 'This shared view has ended. Ask the vault owner for a new grant.' }));
    wrap.appendChild(el('div', { id: 'shared-updates', role: 'status', 'aria-live': 'polite', text: 'Access ended.' }));
    screen.appendChild(wrap);
  }

  window.Screens.renderLedgerScreen = renderLedgerScreen;
  window.Screens.renderAccessEnded = renderAccessEnded;
})();
