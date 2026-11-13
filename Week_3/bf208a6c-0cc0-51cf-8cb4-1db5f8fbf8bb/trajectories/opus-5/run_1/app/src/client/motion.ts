const SETTLE_MS = 220;
const LIFT_MS = 280;
const SHEET_MS = 300;
const SLIDE_MS = 340;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const takeRects = (nodes: Iterable<HTMLElement>): Map<HTMLElement, DOMRect> => {
  const rects = new Map<HTMLElement, DOMRect>();
  for (const node of nodes) rects.set(node, node.getBoundingClientRect());
  return rects;
};

/** Frames glide from their old slots to their new ones; reduced motion jumps instead. */
export const settle = (before: Map<HTMLElement, DOMRect>, nodes: Iterable<HTMLElement>): void => {
  if (reducedMotion()) return;
  for (const node of nodes) {
    const old = before.get(node);
    if (old === undefined) continue;
    const next = node.getBoundingClientRect();
    const dx = old.left - next.left;
    const dy = old.top - next.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    node.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: SETTLE_MS, easing: EASE },
    );
  }
};

export const grow = (node: HTMLElement, from: DOMRect): void => {
  if (reducedMotion()) return;
  const to = node.getBoundingClientRect();
  node.animate(
    [
      { width: `${from.width}px`, height: `${from.height}px` },
      { width: `${to.width}px`, height: `${to.height}px` },
    ],
    { duration: LIFT_MS, easing: EASE },
  );
};

export const slideUp = (node: HTMLElement): void => {
  if (reducedMotion()) return;
  node.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], {
    duration: SHEET_MS,
    easing: EASE,
  });
};

export const slideDown = (node: HTMLElement): Promise<void> => {
  if (reducedMotion()) return Promise.resolve();
  return node
    .animate([{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { duration: SHEET_MS, easing: EASE })
    .finished.then(() => undefined);
};

export const slideSlide = (node: HTMLElement, direction: 1 | -1): void => {
  if (reducedMotion()) return;
  node.animate(
    [
      { transform: `translateX(${direction * 100}%)`, opacity: 0 },
      { transform: 'translateX(0)', opacity: 1 },
    ],
    { duration: SLIDE_MS, easing: EASE },
  );
};

export const slideOut = (node: HTMLElement, direction: 1 | -1): void => {
  if (reducedMotion()) return;
  node.animate(
    [
      { transform: 'translateX(0)', opacity: 1 },
      { transform: `translateX(${direction * -100}%)`, opacity: 0 },
    ],
    { duration: SLIDE_MS, easing: EASE },
  );
};
