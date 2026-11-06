const query = window.matchMedia('(prefers-reduced-motion: reduce)');

export function reducedMotion(): boolean {
  return query.matches;
}

/** Shows the busy bar, or the static word under reduced motion, while a request is out. */
export async function withBusy<T>(
  button: HTMLButtonElement,
  work: () => Promise<T>,
): Promise<T> {
  const label = button.textContent ?? '';
  button.disabled = true;
  button.classList.add('is-busy');
  if (reducedMotion()) {
    button.dataset.busyLabel = label;
    button.textContent = 'Working…';
  }
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    if (button.dataset.busyLabel !== undefined) {
      button.textContent = button.dataset.busyLabel;
      delete button.dataset.busyLabel;
    }
  }
}

export function tween(
  durationMs: number,
  step: (progress: number) => void,
  done?: () => void,
): void {
  if (reducedMotion() || durationMs <= 0) {
    step(1);
    done?.();
    return;
  }
  const start = performance.now();
  const frame = (now: number): void => {
    const elapsed = now - start;
    const linear = Math.min(1, elapsed / durationMs);
    // Starts quickly and settles gently, with no overshoot.
    const eased = 1 - (1 - linear) * (1 - linear);
    step(eased);
    if (linear < 1) requestAnimationFrame(frame);
    else done?.();
  };
  requestAnimationFrame(frame);
}
