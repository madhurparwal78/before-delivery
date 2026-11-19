import { api, ApiError } from '../api.js';
import { announce, clear, el, reducedMotion, spinbutton } from '../dom.js';
import { close, isOpen, openDialog } from '../dialog.js';
import { duration, hhmm, longDate, oneDecimal, offsetOf } from '../format.js';
import {
  paintChart,
  targetPoint,
  targetUnderLens,
} from '../skychart.js';
import { RESET_VIEW, SkyDome, webglAvailable } from '../dome.js';
import { bestUsableMinutes, pushStateFor } from '../verdictcard.js';

const NO_CONDITIONS =
  'No sky conditions entered for this night. Add hourly cloud, transparency and ' +
  'seeing to get a verdict.';
const STALE_CONDITIONS =
  'Sky conditions are out of date. Re-enter them for the hours still ahead.';
const NO_WEBGL = '3D sky is unavailable on this device. Showing the flat sky chart.';
const STATUS_TEXT = {
  clear: 'Clear',
  'behind-treeline': 'Behind the treeline',
  'below-minimum': 'Below minimum altitude',
  'below-horizon': 'Below the horizon',
};
const WORDS = { go: 'Go', 'no-go': 'No-go', unknown: 'Unknown' };
const REFRESH_MS = 30000;
const KEY_STEP = 5;
const BIG_STEP = 30;

function domeName(view, minute) {
  return (
    `Sky dome: camera elevation ${Math.round(view.elevation)} degrees, ` +
    `azimuth ${Math.round(view.azimuth) % 360} degrees, ` +
    `zoom ${Number(view.zoom).toFixed(1)}, night minute ${minute}`
  );
}

function isTextControl(node) {
  if (!node) return false;
  const tag = node.tagName;
  return (
    tag === 'TEXTAREA' ||
    (tag === 'INPUT' && ['text', 'number', 'date'].includes(node.type))
  );
}

function touchSpread(touches) {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );
}

