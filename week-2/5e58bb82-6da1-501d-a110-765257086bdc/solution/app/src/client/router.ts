// A small history router. Screens read the address; navigation replaces or pushes without reloading.
import { useSyncExternalStore } from "react";

type Guard = (go: () => void) => boolean;

const listeners = new Set<() => void>();
let guard: Guard | null = null;

function emit(): void {
  for (const l of listeners) l();
}

window.addEventListener("popstate", emit);

export function useLocation(): { path: string; search: string; href: string } {
  const href = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => window.location.pathname + window.location.search,
  );
  const [path, search = ""] = href.split("?");
  return { path, search: search ? `?${search}` : "", href };
}

export function navigate(href: string, options: { replace?: boolean; state?: unknown } = {}): void {
  if (options.replace) window.history.replaceState(options.state ?? null, "", href);
  else window.history.pushState(options.state ?? null, "", href);
  emit();
}

/** In-app link navigation asks the guard first (the line plan's unsaved assignments). */
export function follow(href: string): void {
  const go = () => navigate(href);
  if (guard && !guard(go)) return;
  go();
}

export function setLeaveGuard(next: Guard | null): void {
  guard = next;
}

export function searchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}
