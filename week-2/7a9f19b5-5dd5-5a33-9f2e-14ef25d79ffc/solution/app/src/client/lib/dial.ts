// The lighting dial: Auto follows the viewer's local hour; a manual choice recolours the whole site at once.
import { useSyncExternalStore } from "react";
import { isDialMode, lightForHour, type DialMode, type LightState } from "../../shared/dial";

const STORAGE_KEY = "lf-dial";
const RECHECK_MS = 60_000;
const listeners = new Set<() => void>();

let mode: DialMode = (() => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isDialMode(stored) ? stored : "auto";
})();

function resolvedLight(current: DialMode = mode): LightState {
  return current === "auto" ? lightForHour(new Date().getHours()) : current;
}

function apply(): void {
  const root = document.documentElement;
  root.dataset.light = resolvedLight();
  root.dataset.lightMode = mode;
  for (const listener of listeners) listener();
}

/** Sets the mode for this browser (signed-out visitors keep it here; signed-in users also save it to the server). */
export function setDialMode(next: DialMode): void {
  mode = next;
  localStorage.setItem(STORAGE_KEY, next);
  apply();
}

export function useDial(): { mode: DialMode; light: LightState } {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => `${mode}:${resolvedLight()}`,
  );
  const [current, light] = snapshot.split(":") as [DialMode, LightState];
  return { mode: current, light };
}

apply();
// Auto re-checks every minute and changes state when the hour crosses a band.
setInterval(() => {
  if (mode === "auto" && document.documentElement.dataset.light !== resolvedLight()) apply();
}, RECHECK_MS);
