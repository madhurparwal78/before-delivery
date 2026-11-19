import { useEffect, useState } from 'react';

export interface Location {
  pathname: string;
  search: string;
}

function current(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

export function push(url: string): void {
  window.history.pushState(null, '', url);
  announce();
}

export function replace(url: string): void {
  window.history.replaceState(null, '', url);
  announce();
}

export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(current);
  useEffect(() => {
    const update = (): void => setLocation(current());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return location;
}

/** A `next` value is followed only when it is a same-origin path. */
export function safeNext(next: string | null): string {
  if (next === null) return '/';
  if (!next.startsWith('/')) return '/';
  if (next.length > 1 && (next.charAt(1) === '/' || next.charAt(1) === '\\')) return '/';
  return next;
}

export function projectUrl(
  projectId: string,
  parts: { file?: string; line?: number; thread?: string },
): string {
  const search = new URLSearchParams();
  if (parts.thread !== undefined) search.set('thread', parts.thread);
  if (parts.file !== undefined) search.set('file', parts.file);
  if (parts.line !== undefined) search.set('line', String(parts.line));
  const query = search.toString();
  return `/p/${projectId}${query === '' ? '' : `?${query}`}`;
}
