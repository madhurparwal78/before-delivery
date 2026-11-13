// Handoff Cut motion: WAAPI only, never under prefers-reduced-motion. Blocks jump straight to each snapped position
// there; the tab, pieces, attributes, preview text and announcements are the same either way.
export const STEP_MS = 100;
export const SETTLE_MS = 250;
const SOFT = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

export function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// What the next mounted blocks should do: 'step' (a live split reaching a step), 'settle' (the server's answer or a
// refused cut's return), or null for no motion.
export const motion = { kind: null };

export function setMotion(kind) {
  motion.kind = kind;
}

export function clearMotionSoon() {
  setTimeout(() => {
    motion.kind = null;
  }, 60);
}

export function animate(el, frames, duration) {
  if (reducedMotion() || !el || !el.animate) return null;
  return el.animate(frames, { duration, easing: SOFT });
}
