// Frame-driven easing for the canvas and WebGL scenes. Everything is driven by performance.now()
// and requestAnimationFrame; with reduced motion every tween is a single synchronous frame.
export function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function easeOut(progress) {
  return 1 - (1 - progress) ** 3;
}

export function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

// Shortest signed difference between two angles in degrees, in (-180, 180].
export function angleDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

// tween({duration, delay, kickoff, update}) -> {cancel()}
// `kickoff` renders one immediate frame at that fraction so the view starts moving in the same task as the input.
export function tween({ duration, delay = 0, kickoff = 0, update }) {
  if (reducedMotion()) {
    update(1);
    return { cancel() {} };
  }
  const begin = performance.now() + delay;
  let cancelled = false;
  let frame = 0;
  if (kickoff > 0 && delay === 0) update(easeOut(kickoff));
  const step = () => {
    if (cancelled) return;
    const progress = Math.min(1, (performance.now() - begin) / duration);
    if (progress >= 0) update(easeOut(progress));
    if (progress < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return {
    cancel() {
      cancelled = true;
      cancelAnimationFrame(frame);
    },
  };
}
