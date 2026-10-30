export const DURATION = {
  press: 100,
  step: 250,
  large: 440,
} as const;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Runs an eased animation, or jumps straight to the end when the device asks
 * for reduced motion.
 */
export function animate(
  durationMs: number,
  step: (progress: number) => void,
  done?: () => void,
): void {
  if (reducedMotion()) {
    step(1);
    done?.();
    return;
  }
  const started = performance.now();
  const frame = (now: number): void => {
    const elapsed = now - started;
    const linear = Math.min(1, elapsed / durationMs);
    const eased = 1 - (1 - linear) ** 3;
    step(eased);
    if (linear < 1) {
      requestAnimationFrame(frame);
      return;
    }
    done?.();
  };
  requestAnimationFrame(frame);
}

/** Rolls a numeral to its new value inside one step duration. */
export function tweenNumber(
  node: HTMLElement,
  from: number,
  to: number,
  render: (value: number) => string,
): void {
  if (reducedMotion() || from === to) {
    node.textContent = render(to);
    return;
  }
  animate(DURATION.step, (progress) => {
    node.textContent = render(from + (to - from) * progress);
  });
}
