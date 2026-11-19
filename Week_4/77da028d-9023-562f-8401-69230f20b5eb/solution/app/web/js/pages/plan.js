// The Plan screen: tonight (or an explicit observing date) against the painted treeline, the Moon and the sky conditions.
import { mountShell } from '../shell.js';
import { h, uid } from '../core/dom.js';
import { api } from '../core/api.js';
import { announce, liveRegion } from '../core/live.js';
import { createErrorSummary } from '../core/forms.js';
import { longDate, VERDICT_WORDS } from '../core/format.js';
import { siteTimeAt } from '../core/time.js';
import { createVerdictCard } from '../core/verdict-card.js';
import { createChart } from '../plan/chart.js';
import { createDome } from '../plan/dome.js';
import { createTimeBar } from '../plan/timebar.js';
import { createTargetList } from '../plan/targets.js';
import { createAddTargetDialog, createConditionsDialog } from '../plan/dialogs.js';
import { createPlanLoader } from '../plan/plan-loader.js';
import { installShortcuts } from '../plan/shortcuts.js';

const NO_CONDITIONS = 'No sky conditions entered for this night. Add hourly cloud, transparency and seeing to get a verdict.';
const STALE_CONDITIONS = 'Sky conditions are out of date. Re-enter them for the hours still ahead.';
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const SCRUB_DELAYS = { usable: 200, owed: 300 };

function isRealDate(text) {
  return DATE_SHAPE.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
}

function conditionsNotice(plan) {
  if (plan.conditions.hours.length === 0) return NO_CONDITIONS;
  return plan.conditions.stale ? STALE_CONDITIONS : '';
}

function planUpdate(plan) {
  const usable = plan.best ? plan.best.usable_minutes : 0;
  return `At ${plan.time_local}: ${VERDICT_WORDS[plan.verdict]}, ${usable} usable minutes left.`;
}

