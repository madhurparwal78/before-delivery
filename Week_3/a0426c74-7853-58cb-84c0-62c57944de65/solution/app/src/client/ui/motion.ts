const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Runs one of the four published animations on the document timeline with its published id and the shared
 * ease-out curve. Under reduced motion no animation is created and null is returned; callers apply the end
 * state themselves before calling, so both paths show the same result.
 */
export function animateWithId(
  element: Element,
  keyframes: Keyframe[],
  options: { id: string; duration: number },
): Animation | null {
  if (prefersReducedMotion()) return null;
  return element.animate(keyframes, { id: options.id, duration: options.duration, easing: EASING });
}