export async function renderPlan(main, context) {
  context.ownsCard = true;
  const requestedDate = new URLSearchParams(location.search).get('date');
  const state = {
    plan: null,
    minute: 0,
    date: requestedDate,
    lens: null,
    pinned: null,
    sequence: 0,
    site: null,
    pushes: null,
  };

  const headline = el('h1', { class: 'a-headline', text: 'Night of \u2026' });
  const dateBox = el('input', {
    type: 'text',
    id: 'plan-date',
    'aria-label': 'Observing date',
    value: requestedDate || '',
    placeholder: 'YYYY-MM-DD',
  });
  const tonightButton = el('button', { type: 'button', text: 'Tonight' });
  const domeCanvas = el('canvas', {
    role: 'img',
    tabindex: '0',
    'aria-label': domeName(RESET_VIEW, 0),
  });
  const domeFallback = el('img', {
    role: 'img',
    class: 'dome-fallback',
    alt: domeName(RESET_VIEW, 0),
    'aria-label': domeName(RESET_VIEW, 0),
  });
  const hasWebgl = webglAvailable();
  const domeFrame = el('div', { class: 'a-dome dome-frame card' }, [
    el('div', { class: 'dome-glow' }),
    hasWebgl ? domeCanvas : domeFallback,
    hasWebgl ? null : el('p', { class: 'muted', text: NO_WEBGL }),
  ]);

  const chartCanvas = el('canvas', {
    role: 'img',
    tabindex: '0',
    'aria-label': 'Sky chart',
  });
  const lensReadout = el('div', {
    role: 'status',
    'aria-label': 'Lens readout',
    text: 'No target under the lens',
  });
  const chartFrame = el('div', { class: 'a-chart chart-frame card' }, [
    chartCanvas,
    lensReadout,
  ]);

  const track = el('div', {
    class: 'track',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Night time',
    'aria-valuemin': '0',
    'aria-valuemax': '0',
    'aria-valuenow': '0',
    'aria-valuetext': '00:00 site time, minute 0',
  });
  const handle = el('div', { class: 'handle' });
  track.append(handle);
  const trackValue = el('span', { class: 'track-value num' });
  const earlier = el('button', {
    type: 'button',
    class: 'step',
    text: 'Earlier 30 minutes',
  });
  const later = el('button', {
    type: 'button',
    class: 'step',
    text: 'Later 30 minutes',
  });
  const timebar = el('div', { class: 'timebar' }, [
    earlier,
    el('div', { class: 'track-wrap' }, [track, trackValue]),
    later,
  ]);

  const minAltitude = spinbutton('Minimum altitude', {
    id: 'plan-minalt',
    min: '0',
    max: '60',
    step: '1',
    value: '0',
  });
  const targetList = el('ul', {
    class: 'plan-targets',
    'aria-label': 'Plan targets',
  });
  const addTarget = el('button', { type: 'button', class: 'pill', text: 'Add target' });
  const conditionsButton = el('button', {
    type: 'button',
    text: 'Enter sky conditions',
  });
  const notice = el('section', { class: 'a-notice', 'aria-label': 'Conditions notice' });
  const updates = el('div', {
    class: 'a-updates',
    role: 'status',
    'aria-label': 'Plan updates',
  });

  const sideControls = el('div', { class: 'a-conditions stack' }, [
    el('div', { class: 'field' }, [
      el('label', { for: 'plan-date', text: 'Observing date' }),
      dateBox,
    ]),
    el('div', { class: 'dialog-actions' }, [tonightButton, conditionsButton]),
    el('div', { class: 'field' }, [
      el('label', { for: 'plan-minalt', text: 'Minimum altitude' }),
      minAltitude,
    ]),
  ]);

  main.append(
    el('div', { class: 'plan' }, [
      headline,
      context.card,
      domeFrame,
      chartFrame,
      timebar,
      el('div', { class: 'a-targets stack' }, [targetList]),
      el('div', { class: 'a-addtarget' }, [addTarget]),
      sideControls,
      notice,
      updates,
    ]),
  );

  let dome = null;
  if (hasWebgl) {
    dome = new SkyDome(domeCanvas);
    dome.onSettled = () => updateDomeName();
  }

  function updateDomeName() {
    const view = dome ? dome.cameraReading() : RESET_VIEW;
    const name = domeName(view, state.minute);
    if (dome) {
      domeCanvas.setAttribute('aria-label', name);
    } else {
      domeFallback.setAttribute('aria-label', name);
      domeFallback.alt = name;
    }
  }

  function chartData(plan) {
    return {
      mask: state.site ? state.site.mask : new Array(72).fill(0),
      targets: plan.targets,
      moon: plan.moon,
      minute: plan.minute,
      nightMinutes: plan.night.minutes,
    };
  }

  function movedAnnouncement(plan) {
    return `At ${plan.time_local}: ${WORDS[plan.verdict]}, ${bestUsableMinutes(
      plan,
    )} usable minutes left.`;
  }

  async function load({ minute, announcement, silent = false } = {}) {
    const sequence = ++state.sequence;
    const wanted = minute === undefined ? state.minute : minute;
    const path =
      state.date === null && state.plan === null
        ? '/api/tonight'
        : `/api/plans/${state.date || state.plan.date}?minute=${wanted}`;
    try {
      const [plan, pushes] = await Promise.all([
        api('GET', path),
        api('GET', '/api/pushes').catch(() => null),
      ]);
      if (sequence !== state.sequence) return;
      state.plan = plan;
      state.minute = plan.minute;
      state.pushes = pushes ? pushes.pushes : state.pushes;
      paint(plan);
      if (announcement) announce(updates, announcement(plan));
    } catch (error) {
      if (sequence !== state.sequence) return;
      if (!silent) {
        announce(updates, error instanceof ApiError ? error.message : String(error));
      }
    }
  }

  function paint(plan) {
    headline.textContent = `Night of ${longDate(plan.date)}`;
    context.paintCard(plan, pushStateFor(state.pushes, plan.date));
    if (document.activeElement !== dateBox) dateBox.value = plan.date;
    if (document.activeElement !== minAltitude) {
      minAltitude.value = String(plan.min_altitude_deg);
    }
    paintTrack(plan);
    paintTargets(plan);
    paintNotice(plan);
    paintChart(chartCanvas, chartData(plan), lensCentre());
    paintLensReadout(plan);
    if (dome) {
      dome.setHorizonMask(chartData(plan).mask);
      dome.setTargets(plan.targets, chartData(plan).mask);
      dome.setMoon(plan.moon, plan.sun);
      dome.setStars(
        plan.local_sidereal_time_deg,
        state.site ? state.site.latitude : 0,
      );
      dome.resize();
    } else {
      paintFallbackImage(plan);
    }
    updateDomeName();
  }

  function paintFallbackImage(plan) {
    const offscreen = document.createElement('canvas');
    Object.defineProperty(offscreen, 'clientWidth', {
      value: chartCanvas.clientWidth || 480,
      configurable: true,
    });
    paintChart(offscreen, chartData(plan), null);
    domeFallback.src = offscreen.toDataURL('image/png');
  }

  function paintTrack(plan) {
    const maximum = plan.night.minutes;
    track.setAttribute('aria-valuemax', String(maximum));
    track.setAttribute('aria-valuenow', String(plan.minute));
    const text = `${plan.time_local} site time, minute ${plan.minute}`;
    track.setAttribute('aria-valuetext', text);
    trackValue.textContent = text;
    handle.style.left = `${maximum ? (plan.minute / maximum) * 100 : 0}%`;
  }

  function paintTargets(plan) {
    clear(targetList);
    if (!plan.targets.length) {
      targetList.append(
        el('li', {}, [
          el('p', { class: 'muted', text: 'No targets in this plan yet.' }),
        ]),
      );
      return;
    }
    for (const target of plan.targets) {
      targetList.append(
        el('li', {}, [
          el('div', { class: 'row' }, [
            el('div', {}, [
              el('strong', { text: target.target_name }),
              el('span', {
                class: 'muted num',
                text: ` ${oneDecimal(target.altitude_deg)} degrees`,
              }),
              el('div', {
                class: 'position-status',
                text: STATUS_TEXT[target.position_status],
              }),
            ]),
            el('button', {
              type: 'button',
              class: 'ghost',
              text: `Remove ${target.target_name}`,
              onclick: () => removeTarget(target),
              onfocus: () => {
                state.pinned = targetPoint(chartCanvas, target);
                state.lens = null;
                repaintLens();
              },
            }),
          ]),
          el(
            'div',
            { class: 'filters num' },
            target.filters
              .filter((entry) => entry.owed_seconds > 0)
              .map((entry) =>
                el('div', {
                  text:
                    `${entry.filter}: ${entry.usable_minutes} usable minutes, ` +
                    `owed ${duration(entry.owed_seconds)}`,
                }),
              ),
          ),
        ]),
      );
    }
  }

  function paintNotice(plan) {
    clear(notice);
    if (!plan.conditions.hours.length) {
      notice.append(el('p', { text: NO_CONDITIONS }));
    } else if (plan.conditions.stale) {
      notice.append(el('p', { text: STALE_CONDITIONS }));
    }
  }

  function lensCentre() {
    if (reducedMotion()) return state.pinned;
    return state.lens || state.pinned;
  }

  function paintLensReadout(plan) {
    const centre = lensCentre();
    const target = centre
      ? targetUnderLens(chartCanvas, chartData(plan), centre)
      : null;
    if (!target) {
      lensReadout.textContent = 'No target under the lens';
      return;
    }
    const tail =
      target.position_status === 'behind-treeline' ? ', behind the treeline' : '';
    lensReadout.textContent =
      `${target.target_name}: altitude ${oneDecimal(target.altitude_deg)} degrees, ` +
      `Moon ${oneDecimal(target.moon_separation_deg)} degrees away${tail}`;
  }

  function repaintLens() {
    if (!state.plan) return;
    paintChart(chartCanvas, chartData(state.plan), lensCentre());
    paintLensReadout(state.plan);
  }

  function setMinute(minute, { settle = false } = {}) {
    const maximum = state.plan ? state.plan.night.minutes : 0;
    const next = Math.max(0, Math.min(maximum, minute));
    state.minute = next;
    track.setAttribute('aria-valuenow', String(next));
    const text = `${minuteLabel(next)} site time, minute ${next}`;
    track.setAttribute('aria-valuetext', text);
    trackValue.textContent = text;
    handle.classList.remove('glide', 'settle');
    if (!reducedMotion()) handle.classList.add(settle ? 'settle' : 'glide');
    handle.style.left = `${maximum ? (next / maximum) * 100 : 0}%`;
    updateDomeName();
    load({ minute: next, announcement: movedAnnouncement });
  }

  /** The site-local clock reading of a night minute, from the night's dusk. */
  function minuteLabel(minute) {
    const plan = state.plan;
    if (!plan || !plan.night.dusk) return '00:00';
    const [hours, minutes] = hhmm(plan.night.dusk).split(':').map(Number);
    const total = ((hours * 60 + minutes + minute) % 1440 + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(
      total % 60,
    ).padStart(2, '0')}`;
  }

  function minuteUnderPointer(clientX) {
    const box = track.getBoundingClientRect();
    const maximum = state.plan ? state.plan.night.minutes : 0;
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return Math.round(fraction * maximum);
  }

  track.addEventListener('keydown', (event) => {
    const maximum = state.plan ? state.plan.night.minutes : 0;
    const big = event.shiftKey;
    const map = {
      ArrowRight: big ? BIG_STEP : KEY_STEP,
      ArrowUp: big ? BIG_STEP : KEY_STEP,
      ArrowLeft: big ? -BIG_STEP : -KEY_STEP,
      ArrowDown: big ? -BIG_STEP : -KEY_STEP,
      PageUp: BIG_STEP,
      PageDown: -BIG_STEP,
    };
    if (event.key in map) {
      event.preventDefault();
      setMinute(state.minute + map[event.key]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setMinute(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setMinute(maximum);
    }
  });

  let dragging = false;
  track.addEventListener('pointerdown', (event) => {
    dragging = true;
    track.setPointerCapture(event.pointerId);
    const maximum = state.plan ? state.plan.night.minutes : 0;
    handle.classList.remove('glide', 'settle');
    handle.style.left = `${
      maximum ? (minuteUnderPointer(event.clientX) / maximum) * 100 : 0
    }%`;
  });
  track.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const maximum = state.plan ? state.plan.night.minutes : 0;
    handle.style.left = `${
      maximum ? (minuteUnderPointer(event.clientX) / maximum) * 100 : 0
    }%`;
  });
  track.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    const minute = minuteUnderPointer(event.clientX);
    setMinute(Math.round(minute / KEY_STEP) * KEY_STEP, { settle: true });
  });

  earlier.addEventListener('click', () => setMinute(state.minute - BIG_STEP));
  later.addEventListener('click', () => setMinute(state.minute + BIG_STEP));

  chartCanvas.addEventListener('pointermove', (event) => {
    if (reducedMotion() || event.pointerType === 'touch') return;
    const box = chartCanvas.getBoundingClientRect();
    state.lens = [event.clientX - box.left, event.clientY - box.top];
    repaintLens();
  });
  chartCanvas.addEventListener('pointerleave', () => {
    if (reducedMotion()) return;
    state.lens = null;
    repaintLens();
  });
  chartCanvas.addEventListener('click', (event) => {
    const box = chartCanvas.getBoundingClientRect();
    state.pinned = [event.clientX - box.left, event.clientY - box.top];
    state.lens = null;
    repaintLens();
  });
  chartCanvas.addEventListener('focus', () => {
    if (state.plan && state.plan.targets.length && !state.pinned) {
      state.pinned = targetPoint(chartCanvas, state.plan.targets[0]);
    }
    repaintLens();
  });

  if (dome) {
    let orbiting = null;
    domeCanvas.addEventListener('pointerdown', (event) => {
      orbiting = { x: event.clientX, y: event.clientY };
      domeCanvas.setPointerCapture(event.pointerId);
    });
    domeCanvas.addEventListener('pointermove', (event) => {
      if (!orbiting) return;
      const dx = event.clientX - orbiting.x;
      const dy = event.clientY - orbiting.y;
      orbiting = { x: event.clientX, y: event.clientY };
      dome.orbit((dy / 100) * -25, (dx / 100) * 25);
    });
    domeCanvas.addEventListener('pointerup', () => {
      orbiting = null;
    });
    domeCanvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        dome.changeZoom(event.deltaY < 0 ? 0.1 : -0.1);
      },
      { passive: false },
    );
    domeCanvas.addEventListener('dblclick', () => dome.resetView());
    let pinch = null;
    domeCanvas.addEventListener('touchstart', (event) => {
      if (event.touches.length === 2) pinch = touchSpread(event.touches);
    });
    domeCanvas.addEventListener(
      'touchmove',
      (event) => {
        if (event.touches.length !== 2 || pinch === null) return;
        event.preventDefault();
        const spread = touchSpread(event.touches);
        dome.changeZoom((spread - pinch) / 200);
        pinch = spread;
      },
      { passive: false },
    );
    domeCanvas.addEventListener('touchend', () => {
      pinch = null;
    });
    domeCanvas.addEventListener('keydown', (event) => {
      const moves = {
        ArrowRight: () => dome.orbit(0, 5),
        ArrowLeft: () => dome.orbit(0, -5),
        ArrowUp: () => dome.orbit(5, 0),
        ArrowDown: () => dome.orbit(-5, 0),
        '+': () => dome.changeZoom(0.1),
        '=': () => dome.changeZoom(0.1),
        '-': () => dome.changeZoom(-0.1),
        0: () => dome.resetView(),
      };
      if (event.key in moves) {
        event.preventDefault();
        moves[event.key]();
      }
    });
  }

  minAltitude.addEventListener('change', async () => {
    try {
      await api('PATCH', '/api/site', {
        min_altitude_deg: Number(minAltitude.value),
      });
      await loadSite();
      await load({ minute: state.minute, announcement: movedAnnouncement });
    } catch (error) {
      announce(updates, error.message);
    }
  });

  dateBox.addEventListener('change', () => {
    const wanted = dateBox.value.trim();
    context.navigate(`/plan?date=${encodeURIComponent(wanted)}`);
  });
  tonightButton.addEventListener('click', () => context.navigate('/plan'));

  async function removeTarget(target) {
    try {
      const plan = await api(
        'DELETE',
        `/api/plans/${state.plan.date}/targets/${target.project_id}`,
      );
      state.plan = plan;
      state.minute = plan.minute;
      paint(plan);
      announce(updates, `${target.target_name} removed. ${movedAnnouncement(plan)}`);
    } catch (error) {
      announce(updates, error.message);
    }
  }

  async function openAddTarget() {
    const { projects } = await api('GET', '/api/projects');
    const active = projects.filter((project) => project.state === 'active');
    const list = el(
      'select',
      {
        'aria-label': 'Active projects',
        size: String(Math.max(2, active.length)),
      },
      active.map((project) =>
        el('option', {
          value: project.id,
          text: `${project.target_name} (${project.name})`,
        }),
      ),
    );
    const error = el('p', { class: 'field-error' });
    const dialog = openDialog({
      name: 'Add target to plan',
      body: [
        el('h2', { text: 'Add target to plan' }),
        list,
        error,
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            type: 'button',
            class: 'pill',
            text: 'Add to plan',
            onclick: async () => {
              const option = active.find((project) => project.id === list.value);
              if (!option) return;
              try {
                const plan = await api(
                  'POST',
                  `/api/plans/${state.plan.date}/targets`,
                  { project_id: option.id },
                );
                state.plan = plan;
                state.minute = plan.minute;
                paint(plan);
                close(dialog);
                announce(
                  updates,
                  `${option.target_name} added. ${movedAnnouncement(plan)}`,
                );
              } catch (failure) {
                error.textContent = failure.message;
              }
            },
          }),
          el('button', { type: 'button', text: 'Cancel', onclick: () => close(dialog) }),
        ]),
      ],
    });
  }

  addTarget.addEventListener('click', openAddTarget);

  function hourLabels(hours) {
    const seen = new Map();
    for (const hour of hours) seen.set(hhmm(hour), (seen.get(hhmm(hour)) || 0) + 1);
    return hours.map((hour) =>
      seen.get(hhmm(hour)) > 1 ? `${hhmm(hour)} (${offsetOf(hour)})` : hhmm(hour),
    );
  }

  function openConditions() {
    const plan = state.plan;
    const labels = hourLabels(plan.hours);
    const stored = new Map(
      plan.conditions.hours.map((entry) => [entry.hour_start, entry]),
    );
    const rows = plan.hours.map((hour, index) => {
      const entry = stored.get(hour) || { cloud_pct: 0, transparency: 5, seeing: 3 };
      return {
        hour,
        label: labels[index],
        cloud: spinbutton(`Cloud ${labels[index]}`, {
          min: '0',
          max: '100',
          value: String(entry.cloud_pct),
        }),
        transparency: spinbutton(`Transparency ${labels[index]}`, {
          min: '1',
          max: '5',
          value: String(entry.transparency),
        }),
        seeing: spinbutton(`Seeing ${labels[index]}`, {
          min: '1',
          max: '5',
          value: String(entry.seeing),
        }),
      };
    });
    const error = el('p', { class: 'field-error' });
    const dialog = openDialog({
      name: 'Sky conditions',
      body: [
        el('h2', { text: 'Sky conditions' }),
        el(
          'div',
          { class: 'hours-grid' },
          rows.map((row) =>
            el('div', { class: 'hour' }, [
              el('span', { class: 'label num', text: row.label }),
              row.cloud,
              row.transparency,
              row.seeing,
            ]),
          ),
        ),
        error,
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            type: 'button',
            class: 'pill',
            text: 'Save conditions',
            onclick: async () => {
              announce(updates, 'Saving conditions...');
              try {
                await api('PUT', `/api/plans/${plan.date}/conditions`, {
                  hours: rows.map((row) => ({
                    hour_start: row.hour,
                    cloud_pct: Number(row.cloud.value),
                    transparency: Number(row.transparency.value),
                    seeing: Number(row.seeing.value),
                  })),
                });
                close(dialog);
                await load({ minute: state.minute, silent: true });
                announce(updates, `Conditions saved for ${rows.length} hours.`);
              } catch (failure) {
                error.textContent = failure.message;
                announce(updates, failure.message);
              }
            },
          }),
          el('button', { type: 'button', text: 'Cancel', onclick: () => close(dialog) }),
        ]),
      ],
    });
  }

  conditionsButton.addEventListener('click', openConditions);

  const shortcuts = (event) => {
    if (isTextControl(event.target) || event.metaKey || event.ctrlKey) return;
    if (isOpen('Add target to plan') || isOpen('Sky conditions')) return;
    if (event.key === '[') {
      event.preventDefault();
      setMinute(state.minute - KEY_STEP);
    } else if (event.key === ']') {
      event.preventDefault();
      setMinute(state.minute + KEY_STEP);
    } else if (event.key === 'a' || event.key === 'A') {
      event.preventDefault();
      openAddTarget();
    }
  };
  document.addEventListener('keydown', shortcuts);

  /** Keeps the bottom navigation clear of the fixed time bar on a phone. */
  function measureTimebar() {
    document.documentElement.style.setProperty(
      '--timebar-h',
      `${Math.ceil(timebar.getBoundingClientRect().height)}px`,
    );
  }

  const resize = () => {
    if (state.plan) paint(state.plan);
    measureTimebar();
  };
  window.addEventListener('resize', resize);

  async function loadSite() {
    const [site, horizon] = await Promise.all([
      api('GET', '/api/site'),
      api('GET', '/api/site/horizon'),
    ]);
    state.site = { ...site, mask: horizon.altitudes };
  }

  await loadSite();
  await load({ minute: requestedDate ? 0 : undefined, silent: true });
  const timer = setInterval(
    () => load({ minute: state.minute, silent: true }),
    REFRESH_MS,
  );

  measureTimebar();
  return () => {
    clearInterval(timer);
    document.removeEventListener('keydown', shortcuts);
    window.removeEventListener('resize', resize);
    document.documentElement.style.removeProperty('--timebar-h');
    if (dome) dome.dispose();
  };
}
