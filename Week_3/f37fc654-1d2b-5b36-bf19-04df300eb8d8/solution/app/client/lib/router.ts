// A small history router: the stage stays mounted while routes change.
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let snapshot = { path: location.pathname, search: location.search, state: history.state as unknown };

function emit(): void {
  snapshot = { path: location.pathname, search: location.search, state: history.state as unknown };
  listeners.forEach((l) => l());
}

addEventListener("popstate", emit);

export function navigate(to: string, options: { replace?: boolean; state?: unknown } = {}): void {
  if (options.replace) history.replaceState(options.state ?? null, "", to);
  else history.pushState(options.state ?? null, "", to);
  emit();
  if (!options.replace) scrollTo({ top: 0, behavior: "instant" });
}

export function useLocation(): typeof snapshot {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, () => snapshot);
}

export const currentRoute = (): string => location.pathname + location.search;
