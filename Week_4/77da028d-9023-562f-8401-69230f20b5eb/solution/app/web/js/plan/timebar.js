// The night time bar: the slider (the handle) and the two 30-minute step buttons.
import { h } from '../core/dom.js';

const STEP_SMALL = 5;
const STEP_LARGE = 30;

const KEY_MOVES = {
  ArrowRight: (value, shift) => value + (shift ? STEP_LARGE : STEP_SMALL),
  ArrowUp: (value, shift) => value + (shift ? STEP_LARGE : STEP_SMALL),
  ArrowLeft: (value, shift) => value - (shift ? STEP_LARGE : STEP_SMALL),
  ArrowDown: (value, shift) => value - (shift ? STEP_LARGE : STEP_SMALL),
  PageUp: (value) => value + STEP_LARGE,
  PageDown: (value) => value - STEP_LARGE,
  Home: () => 0,
  End: (value, shift, maximum) => maximum,
};

// createTimeBar({moveTo}) -> {element, slider, configure({maximum, describe}), show(minute)}
// moveTo(minute, {announce, force}) is called for every user move; the page decides what a move means.
export function createTimeBar({ moveTo }) {
  let maximum = 0;
  let value = 0;
  let describe = (minute) => String(minute);
  let dragging = false;

  const handle = h('div', { class: 'slider-handle' });
  const fill = h('div', { class: 'slider-fill' });
  const track = h('div', { class: 'slider-track' }, fill, handle);
  const slider = h('div', {
    class: 'slider', role: 'slider', tabindex: '0', 'aria-label': 'Night time', 'aria-valuemin': '0',
    'aria-valuemax': '0', 'aria-valuenow': '0', 'aria-valuetext': '',
  }, track);
  const label = h('span', { class: 'timebar-time', 'aria-hidden': 'true' });
  const earlier = h('button', { type: 'button', class: 'btn timebar-step', onclick: () => moveTo(value - STEP_LARGE, { announce: true }) }, 'Earlier 30 minutes');
  const later = h('button', { type: 'button', class: 'btn timebar-step', onclick: () => moveTo(value + STEP_LARGE, { announce: true }) }, 'Later 30 minutes');
  const element = h('section', { class: 'timebar', 'aria-label': 'Night time controls' },
    slider, h('div', { class: 'timebar-row' }, earlier, label, later));

  function minuteAt(event) {
    const box = track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    return Math.round(fraction * maximum);
  }

  slider.addEventListener('keydown', (event) => {
    const next = KEY_MOVES[event.key];
    if (!next || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    slider.classList.remove('is-settling');
    moveTo(next(value, event.shiftKey, maximum), { announce: true });
  });
  slider.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    slider.focus({ preventScroll: true });
    slider.setPointerCapture(event.pointerId);
    dragging = true;
    slider.classList.remove('is-settling');
    slider.classList.add('is-dragging');
    moveTo(minuteAt(event), { announce: false });
  });
  slider.addEventListener('pointermove', (event) => {
    if (dragging) moveTo(minuteAt(event), { announce: false });
  });
  function release() {
    if (!dragging) return;
    dragging = false;
    slider.classList.remove('is-dragging');
    slider.classList.add('is-settling');
    // The release snaps to a multiple of 5 that stays on the bar, even when the night's length is not one.
    const lastStep = Math.floor(maximum / STEP_SMALL) * STEP_SMALL;
    const snapped = Math.min(lastStep, Math.round(value / STEP_SMALL) * STEP_SMALL);
    moveTo(snapped, { announce: true, force: true });
  }
  slider.addEventListener('pointerup', release);
  slider.addEventListener('pointercancel', release);

  return {
    element,
    slider,
    configure(settings) {
      maximum = settings.maximum;
      describe = settings.describe;
      slider.setAttribute('aria-valuemax', String(maximum));
    },
    show(minute) {
      value = minute;
      const fraction = maximum > 0 ? minute / maximum : 0;
      slider.style.setProperty('--p', String(fraction));
      slider.setAttribute('aria-valuenow', String(minute));
      const text = describe(minute);
      slider.setAttribute('aria-valuetext', `${text} site time, minute ${minute}`);
      label.textContent = text;
    },
  };
}
