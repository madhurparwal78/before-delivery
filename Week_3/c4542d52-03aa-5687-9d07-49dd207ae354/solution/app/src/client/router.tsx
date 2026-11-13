import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

type Location = { path: string; search: string };

const listeners = new Set<() => void>();
let current: Location = read();
let pendingFocus: string | null = null;
let focusObserver: MutationObserver | null = null;

function read(): Location {
  return { path: window.location.pathname, search: window.location.search };
}

function publish(): void {
  current = read();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useLocation = (): Location => useSyncExternalStore(subscribe, () => current);

function tryFocus(): void {
  if (pendingFocus === null) return;
  const target = document.querySelector<HTMLElement>(pendingFocus);
  if (!target) return;
  target.focus();
  if (document.activeElement === target) stopFocusRequest();
}

function stopFocusRequest(): void {
  pendingFocus = null;
  focusObserver?.disconnect();
  focusObserver = null;
}

/** Focuses the first element matching `selector` as soon as one exists; any key or pointer press by the person cancels it. */
export function requestFocus(selector: string): void {
  stopFocusRequest();
  pendingFocus = selector;
  focusObserver = new MutationObserver(tryFocus);
  focusObserver.observe(document.body, { childList: true, subtree: true });
  // After the commit that the caller just caused, not before it: the old page may still hold a matching element.
  queueMicrotask(tryFocus);
}

for (const kind of ["keydown", "pointerdown"]) window.addEventListener(kind, stopFocusRequest, true);

type NavigateOptions = { replace?: boolean; returnFocus?: string; focus?: string };

export function navigate(to: string, options: NavigateOptions = {}): void {
  if (options.replace) window.history.replaceState({ ...(window.history.state ?? {}) }, "", to);
  else {
    if (options.returnFocus) window.history.replaceState({ ...(window.history.state ?? {}), returnFocus: options.returnFocus }, "");
    window.history.pushState({ inApp: true }, "", to);
  }
  publish();
  if (options.focus) requestFocus(options.focus);
}

/** Changes the address in place, without a history entry and without redrawing the page. */
export function replaceAddress(to: string): void {
  window.history.replaceState({ ...(window.history.state ?? {}) }, "", to);
  current = read();
}

/** Back to the previous page of this session, or to `fallback` when the page was opened from the address bar. */
export function goBackOr(fallback: string, options: NavigateOptions = {}): void {
  if (window.history.state?.inApp) window.history.back();
  else navigate(fallback, { replace: true, ...options });
}

window.addEventListener("popstate", () => {
  publish();
  const target = window.history.state?.returnFocus;
  if (typeof target === "string") requestFocus(target);
});

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; returnFocus?: string; focusTarget?: string };

export function Link({ href, returnFocus, focusTarget, onClick, ...rest }: LinkProps) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href, { returnFocus, focus: focusTarget });
  };
  return <a href={href} onClick={handle} {...rest} />;
}

export function queryOf(search: string): URLSearchParams {
  return new URLSearchParams(search);
}
