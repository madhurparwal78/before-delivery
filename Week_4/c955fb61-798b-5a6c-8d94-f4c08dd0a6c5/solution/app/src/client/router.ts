import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

window.addEventListener("popstate", notify);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = (): string => location.pathname + location.search;

export function navigate(target: string, replace = false): void {
  if (replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  notify();
}

export function useLocation(): { path: string; params: URLSearchParams } {
  const current = useSyncExternalStore(subscribe, snapshot);
  const at = current.indexOf("?");
  return { path: at < 0 ? current : current.slice(0, at), params: new URLSearchParams(at < 0 ? "" : current.slice(at)) };
}

/** Changes query parameters in place (`null` removes one); the address is replaced, not pushed, unless asked. */
export function setParams(changes: Record<string, string | null>, push = false): void {
  const params = new URLSearchParams(location.search);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) params.delete(name);
    else params.set(name, value);
  }
  const query = params.toString();
  navigate(location.pathname + (query ? `?${query}` : ""), !push);
}
