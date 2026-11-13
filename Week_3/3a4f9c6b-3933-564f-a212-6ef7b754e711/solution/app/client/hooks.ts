// Small browser hooks: the location, media queries, element width and the refresh interval.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

const LOCATION_EVENT = "keelson:navigate";

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(LOCATION_EVENT));
}

function subscribeLocation(notify: () => void): () => void {
  window.addEventListener("popstate", notify);
  window.addEventListener(LOCATION_EVENT, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(LOCATION_EVENT, notify);
  };
}

export function useLocation(): { pathname: string; search: URLSearchParams } {
  const href = useSyncExternalStore(subscribeLocation, () => location.pathname + location.search);
  const url = new URL(href, location.origin);
  return { pathname: url.pathname, search: url.searchParams };
}

export function useMedia(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const list = matchMedia(query);
    list.addEventListener("change", notify);
    return () => list.removeEventListener("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}

export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Runs `task` now and then every `ms` while mounted (the brief's refresh delay). */
export function useEvery(ms: number, task: () => void): void {
  const latest = useRef(task);
  latest.current = task;
  useEffect(() => {
    latest.current();
    const timer = setInterval(() => latest.current(), ms);
    return () => clearInterval(timer);
  }, [ms]);
}
