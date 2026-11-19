const listeners: (() => void)[] = [];

/** One scroll and resize listener for every scroll-linked behaviour of the page. */
export function onScroll(listener: () => void): void {
  listeners.push(listener);
}

export function runScrollListeners(): void {
  for (const listener of listeners) listener();
}

export function startScrollListeners(): void {
  addEventListener("scroll", runScrollListeners, { passive: true });
  addEventListener("resize", runScrollListeners);
}
