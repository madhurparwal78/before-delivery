const STEP_MS = 60;
const MAX_RADIUS = 6;
const HOLD_MS = 500;
const OUTLINE_MS = 2000;

export interface Ripple {
  start: () => void;
  stop: () => void;
}

export function createRipple(
  apply: (radius: number, mode: 'none' | 'growing' | 'outline') => void,
  reduced: () => boolean
): Ripple {
  const timers: number[] = [];
  const stop = (): void => {
    for (const timer of timers) window.clearTimeout(timer);
    timers.length = 0;
  };
  return {
    stop,
    start: () => {
      stop();
      if (reduced()) {
        apply(MAX_RADIUS, 'outline');
        timers.push(window.setTimeout(() => apply(0, 'none'), OUTLINE_MS));
        return;
      }
      apply(0, 'growing');
      for (let radius = 1; radius <= MAX_RADIUS; radius += 1) {
        timers.push(window.setTimeout(() => apply(radius, 'growing'), STEP_MS * radius));
      }
      timers.push(window.setTimeout(() => apply(0, 'none'), STEP_MS * MAX_RADIUS + HOLD_MS));
    }
  };
}
