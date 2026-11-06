/** One feel for every motion: brisk at the start, settling softly with no overshoot. */
const EASE = 'cubic-bezier(0.22, 0.8, 0.26, 1)';
export const SPRING_MS = 330;
export const SLIDE_MS = 330;
export const COUNT_MS = 480;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function springFrom(node: Element, dx: number, dy: number): void {
  if (reducedMotion() || (dx === 0 && dy === 0)) return;
  node.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0px, 0px)' }],
    { duration: SPRING_MS, easing: EASE },
  );
}

export function slideFrom(node: Element, dy: number): void {
  if (reducedMotion() || dy === 0) return;
  node.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0px)' }], {
    duration: SLIDE_MS,
    easing: EASE,
  });
}

export function shrinkAway(node: Element, onDone: () => void): void {
  if (reducedMotion()) {
    onDone();
    return;
  }
  const animation = node.animate(
    [
      { transform: 'scale(1)', opacity: '1' },
      { transform: 'scale(0.2)', opacity: '0' },
    ],
    { duration: SPRING_MS, easing: EASE },
  );
  animation.addEventListener('finish', onDone);
}

const counters = new WeakMap<HTMLElement, number>();

/** Counts the visible numerals from their old value to the new one. */
export function countTo(
  node: HTMLElement,
  to: number,
  render: (value: number) => string,
): void {
  const from = counters.get(node);
  counters.set(node, to);
  if (reducedMotion() || from === undefined || from === to) {
    node.textContent = render(to);
    return;
  }
  const started = performance.now();
  const step = (stamp: number): void => {
    if (counters.get(node) !== to) return;
    const progress = Math.min(1, (stamp - started) / COUNT_MS);
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = render(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(step);
    else node.textContent = render(to);
  };
  node.textContent = render(from);
  requestAnimationFrame(step);
}
