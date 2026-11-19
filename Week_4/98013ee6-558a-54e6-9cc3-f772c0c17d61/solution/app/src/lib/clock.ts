import { useSyncExternalStore } from "react";

/** The business clock as the browser knows it: the last server `now`, counted on with the page's own timer. */
let anchorServerMs = Date.now();
let anchorLocalMs = performance.now();
let version = 0;
const listeners = new Set<() => void>();

const bump = (): void => {
  version += 1;
  listeners.forEach((listener) => listener());
};

export function syncClock(serverNow: string): void {
  anchorServerMs = Date.parse(serverNow);
  anchorLocalMs = performance.now();
  bump();
}

export const businessNow = (): number => anchorServerMs + (performance.now() - anchorLocalMs);

setInterval(bump, 10_000);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Re-renders its component when the clock moves or ticks (at least every 10 seconds). */
export function useBusinessTick(): number {
  return useSyncExternalStore(subscribe, () => version);
}
