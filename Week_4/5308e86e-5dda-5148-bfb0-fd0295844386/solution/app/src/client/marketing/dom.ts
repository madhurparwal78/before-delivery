/** Small DOM helpers shared by the marketing modules. */
import breakpoints from "../../shared/breakpoints.json";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

/** The window width from which the header shows its menus inline. */
export const HEADER_INLINE_QUERY = `(min-width: ${breakpoints.railInline}px)`;

/** Controls inside `root` that can take focus right now: anything in a hidden panel is skipped. */
export function focusableWithin(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.getClientRects().length > 0);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function requireElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing element ${selector}`);
  return element;
}
