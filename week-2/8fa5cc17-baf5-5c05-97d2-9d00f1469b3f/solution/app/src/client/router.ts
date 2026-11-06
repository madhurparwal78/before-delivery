// A small history router; navigations can carry the daily note reveal or a card-title transition.
import { useSyncExternalStore } from 'react';

export interface Transition { reveal?: boolean; titleFrom?: DOMRect }

const listeners = new Set<() => void>();
let onReveal: () => void = () => undefined;

/** The frame plays the daily note reveal on `main` the moment such a navigation happens. */
export function setRevealHandler(handler: () => void): void {
  onReveal = handler;
}
let location = `${window.location.pathname}${window.location.search}`;
let pending: Transition | null = null;

function update(): void {
  location = `${window.location.pathname}${window.location.search}`;
  for (const fn of listeners) fn();
}

window.addEventListener('popstate', () => {
  pending = null;
  update();
});

export function navigate(to: string, options: { replace?: boolean } & Transition = {}): void {
  const { replace, ...transition } = options;
  pending = transition.reveal || transition.titleFrom ? transition : null;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  update();
  if (transition.reveal) onReveal();
}

/** The transition requested by the navigation that opened the current screen, read once. */
export function takeTransition(): Transition | null {
  const t = pending;
  pending = null;
  return t;
}

export function useLocation(): { path: string; search: URLSearchParams; href: string } {
  const href = useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, () => location);
  const q = href.indexOf('?');
  return { path: q === -1 ? href : href.slice(0, q), search: new URLSearchParams(q === -1 ? '' : href.slice(q)), href };
}

/** Same-origin link clicks become in-app navigations. */
export function linkHandler(to: string, transition: Transition = {}): (e: { preventDefault(): void; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }) => void {
  return (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to, transition);
  };
}
