import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

addEventListener('popstate', notify);

export function navigate(path: string, replace = false): void {
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  scrollTo({ top: 0, behavior: 'instant' });
  notify();
}

export function useLocation(): string {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => location.pathname + location.search);
}
