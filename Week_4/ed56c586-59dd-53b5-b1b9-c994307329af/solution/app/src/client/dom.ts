/** DOM helpers shared by every client module. */

export function must<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing element: ${selector}`);
  return found;
}

export function all<T extends Element>(root: ParentNode, selector: string): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function isNarrow(): boolean {
  return window.innerWidth < 768;
}

export function isPrimaryClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** Plays an animation unless the visitor asked for reduced motion; the returned promise settles when it ends or is cancelled. */
export function play(element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | undefined {
  return prefersReducedMotion() ? undefined : element.animate(keyframes, options);
}

export function whenFinished(animation: Animation | undefined, then: () => void): void {
  if (animation === undefined) {
    then();
    return;
  }
  animation.finished.then(then, () => undefined);
}
