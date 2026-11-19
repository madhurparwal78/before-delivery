// The published widths: 768 and 1200, and nothing else.

export const PHONE = 'phone';
export const TABLET = 'tablet';
export const DESK = 'desk';

const listeners = new Set();
let band = bandNow();

export function bandNow() {
  const width = window.innerWidth;
  if (width < 768) return PHONE;
  if (width < 1200) return TABLET;
  return DESK;
}

export function currentBand() {
  return band;
}

export function onBandChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

window.addEventListener('resize', () => {
  const next = bandNow();
  if (next === band) return;
  const previous = band;
  band = next;
  listeners.forEach((listener) => listener(next, previous));
});
