import { useEffect, useState, useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return window.matchMedia(query).matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    prefersReducedMotion,
  );
}

function subscribeLocation(notify: () => void): () => void {
  window.addEventListener("popstate", notify);
  window.addEventListener("bloom:navigate", notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener("bloom:navigate", notify);
  };
}

export function useLocation(): { path: string; search: URLSearchParams } {
  const href = useSyncExternalStore(subscribeLocation, () => window.location.pathname + window.location.search);
  const url = new URL(href, window.location.origin);
  return { path: url.pathname, search: url.searchParams };
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event("bloom:navigate"));
}

/** Runs `tick` every `ms` while `active`; timers follow the page clock. */
export function useInterval(tick: () => void, ms: number, active: boolean): void {
  const [saved] = useState<{ current: () => void }>(() => ({ current: tick }));
  saved.current = tick;
  useEffect(() => {
    if (!active) return;
    let timer = setTimeout(function loop() {
      saved.current();
      timer = setTimeout(loop, ms);
    }, ms);
    return () => clearTimeout(timer);
  }, [active, ms, saved]);
}
