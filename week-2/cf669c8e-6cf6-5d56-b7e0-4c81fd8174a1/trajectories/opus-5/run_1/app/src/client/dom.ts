/**
 * DOM helpers.
 *
 * Updates are targeted rather than re-rendered, so status polling and the hold
 * countdown never close a panel, move focus, or clear a typed value.
 */

export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function setAttrs(node: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(key);
      continue;
    }
    node.setAttribute(key, value === true ? '' : String(value));
  }
}

/** Set an attribute only when it changes, so observers see real changes only. */
export function setAttrIfChanged(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** Set text only when it changes: a live region must not rewrite unchanged text. */
export function setTextIfChanged(node: Node, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/** Elements that can take focus inside a dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusable(root: ParentNode): HTMLElement[] {
  return qsa<HTMLElement>(FOCUSABLE, root).filter(
    (node) => node.offsetParent !== null || node.getClientRects().length > 0,
  );
}

/**
 * A money control that is disabled keeps its place in the tab order and sends
 * nothing when pressed, so focus and entries are never lost mid-checkout.
 */
export function setMoneyDisabled(button: HTMLElement, disabled: boolean, reason?: string): void {
  if (disabled) {
    button.setAttribute('aria-disabled', 'true');
    if (reason) button.dataset.reason = reason;
    else delete button.dataset.reason;
  } else {
    button.removeAttribute('aria-disabled');
    delete button.dataset.reason;
  }
}

export function isMoneyDisabled(button: HTMLElement): boolean {
  return button.getAttribute('aria-disabled') === 'true';
}

export const MOTION = {
  press: 160,
  route: 320,
  flight: 680,
  spring: 500,
  reducedFade: 120,
} as const;

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

export function prefersReducedMotion(): boolean {
  return reducedQuery.matches;
}

const reducedListeners = new Set<(reduced: boolean) => void>();

/** The setting applies to the open page within one second, with no reload. */
reducedQuery.addEventListener('change', () => {
  document.documentElement.dataset.reducedMotion = reducedQuery.matches ? 'true' : 'false';
  for (const listener of reducedListeners) listener(reducedQuery.matches);
});
document.documentElement.dataset.reducedMotion = reducedQuery.matches ? 'true' : 'false';

export function onReducedMotionChange(listener: (reduced: boolean) => void): () => void {
  reducedListeners.add(listener);
  return () => reducedListeners.delete(listener);
}

interface CountingState {
  frame: number;
  target: number;
}
const counting = new WeakMap<HTMLElement, CountingState>();

/**
 * Count a figure to its new value over the published duration.
 *
 * The final value is in `data-cents` at once and the existing number stays
 * visible throughout, never blanked. Counting numerals never run inside a live
 * region, so callers pass a plain element.
 */
export function countTo(
  node: HTMLElement,
  targetCents: number,
  render: (cents: number) => string,
): void {
  node.dataset.cents = String(targetCents);

  const previous = counting.get(node);
  if (previous) cancelAnimationFrame(previous.frame);

  const from = Number(node.dataset.shown ?? targetCents);
  if (prefersReducedMotion() || from === targetCents) {
    node.dataset.shown = String(targetCents);
    setTextIfChanged(node, render(targetCents));
    return;
  }

  const started = performance.now();
  const step = (now: number): void => {
    const progress = Math.min(1, (now - started) / MOTION.flight);
    // Starts quickly and settles softly, with no bounce.
    const eased = 1 - (1 - progress) ** 3;
    const value = Math.round(from + (targetCents - from) * eased);
    node.textContent = render(value);
    if (progress < 1) {
      counting.set(node, { frame: requestAnimationFrame(step), target: targetCents });
      return;
    }
    node.dataset.shown = String(targetCents);
    node.textContent = render(targetCents);
    counting.delete(node);
  };
  counting.set(node, { frame: requestAnimationFrame(step), target: targetCents });
}

/** Snap any counting figure to its final value, for a reduced-motion switch. */
export function snapCounting(root: ParentNode = document): void {
  for (const node of qsa<HTMLElement>('[data-cents]', root)) {
    const target = Number(node.dataset.cents);
    if (Number.isFinite(target)) node.dataset.shown = String(target);
  }
}

export function onKey(
  node: HTMLElement,
  handlers: Record<string, (event: KeyboardEvent) => void>,
): void {
  node.addEventListener('keydown', (event) => {
    const handler = handlers[event.key];
    if (!handler) return;
    handler(event);
  });
}

/** Enter and Space activate a control. */
export function onActivate(node: HTMLElement, run: (event: Event) => void): void {
  node.addEventListener('click', run);
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    run(event);
  });
}
