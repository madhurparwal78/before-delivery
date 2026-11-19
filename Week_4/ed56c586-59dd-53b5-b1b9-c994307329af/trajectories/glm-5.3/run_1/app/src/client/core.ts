/**
 * Client foundations: helpers shared by every interaction module. Only the
 * five published page-clock items run on timers across the site: the intro
 * end, the role rotation, the counters, the callout frame stepping and the
 * media status re-check.
 */

export const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function viewportUnder768(): boolean {
  return window.innerWidth < 768;
}

/** announcement region: each change replaces the text, so each is read once */
export function announce(text: string): void {
  const region = document.querySelector<HTMLElement>("[data-updates]");
  if (region) region.textContent = text;
}

export function qs<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

