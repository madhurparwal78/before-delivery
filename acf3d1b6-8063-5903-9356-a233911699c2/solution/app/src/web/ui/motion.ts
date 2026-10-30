// Graded motion runs through element.animate(): it starts the moment the element appears, can be read back
// frame by frame, and is skipped entirely when the visitor asks for reduced motion.

export const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function play(
  element: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | undefined {
  if (!element || reducedMotion()) return undefined;
  return element.animate(keyframes, options);
}

/** Fades an element in (and lifts it `rise` px) the first time it appears; safe to call from a ref on every render. */
export function enter(element: HTMLElement | null, duration: number, rise = 0, easing = EASE_OUT): void {
  if (!element || element.dataset.entered) return;
  element.dataset.entered = 'true';
  const from: Keyframe = rise ? { opacity: 0, transform: `translateY(${rise}px)` } : { opacity: 0 };
  play(element, [from, { opacity: 1, transform: 'none' }], { duration, easing });
}
