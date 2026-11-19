import { useSyncExternalStore } from "react";

// The single polite live region "Planner updates". Each message empties the region first so a
// repeated sentence is announced again (modules/a11y_dialog announce).

let message = "";
const listeners = new Set<() => void>();
let pending: ReturnType<typeof setTimeout> | null = null;

function emit(next: string): void {
  message = next;
  for (const listener of listeners) listener();
}

export function announce(text: string): void {
  if (pending) clearTimeout(pending);
  emit("");
  pending = setTimeout(() => {
    pending = null;
    emit(text);
  }, 50);
}

export function useAnnouncement(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => message,
  );
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
