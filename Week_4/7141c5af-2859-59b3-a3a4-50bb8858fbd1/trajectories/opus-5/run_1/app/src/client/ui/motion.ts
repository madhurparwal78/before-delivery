/**
 * The whole motion system. Every duration is exactly 160, 320 or 640 ms, run by
 * the browser's own animation, and nothing loops forever. Under reduced motion
 * each end state shows at once with the same function.
 */

export const DURATION = { quick: 160, normal: 320, long: 640 } as const;
export type Duration = (typeof DURATION)[keyof typeof DURATION];

const EASE = 'cubic-bezier(0.2, 0, 0.1, 1)';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Read on every animation, so turning the setting on or off applies at once. */
export function reducedMotion(): boolean {
  return reduced.matches;
}

/**
 * Runs one animation on the element. Under reduced motion the end state shows
 * at once and the promise settles immediately.
 */
export function animate(
  node: Element,
  frames: Keyframe[],
  duration: Duration,
  options: { fill?: FillMode } = {},
): Animation | null {
  if (reducedMotion()) return null;
  const animation = node.animate(frames, {
    duration,
    easing: EASE,
    fill: options.fill ?? 'none',
  });
  return animation;
}

/** Cancels whatever is running on the element, so a fresh press starts clean. */
export function stopAnimations(node: Element): void {
  for (const animation of node.getAnimations()) animation.cancel();
}

/**
 * Moves an element from where it is now to where the layout has just put it,
 * keeping the same element. A further press during the glide carries on from
 * where the element is.
 */
export function glideFrom(node: HTMLElement, from: DOMRect, duration: Duration = DURATION.normal): Animation | null {
  const to = node.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (dx === 0 && dy === 0) return null;
  const scaleX = to.width === 0 ? 1 : from.width / to.width;
  const scaleY = to.height === 0 ? 1 : from.height / to.height;
  return animate(
    node,
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` },
      { transform: 'translate(0, 0) scale(1, 1)' },
    ],
    duration,
  );
}

/** The current visual position of an element mid-glide. */
export function liveRect(node: HTMLElement): DOMRect {
  return node.getBoundingClientRect();
}

export function fadeIn(node: Element, duration: Duration = DURATION.quick): Animation | null {
  return animate(node, [{ opacity: 0 }, { opacity: 1 }], duration);
}

export function crossFade(node: Element, duration: Duration = DURATION.normal): Animation | null {
  return animate(node, [{ opacity: 0.001 }, { opacity: 1 }], duration);
}

/** The figure rolls old up and out and new up into place. */
export function rollFigure(node: HTMLElement, nextText: string): void {
  if (node.textContent === nextText) return;
  if (reducedMotion()) {
    node.textContent = nextText;
    return;
  }
  stopAnimations(node);
  const out = node.animate(
    [
      { transform: 'translateY(0)', opacity: 1 },
      { transform: 'translateY(-0.6em)', opacity: 0 },
    ],
    { duration: DURATION.normal / 2, easing: EASE, fill: 'forwards' },
  );
  out.finished
    .then(() => {
      node.textContent = nextText;
      node.animate(
        [
          { transform: 'translateY(0.6em)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 },
        ],
        { duration: DURATION.normal / 2, easing: EASE },
      );
      out.cancel();
    })
    .catch(() => {
      node.textContent = nextText;
    });
}

/** Draws a step's check one time; a step already finished shows it at once. */
export function drawCheck(node: SVGElement | HTMLElement): void {
  if (node.dataset.drawn === 'true') return;
  node.dataset.drawn = 'true';
  if (reducedMotion()) return;
  animate(node, [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }], DURATION.normal);
}

export function markDrawn(node: HTMLElement): void {
  node.dataset.drawn = 'true';
}

export function onReducedMotionChange(handler: () => void): void {
  reduced.addEventListener('change', handler);
}
