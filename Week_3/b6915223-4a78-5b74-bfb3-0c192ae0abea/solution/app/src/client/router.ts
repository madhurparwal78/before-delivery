import { useEffect, useState } from "preact/hooks";

// History-based routing; the query string is part of the page state (brief: Filters in the address).
const subscribers = new Set<() => void>();

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  for (const notify of subscribers) notify();
}

addEventListener("popstate", () => {
  for (const notify of subscribers) notify();
});

export function useLocation(): { path: string; search: URLSearchParams } {
  const [, setTick] = useState(0);
  const rendered = location.pathname + location.search;
  useEffect(() => {
    const notify = () => setTick((tick) => tick + 1);
    subscribers.add(notify);
    // The address may have changed between this render and the subscription.
    if (location.pathname + location.search !== rendered) notify();
    return () => void subscribers.delete(notify);
  }, []);
  return { path: location.pathname, search: new URLSearchParams(location.search) };
}

export function linkClick(event: MouseEvent, to: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(to);
}
