// Addresses, history, one-shot messages carried across a navigation, and typed values kept across a sign-in.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", notify);

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.scrollTo({ top: 0, behavior: "instant" });
  notify();
}

interface Place {
  path: string;
  search: URLSearchParams;
  href: string;
}

function place(): Place {
  return { path: location.pathname, search: new URLSearchParams(location.search), href: location.pathname + location.search };
}

export function useLocation(): Place {
  const [here, setHere] = useState(place);
  useLayoutEffect(() => {
    const update = () => setHere(place());
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return here;
}

/** Follows a same-origin link inside the app without reloading the page. */
export function followLink(event: MouseEvent, href: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(href);
}

const flashes = new Map<string, string>();

/** A message to show once on the address an action lands on. */
export function setFlash(path: string, message: string): void {
  flashes.set(path, message);
}

export function takeFlash(path: string): string | null {
  const message = flashes.get(path) ?? null;
  flashes.delete(path);
  return message;
}

const drafts = new Map<string, () => unknown>();
const DRAFT_PREFIX = "tw-drafts:";

/** Registers a screen's typed values so an ended session can keep them. */
export function useDraft(key: string, value: unknown): void {
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    drafts.set(key, () => latest.current);
    return () => void drafts.delete(key);
  }, [key]);
}

export function saveDrafts(): void {
  if (!drafts.size) return;
  const values = Object.fromEntries([...drafts].map(([key, read]) => [key, read()]));
  sessionStorage.setItem(DRAFT_PREFIX + location.pathname + location.search, JSON.stringify(values));
}

/** Typed values kept for this address before a sign-in; each is handed back once. */
export function takeDraft<T>(key: string): T | undefined {
  const storageKey = DRAFT_PREFIX + location.pathname + location.search;
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return undefined;
  const values = JSON.parse(raw) as Record<string, unknown>;
  const value = values[key] as T | undefined;
  delete values[key];
  if (Object.keys(values).length) sessionStorage.setItem(storageKey, JSON.stringify(values));
  else sessionStorage.removeItem(storageKey);
  return value;
}