export async function mount() {
  const { main } = mountShell({ page: 'plan', withCard: false });
  const explicitDate = new URLSearchParams(location.search).get('date');
  const state = { plan: null, minute: 0, maximum: -1 };

  const updates = liveRegion('Plan updates');
  const card = createVerdictCard();
  card.showLoading();
  const chart = createChart();
  const dome = createDome();
  const heading = h('h1', {}, explicitDate !== null && isRealDate(explicitDate) ? `Night of ${longDate(explicitDate)}` : 'Tonight');
  const head = h('header', { class: 'plan-head' }, heading);
  const notice = h('div', { role: 'region', 'aria-label': 'Conditions notice', class: 'notice plan-notice' });

  function timeLabel(minute) {
    const { plan } = state;
    return plan.night.dusk ? siteTimeAt(plan.night.dusk, minute, plan.site.time_zone) : plan.time_local;
  }

  function moveTo(minute, { announce: speak = true, force = false } = {}) {
    if (!state.plan) return;
    const next = Math.min(state.maximum, Math.max(0, Math.round(minute)));
    if (next === state.minute && !force) return;
    state.minute = next;
    bar.show(next);
    dome.setMinute(next);
    loader.load({ minute: next, staged: true, speak });
  }

  function paintPlan(plan, options) {
    state.plan = plan;
    if (plan.night.minutes !== state.maximum) {
      state.maximum = plan.night.minutes;
      state.minute = Math.min(state.minute, state.maximum);
      bar.configure({ maximum: state.maximum, describe: timeLabel });
      bar.show(state.minute);
      dome.setMinute(state.minute);
    }
    heading.textContent = `Night of ${longDate(plan.date)}`;
    if (document.activeElement !== dateInput) dateInput.value = plan.date;
    const banner = conditionsNotice(plan);
    if (notice.textContent !== banner) notice.textContent = banner;
    targetList.update(plan);
    card.paint(plan, options.staged ? { delays: SCRUB_DELAYS } : undefined);
    chart.setPlan(plan, { minute: state.minute, timeLabel: timeLabel(state.minute), staged: Boolean(options.staged) });
    dome.setPlan(plan, { staged: Boolean(options.staged), timeLabel: timeLabel(state.minute) });
    if (options.speak) announce(updates, `${options.prefix || ''}${planUpdate(plan)}`);
  }

  const loader = createPlanLoader({
    explicitDate,
    apply: paintPlan,
    fail: (error) => announce(updates, error.message),
  });

  const bar = createTimeBar({ moveTo });
  const targetList = createTargetList({ onRemove: removeTarget, onFocus: chart.focusTarget });

  const addDialog = createAddTargetDialog({
    getPlan: () => state.plan,
    onAdded: (targetName) => loader.load({ minute: state.minute, speak: true, prefix: `${targetName} added. ` }),
  });
  const conditionsDialog = createConditionsDialog({
    getPlan: () => state.plan,
    announce: (text) => announce(updates, text),
    onSaved: () => loader.load({ minute: state.minute }),
  });

  function openAddTarget(opener = addButton) {
    if (state.plan) addDialog.open(opener);
  }

  async function removeTarget(projectId) {
    const target = state.plan.targets.find((entry) => entry.project_id === projectId);
    try {
      await api('DELETE', `/api/plans/${state.plan.date}/targets/${projectId}`);
    } catch (error) {
      announce(updates, error.message);
      return;
    }
    loader.load({ minute: state.minute, speak: true, prefix: `${target.target_name} removed. ` });
    addButton.focus();
  }

  const addButton = h('button', { type: 'button', class: 'btn btn--primary add-target', onclick: () => openAddTarget() }, 'Add target');
  const conditionsButton = h('button', {
    type: 'button', class: 'btn conditions-button',
    onclick: () => { if (state.plan) conditionsDialog.open(conditionsButton); },
  }, 'Enter sky conditions');

  const dateInput = h('input', { type: 'text', id: uid('date'), inputmode: 'numeric', autocomplete: 'off', placeholder: 'YYYY-MM-DD', value: explicitDate || '' });
  const dateSummary = createErrorSummary();
  const dateForm = h('form', { class: 'plan-date', novalidate: true, onsubmit: (event) => {
    event.preventDefault();
    dateSummary.clear();
    const wanted = dateInput.value.trim();
    if (!isRealDate(wanted)) {
      dateSummary.showFields({ date: 'Enter the observing date as YYYY-MM-DD.' }, () => dateInput);
      return;
    }
    location.assign(`/plan?date=${wanted}`);
  } },
  h('div', { class: 'field' },
    h('label', { for: dateInput.id }, 'Observing date'),
    h('div', { class: 'plan-date-row' }, dateInput,
      h('button', { type: 'button', class: 'btn', onclick: () => location.assign('/plan') }, 'Tonight'))));

  const minimumInput = h('input', { type: 'number', id: uid('minimum'), min: '0', max: '60', step: '1', inputmode: 'numeric' });
  minimumInput.addEventListener('change', async () => {
    try {
      await api('PATCH', '/api/site', { body: { min_altitude_deg: minimumInput.valueAsNumber } });
    } catch (error) {
      announce(updates, error.message);
      return;
    }
    loader.load({ minute: state.minute, speak: true });
  });
  const controls = h('section', { class: 'card plan-controls' },
    dateSummary.element, dateForm,
    h('div', { class: 'field' }, h('label', { for: minimumInput.id }, 'Minimum altitude'), minimumInput, h('span', { class: 'hint' }, 'Degrees above the horizon, 0 to 60.')),
    updates);

  const left = h('div', { class: 'plan-col plan-col--left' });
  const centre = h('div', { class: 'plan-col plan-col--centre' });
  const right = h('div', { class: 'plan-col plan-col--right' });
  const wide = window.matchMedia('(min-width: 1200px)');
  function arrange() {
    if (wide.matches) {
      left.replaceChildren(controls, notice);
      // the time bar sits above the chart here so its handle is in view at 1280x800 and focusing it never scrolls the dome away
      centre.replaceChildren(dome.element, addButton, bar.element, chart.element);
      right.replaceChildren(card.element, targetList.element, conditionsButton);
      main.replaceChildren(head, left, centre, right);
    } else {
      centre.replaceChildren(dome.element, chart.element, bar.element);
      right.replaceChildren(targetList.element, conditionsButton, addButton, controls);
      main.replaceChildren(head, notice, card.element, centre, right);
    }
  }
  main.replaceChildren(h('p', { class: 'live' }, 'Reading the sky...'));

  Promise.all([api('GET', '/api/site'), api('GET', '/api/site/horizon')]).then(([site, horizon]) => {
    minimumInput.value = String(site.min_altitude_deg);
    chart.setHorizon(horizon.altitudes);
    dome.setHorizon(horizon.altitudes);
    dome.setLatitude(site.latitude);
  }).catch((error) => announce(updates, error.message));

  try {
    const first = await loader.first();
    state.minute = first.minute;
    paintPlan(first, {});
  } catch (error) {
    announce(updates, error.message);
  }
  arrange();
  wide.addEventListener('change', arrange);
  installShortcuts({ moveBy: (minutes) => moveTo(state.minute + minutes), openAddTarget: () => openAddTarget(document.activeElement) });
  dome.start();
}
