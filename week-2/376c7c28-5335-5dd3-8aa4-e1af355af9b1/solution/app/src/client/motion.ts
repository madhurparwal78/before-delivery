/** One feel for every motion: brisk at the start, settling softly with no overshoot. */
const EASE = 'cubic-bezier(0.16, 0.8, 0.3, 1)';
export const SPRING_MS = 330;
export const SLIDE_MS = 330;
const COUNT_MS = 480;
const DIALOG_MS = 250;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A closed dialog fades out and falls a few pixels. The real dialog is already gone, so focus and
 * clicks are never held up; what fades is an inert, hidden-from-assistive-tech copy of it.
 */
export function fadeAway(node: HTMLElement, box: DOMRect | null): void {
  if (reducedMotion() || !box || box.width === 0) return;
  const ghost = node.cloneNode(true) as HTMLElement;
  const copy = document.createElement('div');
  copy.className = 'dialog-leaving';
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.style.left = `${box.left}px`;
  copy.style.top = `${box.top}px`;
  copy.style.width = `${box.width}px`;
  copy.style.height = `${box.height}px`;
  copy.append(...Array.from(ghost.childNodes));
  document.body.appendChild(copy);
  const animation = copy.animate(
    [
      { opacity: '1', transform: 'translateY(0px)' },
      { opacity: '0', transform: 'translateY(6px)' },
    ],
    { duration: DIALOG_MS, easing: EASE, fill: 'forwards' },
  );
  const done = (): void => copy.remove();
  animation.addEventListener('finish', done);
  animation.addEventListener('cancel', done);
}

/** A dragged ghost that changed nothing springs back to where it came from, then leaves. */
export function springBack(ghost: HTMLElement, home: Element | null): void {
  if (reducedMotion() || !home) {
    ghost.remove();
    return;
  }
  const from = ghost.getBoundingClientRect();
  const to = home.getBoundingClientRect();
  const animation = ghost.animate(
    [
      { transform: 'translate(0px, 0px)', opacity: '1' },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)`, opacity: '0.4' },
    ],
    { duration: SPRING_MS, easing: EASE, fill: 'forwards' },
  );
  const done = (): void => ghost.remove();
  animation.addEventListener('finish', done);
  animation.addEventListener('cancel', done);
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

interface Count {
  readonly target: number;
  running: boolean;
}

const counters = new WeakMap<HTMLElement, Count>();

/**
 * Counts the visible numerals from their old value to the new one, after `delayMs` (the
 * silhouette and shelf motion it follows). A redraw to the same target leaves a running count be.
 */
export function countTo(
  node: HTMLElement,
  to: number,
  render: (value: number) => string,
  delayMs = 0,
): void {
  const held = counters.get(node);
  if (held && held.target === to && held.running) return;
  const count: Count = { target: to, running: false };
  counters.set(node, count);
  if (reducedMotion() || held === undefined || held.target === to) {
    node.textContent = render(to);
    return;
  }
  const from = held.target;
  count.running = true;
  node.textContent = render(from);
  let started: number | null = null;
  const step = (stamp: number): void => {
    if (counters.get(node) !== count) return;
    started ??= stamp;
    const progress = Math.min(1, (stamp - started) / COUNT_MS);
    const eased = 1 - (1 - progress) ** 3;
    node.textContent = render(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(step);
    else count.running = false;
  };
  window.setTimeout(() => requestAnimationFrame(step), delayMs);
}
