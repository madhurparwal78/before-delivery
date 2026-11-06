/** The only durations that exist, plus one pass of the client strip. */
export const QUICK = 160;
export const NORMAL = 320;
export const SLOW = 640;
export const STRIP_PASS = 64000;

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Turning reduced motion on or off applies from the next animation. */
export function reducedMotion(): boolean {
  return REDUCED.matches;
}

export function onReducedMotionChange(listener: () => void): void {
  REDUCED.addEventListener('change', listener);
}

type Frames = Keyframe[] | PropertyIndexedKeyframes;

/** Every motion is a browser-run animation of exactly the published durations. */
export function animate(
  element: Element,
  frames: Frames,
  duration: number,
  options: KeyframeAnimationOptions = {},
): Animation | null {
  if (reducedMotion()) return null;
  return element.animate(frames, {
    duration,
    easing: 'cubic-bezier(0.2, 0, 0.1, 1)',
    fill: 'none',
    ...options,
  });
}

export function settled(animation: Animation | null): Promise<void> {
  if (animation === null) return Promise.resolve();
  return animation.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** Moved elements travel as the same elements, never redrawn or replaced. */
export function recordPlaces(elements: Iterable<Element>): Map<Element, DOMRect> {
  const places = new Map<Element, DOMRect>();
  for (const element of elements) places.set(element, element.getBoundingClientRect());
  return places;
}

export function playMoves(
  places: Map<Element, DOMRect>,
  duration = NORMAL,
): void {
  if (reducedMotion()) return;
  for (const [element, before] of places) {
    if (!element.isConnected) continue;
    const after = element.getBoundingClientRect();
    const shiftX = before.left - after.left;
    const shiftY = before.top - after.top;
    const scaleX = after.width === 0 ? 1 : before.width / after.width;
    if (Math.abs(shiftX) < 1 && Math.abs(shiftY) < 1 && Math.abs(scaleX - 1) < 0.01) continue;
    element.animate(
      [
        { transform: `translate(${shiftX}px, ${shiftY}px)`, width: `${before.width}px` },
        { transform: 'translate(0, 0)', width: `${after.width}px` },
      ],
      { duration, easing: 'cubic-bezier(0.2, 0, 0.1, 1)' },
    );
  }
}
