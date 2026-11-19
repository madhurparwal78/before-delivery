// The window desk: scores, Break the Month, the Hour Wall and the window's actions.

import { get, post, put } from '../api.js';
import { Dialog, field } from '../dialog.js';
import { announce, clear, el, liveRegion, problems } from '../dom.js';
import { commas, percent } from '../format.js';
import { HourWall, describeHours } from '../hourwall.js';
import { GRAINS, ScorePanel } from '../scorepanel.js';
import { linkTo, pushQuery, render, replaceQuery } from '../router.js';
import { countdown } from '../timers.js';

const ALLOCATION_ACTIONS = new Set([
  'Pull meters',
  'Repair gaps',
  'Spread a total',
  'Rerun allocation',
  'Sync holdings',
]);

export async function mount({ container, params, query, account }) {
  const windowId = params[0];
  const first = await get(`/api/windows/${windowId}`);
  if (first.status === 404) {
    container.append(
      el('div', { className: 'panel stack' }, [
        el('h1', { text: 'THAT PAGE DOES NOT EXIST.' }),
      ])
    );
    return {};
  }
  let record = first.data;
  let seenRevision = record.revision;
  let selected = [];
  let hourPanel = null;
  let pendingAction = null;

  const panel = new ScorePanel({
    windowId,
    onHourGrain: (data) => {
      wall.update(describeHours(data.buckets, record.site.time_zone));
    },
  });
  panel.setMonthScore(record.scores.month_bp);

  const wall = new HourWall({
    timeZone: record.site.time_zone,
    onOpen: (key) => {
      pushQuery(addressFor(panel.grain(), key));
      openHourPanel(key);
    },
    onSelection: (keys) => {
      selected = keys;
      paintActions();
    },
  });

  const actionBanner = el('div', {});
  const stateBanners = el('div', {});
  const banners = el('div', {}, [actionBanner, stateBanners]);
  const facts = el('div', { className: 'stack' });
  const actions = el('div', {
    role: 'region',
    'aria-label': 'Window actions',
    className: 'panel panel--mustard stack',
  });
  const wallHolder = el('div', {});
  const desk = el(
    'div',
    { role: 'region', 'aria-label': 'Window desk', className: 'desk-grid' },
    [
      el('div', { className: 'stack' }, [
        banners,
        panel.node,
        panel.sliderShell,
        wallHolder,
        panel.buckets,
      ]),
      actions,
    ]
  );
  container.append(
    el('div', { className: 'panel stack' }, [
      el('h1', { text: `${record.site.name} ${record.month}` }),
    ]),
    desk,
    liveRegion('Grain score', 'status'),
    liveRegion('Wall selection', 'status')
  );

  desk.addEventListener('keydown', (event) => {
    if (event.key !== 'a' || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.querySelector('#overlays .dialog')) {
      return;
    }
    if (record.state !== 'Reconciling') return;
    event.preventDefault();
    runAction('Rerun allocation', () =>
      post(`/api/windows/${windowId}/allocation`, { revision: record.revision })
    );
  });

  function addressFor(grain, hour) {
    const tail = hour ? `&hour=${hour}` : '';
    return `/windows/${windowId}?grain=${grain}${tail}`;
  }

  // ---------------------------------------------------------------- actions

  function actionButton(name, run, { pink = false } = {}) {
    const button = el('button', { type: 'button', text: name });
    if (pink) button.classList.add('button');
    button.addEventListener('click', () => runAction(name, run, button));
    return button;
  }

  async function runAction(name, run, button) {
    if (pendingAction) return;
    pendingAction = name;
    clear(actionBanner);
    if (button) button.setAttribute('aria-disabled', 'true');
    panel.numeral.textContent = 'COUNTING';
    const answer = await run();
    pendingAction = null;
    if (button) button.removeAttribute('aria-disabled');
    if (answer.cancelled) return;
    if (answer.status !== 200 && answer.status !== 202) {
      showRefusal(answer);
      await reload({ silent: true });
      return;
    }
    const body = answer.data;
    const next = body.window || body;
    if (name === 'Pull meters') {
      announce(
        'Desk status',
        `Pull done. ${body.hours_read} hours read. ${next.missing_hours} hours still Missing.`
      );
    }
    if (name === 'Repair gaps') {
      announce(
        'Desk status',
        `Repair done. ${body.filled.length} hours filled.` +
          ` ${next.missing_hours} hours still Missing.`
      );
    }
    if (name === 'Sync holdings' && body.held_elsewhere && body.held_elsewhere.length) {
      announce(
        'Desk status',
        `${body.held_elsewhere.length} bundles are held by another window.`
      );
    }
    if (name === 'Submit for review') {
      announce('Desk status', 'Sent for review. The verifier has 25 hours to test.');
    }
    if (name === 'Cancel certificates') {
      if (next.state === 'Reconciling') {
        announce('Desk alert', 'The registry rejected a line — back to reconciling.');
        banner('The registry rejected a line — back to reconciling.');
      } else {
        announce('Desk status', 'Sent to the registry. Lots read Cancelled once it confirms.');
      }
    }
    applyRecord(next, { own: true });
    if (ALLOCATION_ACTIONS.has(name)) announceAllocation(next);
    await refreshGrain();
  }

  function announceAllocation(next) {
    announce(
      'Desk status',
      `Allocation done. Hour score ${percent(next.scores.hour_bp)} percent.` +
        ` ${next.unmatched_hours} unmatched hours.`
    );
  }

  function showRefusal(answer) {
    const failure = answer.error;
    if (!failure) return;
    banner(failure.message);
    announce('Desk alert', failure.message);
  }

  function banner(text) {
    clear(actionBanner);
    actionBanner.append(el('div', { className: 'outage', text }));
  }

  // ----------------------------------------------------------------- panels

  async function openHourPanel(key) {
    if (hourPanel && hourPanel.hour === key) return;
    if (hourPanel) hourPanel.dialog.close({ focusTarget: null });
    const answer = await get(`/api/windows/${windowId}/hours/${key}`);
    if (answer.status !== 200) {
      replaceQuery(addressFor(panel.grain()));
      return;
    }
    const detail = answer.data;
    const openedRevision = record.revision;
    const dialog = new Dialog({ name: 'Hour detail', variant: 'dialog--pink' });
    dialog.node.dataset.formRoot = 'true';
    const figures = el('div', { className: 'stack' });
    const lines = el('div', { className: 'stack' });
    dialog.bodyNode.append(figures, lines);
    const state = {
      dialog,
      hour: key,
      figures,
      lines,
      openedRevision,
      typed: null,
      retry: null,
    };
    hourPanel = state;
    paintHourFigures(state, detail);
    const closeButton = el('button', { type: 'button', text: 'Close' });
    closeButton.addEventListener('click', () => dialog.close());
    if (
      (detail.quality === 'Missing' || detail.quality === 'Estimated') &&
      record.state === 'Reconciling'
    ) {
      const value = field({ label: 'Substitution value in watt-hours', name: 'value_wh' });
      const reason = field({ label: 'Reason', name: 'reason', multiline: true });
      const save = el('button', { type: 'button', text: 'Save substitution' });
      state.typed = { value: value.input, reason: reason.input };
      save.addEventListener('click', () => saveSubstitution(state, save));
      dialog.bodyNode.append(value.wrap, reason.wrap);
      dialog.buttonsNode.append(save, closeButton);
    } else {
      dialog.buttonsNode.append(closeButton);
    }
    dialog.onClose = () => {
      const cell = wall.cells.get(key);
      hourPanel = null;
      if (window.location.search.includes('hour=')) {
        replaceQuery(addressFor(panel.grain()));
      }
      if (cell && !dialog.opener) cell.focus();
    };
  }

  function paintHourFigures(state, detail) {
    const figures = state.figures;
    clear(figures);
    figures.append(
      el('p', { text: `${detail.hour_utc} UTC` }),
      el('p', { text: detail.local_label }),
      el('p', {
        text:
          detail.consumed_wh === null
            ? 'Consumed none'
            : `Consumed ${commas(detail.consumed_wh)} Wh`,
      }),
      el('p', { text: `Matched ${commas(detail.matched_wh)} Wh` }),
      el('p', { text: detail.quality })
    );
    if (detail.substitution_reason) {
      figures.append(
        el('p', { className: 'exact', text: detail.substitution_reason })
      );
    }
    clear(state.lines);
    detail.lines.forEach((line) =>
      state.lines.append(
        el('p', {
          text:
            `${line.lot_name} ${commas(line.wh)} Wh, range ` +
            `${commas(line.range_start_wh)} to ${commas(line.range_end_wh)}, ${line.status}`,
        })
      )
    );
  }

  async function saveSubstitution(state, button, { latest = false } = {}) {
    const raw = state.typed.value.value.trim();
    if (!/^\d+$/.test(raw)) {
      problems(state.dialog.problemsRegion, {
        fields: { value_wh: 'Enter a whole number of watt-hours.' },
      });
      return;
    }
    button.setAttribute('aria-disabled', 'true');
    const revision = latest ? record.revision : state.openedRevision;
    const answer = await put(
      `/api/windows/${windowId}/hours/${state.hour}/substitution`,
      {
        revision,
        value_wh: Number(raw),
        reason: state.typed.reason.value,
      }
    );
    button.removeAttribute('aria-disabled');
    if (answer.cancelled) return;
    if (answer.status === 200) {
      clear(state.dialog.problemsRegion);
      applyRecord(answer.data, { own: true });
      announceAllocation(answer.data);
      state.dialog.close();
      await refreshGrain();
      return;
    }
    problems(state.dialog.problemsRegion, answer.error);
    if (answer.error && answer.error.code === 'STALE_REVISION' && !state.retry) {
      const retry = el('button', { type: 'button', text: 'Retry on latest' });
      retry.addEventListener('click', async () => {
        await reload({ silent: true });
        await saveSubstitution(state, retry, { latest: true });
      });
      state.retry = retry;
      state.dialog.buttonsNode.prepend(retry);
    }
  }

  function openSpread() {
    const dialog = new Dialog({ name: 'Spread a total' });
    dialog.node.dataset.formRoot = 'true';
    const total = field({ label: 'Total in watt-hours', name: 'total_wh' });
    const reason = field({ label: 'Reason', name: 'reason', multiline: true });
    const spread = el('button', { type: 'button', text: 'Spread' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    cancel.addEventListener('click', () => dialog.close());
    spread.addEventListener('click', async () => {
      const raw = total.input.value.trim();
      if (!/^\d+$/.test(raw)) {
        problems(dialog.problemsRegion, {
          fields: { total_wh: 'Enter a whole number of watt-hours.' },
        });
        return;
      }
      const hours = selected.slice();
      const focusKey = wall.focusKey;
      spread.setAttribute('aria-disabled', 'true');
      const answer = await post(`/api/windows/${windowId}/hours/spread`, {
        revision: record.revision,
        hours,
        total_wh: Number(raw),
        reason: reason.input.value,
      });
      spread.removeAttribute('aria-disabled');
      if (answer.cancelled) return;
      if (answer.status !== 200) {
        problems(dialog.problemsRegion, answer.error);
        return;
      }
      announce('Desk status', `Spread done. ${hours.length} hours filled.`);
      applyRecord(answer.data, { own: true });
      announceAllocation(answer.data);
      wall.clearSelection();
      selected = [];
      paintActions();
      await refreshGrain();
      dialog.close({ focusTarget: wall.cells.get(focusKey) || null });
    });
    dialog.bodyNode.append(total.wrap, reason.wrap);
    dialog.buttonsNode.append(spread, cancel);
  }

  // ------------------------------------------------------------------ paint

  const buttons = {
    'Pull meters': actionButton('Pull meters', () =>
      post(`/api/windows/${windowId}/meters/pull`, { revision: record.revision })
    ),
    'Repair gaps': actionButton('Repair gaps', () =>
      post(`/api/windows/${windowId}/gaps/repair`, { revision: record.revision })
    ),
    'Spread a total': spreadButton(),
    'Rerun allocation': actionButton('Rerun allocation', () =>
      post(`/api/windows/${windowId}/allocation`, { revision: record.revision })
    ),
    'Sync holdings': actionButton('Sync holdings', () =>
      post(`/api/windows/${windowId}/holdings/sync`, { revision: record.revision })
    ),
    'Submit for review': actionButton('Submit for review', () =>
      post(`/api/windows/${windowId}/submit`, { revision: record.revision })
    ),
    'Resume reconciling': actionButton('Resume reconciling', () =>
      post(`/api/windows/${windowId}/resume`, { revision: record.revision })
    ),
    'Cancel certificates': actionButton('Cancel certificates', () =>
      post(`/api/windows/${windowId}/cancellations`, {})
    ),
  };

  function spreadButton() {
    const button = el('button', { type: 'button', text: 'Spread a total' });
    button.addEventListener('click', () => openSpread());
    return button;
  }

  const reviewTimer = countdown({
    label: 'Review time left',
    seconds: null,
    reask: () => reload({ silent: true }),
  });
  const opensTimer = countdown({
    label: 'Opens in',
    seconds: null,
    reask: () => reload({ silent: true }),
  });
  const factLines = {
    state: el('p', { className: 'word' }),
    missing: el('p', {}),
    unmatched: el('p', {}),
    unmatchedHours: el('p', {}),
    residual: el('p', {}),
    confirmed: el('p', { hidden: true }),
    reason: el('p', { className: 'exact', hidden: true }),
    review: el('p', { hidden: true }, [reviewTimer.node]),
    opens: el('p', { hidden: true }, [opensTimer.node]),
  };
  facts.append(...Object.values(factLines));
  actions.append(
    ...Object.values(buttons),
    el('div', { className: 'row' }, [
      linkTo(`/windows/${windowId}/lots`, 'Lots'),
      linkTo(`/windows/${windowId}/ledger`, 'Ledger'),
    ]),
    facts
  );

  function paintActions() {
    const state = record.state;
    const shown = new Set();
    const analyst = account.role === 'analyst';
    if (analyst && (state === 'Reconciling' || state === 'Awaiting meters')) {
      shown.add('Pull meters');
    }
    if (analyst && state === 'Reconciling') {
      ['Repair gaps', 'Rerun allocation', 'Sync holdings', 'Submit for review'].forEach(
        (name) => shown.add(name)
      );
      if (selected.length >= 2) shown.add('Spread a total');
    }
    if (analyst && state === 'Returned') shown.add('Resume reconciling');
    if (analyst && state === 'Cancelling') {
      shown.add('Cancel certificates');
    }
    Object.entries(buttons).forEach(([name, button]) => {
      if (shown.has(name)) button.removeAttribute('hidden');
      else button.setAttribute('hidden', '');
    });
    paintFacts();
  }

  function paintFacts() {
    const timeout = 'REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST.';
    factLines.state.textContent = record.state;
    factLines.missing.textContent = `Missing hours ${record.missing_hours}`;
    factLines.unmatched.textContent = `Unmatched ${commas(record.unmatched_wh)} Wh`;
    factLines.unmatchedHours.textContent = `Unmatched hours ${record.unmatched_hours}`;
    factLines.residual.textContent =
      record.residual_emissions_g === null
        ? 'Residual unknown g CO2'
        : `Residual ${commas(record.residual_emissions_g)} g CO2`;
    const showConfirmed = ['Cancelling', 'Cancelled', 'Signed', 'Sealed', 'Restated'].includes(
      record.state
    );
    factLines.confirmed.hidden = !showConfirmed;
    factLines.confirmed.textContent = `Confirmed ${record.lines_confirmed} of ${record.lines_total} lines`;
    const reason = record.returned_reason;
    factLines.reason.hidden = !reason || reason === timeout;
    factLines.reason.textContent = reason || '';
    factLines.review.hidden = record.state !== 'In review';
    if (record.state === 'In review') reviewTimer.set(record.review_seconds_left);
    factLines.opens.hidden =
      record.state !== 'Awaiting meters' || record.opens_seconds_left === null;
    if (!factLines.opens.hidden) opensTimer.set(record.opens_seconds_left);
  }

  function paintBanners() {
    clear(stateBanners);
    const notConfirmed = record.lines_total - record.lines_confirmed;
    if (!record.registry_reachable && notConfirmed > 0) {
      stateBanners.append(
        el('div', {
          className: 'outage',
          text: `REGISTRY IS DOWN. WAITING ON ${notConfirmed} LINES.`,
        })
      );
    }
    if (record.residual_emissions_g === null) {
      stateBanners.append(
        el('div', {
          className: 'outage',
          text: 'GRID FACTORS ARE LATE. SCORES DID NOT CHANGE.',
        })
      );
    }
    if (record.returned_reason === 'REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST.') {
      stateBanners.append(
        el('div', {
          className: 'outage',
          text: 'REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST.',
        })
      );
    }
  }

  function applyRecord(next, { own = false } = {}) {
    const previous = record;
    record = next;
    panel.setMonthScore(next.scores.month_bp);
    if (!own && next.revision > seenRevision && next.last_writer_name) {
      if (next.last_writer_name !== account.name) {
        announce(
          'Desk status',
          `${next.last_writer_name} changed this window.` +
            ` Hour score ${percent(next.scores.hour_bp)} percent.`
        );
      }
    }
    if (
      next.state === 'Cancelling' &&
      previous.lines_confirmed !== next.lines_confirmed &&
      !own
    ) {
      announce(
        'Desk status',
        `Registry confirmed ${next.lines_confirmed} of ${next.lines_total} lines.`
      );
    }
    seenRevision = Math.max(seenRevision, next.revision);
    paintActions();
    paintBanners();
    if (hourPanel) refreshHourPanel();
  }

  async function refreshHourPanel() {
    const answer = await get(`/api/windows/${windowId}/hours/${hourPanel.hour}`);
    if (answer.status !== 200 || !hourPanel) return;
    paintHourFigures(hourPanel, answer.data);
  }

  async function reload({ silent = false } = {}) {
    const answer = await get(`/api/windows/${windowId}`);
    if (answer.status === 404) {
      render();
      return;
    }
    if (answer.status !== 200) return;
    applyRecord(answer.data, { own: silent });
  }

  async function refreshGrain() {
    const answer = await get(`/api/windows/${windowId}/grains/${panel.grain()}`);
    if (answer.status === 200) panel.liveUpdate(answer.data);
  }

  // ------------------------------------------------------------------- boot

  function showWall(show) {
    clear(wallHolder);
    if (show) wallHolder.append(wall.region);
  }

  async function gotoGrain(grain, { silent = false } = {}) {
    const index = GRAINS.indexOf(grain);
    showWall(grain === 'hour');
    await panel.move(index === -1 ? 0 : index, { silent });
  }

  const startGrain = GRAINS.includes(query.grain) ? query.grain : 'month';
  panel.slider.addEventListener('change', () => {
    const grain = GRAINS[Number(panel.slider.value)];
    showWall(grain === 'hour');
    replaceQuery(addressFor(grain));
  });
  panel.onGrain = (data, grain) => {
    showWall(grain === 'hour');
    const current = new URLSearchParams(window.location.search);
    if (current.get('grain') !== grain) replaceQuery(addressFor(grain));
  };
  await gotoGrain(startGrain);
  paintActions();
  paintBanners();
  if (query.hour) {
    if (wall.cells.has(query.hour)) openHourPanel(query.hour);
    else replaceQuery(addressFor(panel.grain()));
  }

  return {
    async refresh() {
      await reload();
      await refreshGrain();
    },
    query(next) {
      const grain = GRAINS.includes(next.grain) ? next.grain : 'month';
      if (grain !== panel.grain()) gotoGrain(grain);
      if (next.hour && (!hourPanel || hourPanel.hour !== next.hour)) {
        openHourPanel(next.hour);
      } else if (!next.hour && hourPanel) {
        const cell = wall.cells.get(hourPanel.hour);
        const open = hourPanel;
        hourPanel = null;
        open.dialog.onClose = null;
        open.dialog.close({ focusTarget: cell || null });
      }
    },
  };
}
