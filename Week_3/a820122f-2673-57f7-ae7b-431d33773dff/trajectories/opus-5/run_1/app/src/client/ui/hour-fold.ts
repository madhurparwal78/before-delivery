import type { RestWindow, Strip } from '../api.js';
import { COPY } from '../copy.js';
import { button, el, oneDecimal, prefersReducedMotion, setStatus, statusRegion } from '../dom.js';

const STRIP_SLOTS = 672;
const VERDICT_DELAY_MS = 500;
const FOLD_MS = 330;
const NUMERAL_MS = 200;

export type HourFold = {
  element: HTMLElement;
  verdict: HTMLElement;
  setStrip: (strip: Strip) => void;
  onWindowChange: (handler: (window: RestWindow) => void) => void;
  onShift: (handler: (direction: -1 | 1) => void) => void;
  current: () => RestWindow | null;
  stop: () => void;
};

function windowSlots(hours: 24 | 168): number {
  return hours * 2;
}

/** The 14-day watch strip and the Hour Fold frame that reads the server's window values. */
export function createHourFold(): HourFold {
  let strip: Strip | null = null;
  let hours: 24 | 168 = 24;
  let step = 0;
  let windowHandler: (window: RestWindow) => void = () => undefined;
  let shiftHandler: (direction: -1 | 1) => void = () => undefined;
  let verdictTimer: number | null = null;
  let numeralTimer: number | null = null;
  let shownRestHours = 0;
  let dragging = false;

  const track = el('div', { class: 'strip-track' });
  const cellLayer = el('div', { class: 'strip-cells' });
  const tickLayer = el('div', { class: 'strip-ticks' });
  const frame = el('div', { class: 'window-frame' });
  const frameStart = el('span', { class: 'frame-label start' });
  const frameEnd = el('span', { class: 'frame-label end' });
  const frameRest = el('span', { class: 'frame-rest' });
  const frameBreach = el('span', { class: 'frame-breach', text: COPY.breach });
  const foldLayer = el('div', { class: 'fold-layer' });
  frame.append(foldLayer);
  track.append(cellLayer, tickLayer, frame);
  const caption = el('p', { class: 'window-caption' }, [
    frameStart,
    frameRest,
    frameEnd,
    frameBreach,
  ]);

  const group = el('div', { role: 'group', 'aria-label': 'Hour Fold', class: 'hour-fold' }, [
    track,
    caption,
  ]);

  const radio24 = el('input', { type: 'radio', name: 'window-width', value: '24', checked: true });
  const radio168 = el('input', { type: 'radio', name: 'window-width', value: '168' });
  radio24.id = 'window-width-24';
  radio168.id = 'window-width-168';
  const radios = el('div', { role: 'radiogroup', 'aria-label': 'Window width', class: 'widths' }, [
    el('span', { class: 'radio' }, [radio24, el('label', { for: radio24.id, text: '24 hours' })]),
    el('span', { class: 'radio' }, [
      radio168,
      el('label', { for: radio168.id, text: '168 hours' }),
    ]),
  ]);

  const slider = el('input', {
    type: 'range',
    min: 0,
    max: 624,
    step: 1,
    value: 0,
    'aria-label': 'Window start',
    class: 'window-slider',
  });

  const earlier = button('Show earlier 14 days');
  const later = button('Show later 14 days');
  const verdict = statusRegion('Window verdict');

  const element = el('div', { class: 'strip-pane' }, [
    radios,
    el('div', { class: 'slider-row' }, [slider]),
    group,
    el('div', { class: 'actions' }, [earlier, later]),
    verdict,
  ]);

  function maxStep(): number {
    return STRIP_SLOTS - windowSlots(hours);
  }

  function currentWindow(): RestWindow | null {
    if (strip === null) return null;
    const list = hours === 24 ? strip.windows['24'] : strip.windows['168'];
    return list[step] ?? null;
  }

  function renderCells(): void {
    const loaded = strip;
    if (loaded === null) return;
    cellLayer.replaceChildren(
      ...loaded.cells.map((cell) => {
        const node = el('span', { class: 'strip-cell' });
        node.dataset['state'] = cell.state;
        if (cell.late) node.dataset['late'] = 'true';
        return node;
      }),
    );
    tickLayer.replaceChildren(
      ...loaded.clock_changes.map((change) => {
        const index =
          (Date.parse(change.changes_at_utc) - Date.parse(loaded.start_utc)) / 1_800_000;
        const node = el('span', { class: 'strip-tick', title: change.label });
        node.style.left = `${(index / STRIP_SLOTS) * 100}%`;
        node.dataset['kind'] = change.kind;
        return node;
      }),
    );
  }

  function rollNumerals(target: number): void {
    if (numeralTimer !== null) {
      cancelAnimationFrame(numeralTimer);
      numeralTimer = null;
    }
    if (prefersReducedMotion()) {
      shownRestHours = target;
      frameRest.textContent = COPY.restOfWindow(target);
      return;
    }
    const from = shownRestHours;
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const fraction = Math.min(1, (now - startedAt) / NUMERAL_MS);
      const value = from + (target - from) * fraction;
      frameRest.textContent = COPY.restOfWindow(value);
      if (fraction < 1) numeralTimer = requestAnimationFrame(tick);
      else {
        shownRestHours = target;
        frameRest.textContent = COPY.restOfWindow(target);
        numeralTimer = null;
      }
    };
    numeralTimer = requestAnimationFrame(tick);
  }

  function renderFolds(shown: RestWindow): void {
    const loaded = strip;
    if (loaded === null) return;
    const covered = loaded.clock_changes.filter(
      (change) =>
        Date.parse(change.changes_at_utc) > Date.parse(shown.start_utc) &&
        Date.parse(change.changes_at_utc) < Date.parse(shown.end_utc),
    );
    const slots = windowSlots(hours);
    foldLayer.replaceChildren(
      ...covered.map((change) => {
        const offset =
          (Date.parse(change.changes_at_utc) - Date.parse(shown.start_utc)) / 1_800_000;
        const node = el('span', { class: `fold ${change.kind === 'retard' ? 'gap' : 'crease'}` }, [
          el('span', { class: 'fold-label', text: change.label }),
        ]);
        node.style.left = `${(offset / slots) * 100}%`;
        if (prefersReducedMotion()) node.classList.add('open');
        else openFold(node);
        return node;
      }),
    );
  }

  function openFold(node: HTMLElement): void {
    requestAnimationFrame(() => {
      node.classList.add('open');
      node.style.transitionDuration = `${FOLD_MS}ms`;
    });
  }

  function update(nextStep: number, notify = true): void {
    if (strip === null) return;
    step = Math.min(Math.max(nextStep, 0), maxStep());
    const shown = currentWindow();
    if (shown === null) return;
    const slots = windowSlots(hours);
    frame.style.left = `${(step / STRIP_SLOTS) * 100}%`;
    frame.style.width = `${(slots / STRIP_SLOTS) * 100}%`;
    frameStart.textContent = shown.start_ship_time;
    frameEnd.textContent = shown.end_ship_time;
    rollNumerals(shown.rest_hours);
    frame.classList.toggle('breach', shown.verdict === 'breach');
    frameBreach.hidden = shown.verdict !== 'breach';
    group.dataset['step'] = String(step);
    group.dataset['windowStartUtc'] = shown.start_utc;
    group.dataset['windowEndUtc'] = shown.end_utc;
    group.dataset['restHours'] = oneDecimal(shown.rest_hours);
    group.dataset['verdict'] = shown.verdict;
    group.dataset['longitude'] = shown.longitude === null ? '' : shown.longitude.toFixed(2);
    group.dataset['foldState'] = shown.fold_state;
    group.dataset['clockFaceHours'] = String(shown.clock_face_hours);
    slider.value = String(step);
    slider.setAttribute(
      'aria-valuetext',
      `${shown.start_ship_time} to ${shown.end_ship_time}`,
    );
    renderFolds(shown);
    scheduleVerdict(shown);
    if (notify) windowHandler(shown);
  }

  function scheduleVerdict(shown: RestWindow): void {
    if (verdictTimer !== null) globalThis.clearTimeout(verdictTimer);
    verdictTimer = globalThis.setTimeout(() => {
      const text =
        shown.verdict === 'pass'
          ? COPY.windowVerdictPass(shown.start_ship_time, shown.end_ship_time, shown.rest_hours)
          : shown.verdict === 'breach'
            ? COPY.windowVerdictBreach(shown.start_ship_time, shown.end_ship_time, shown.rest_hours)
            : COPY.windowVerdictIncomplete(
                shown.start_ship_time,
                shown.end_ship_time,
                shown.rest_hours,
              );
      setStatus(verdict, text);
    }, VERDICT_DELAY_MS) as unknown as number;
  }

  function setWidth(next: 24 | 168): void {
    hours = next;
    slider.max = String(maxStep());
    update(Math.min(step, maxStep()));
  }

  radio24.addEventListener('change', () => {
    if (radio24.checked) setWidth(24);
  });
  radio168.addEventListener('change', () => {
    if (radio168.checked) setWidth(168);
  });

  slider.addEventListener('input', () => {
    update(Number(slider.value));
  });
  slider.addEventListener('keydown', (event) => {
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      update(step + (event.key === 'PageUp' ? 48 : -48));
    }
  });

  element.addEventListener('keydown', (event) => {
    if (event.key === '[') {
      event.preventDefault();
      update(step - 1);
    } else if (event.key === ']') {
      event.preventDefault();
      update(step + 1);
    }
  });

  function stepFromPointer(clientX: number): number {
    const bounds = track.getBoundingClientRect();
    const fraction = (clientX - bounds.left) / bounds.width;
    const centre = fraction * STRIP_SLOTS;
    return Math.round(centre - windowSlots(hours) / 2);
  }

  track.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    update(stepFromPointer(event.clientX));
    track.setPointerCapture(event.pointerId);
  });
  track.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    update(stepFromPointer(event.clientX));
  });
  const endDrag = (): void => {
    dragging = false;
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  earlier.addEventListener('click', () => shiftHandler(-1));
  later.addEventListener('click', () => shiftHandler(1));

  return {
    element,
    verdict,
    setStrip: (next) => {
      strip = next;
      renderCells();
      slider.max = String(maxStep());
      update(Math.min(step, maxStep()));
    },
    onWindowChange: (handler) => {
      windowHandler = handler;
      const shown = currentWindow();
      if (shown !== null) handler(shown);
    },
    onShift: (handler) => {
      shiftHandler = handler;
    },
    current: currentWindow,
    stop: () => {
      if (verdictTimer !== null) globalThis.clearTimeout(verdictTimer);
      if (numeralTimer !== null) cancelAnimationFrame(numeralTimer);
    },
  };
}
