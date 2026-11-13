// Live-region announcer: each region keeps its message until the next one.
const regions = new Map<string, HTMLElement>();

export function registerLiveRegion(name: string, element: HTMLElement, assertive = false): void {
  regions.set(name, element);
  void assertive;
}

export function announce(name: string, message: string): void {
  const element = regions.get(name);
  if (!element) return;
  element.textContent = '';
  requestAnimationFrame(() => {
    element.textContent = message;
  });
}

export function liveElement(name: string): HTMLElement | undefined {
  return regions.get(name);
}
