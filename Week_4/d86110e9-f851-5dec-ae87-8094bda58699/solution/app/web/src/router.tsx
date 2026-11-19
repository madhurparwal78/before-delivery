import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const snapshot = (): string => `${window.location.pathname}${window.location.search}`;

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function useSearch(): string {
  useSyncExternalStore(subscribe, snapshot);
  return window.location.search;
}

/** State handed to the next page through history, such as the notice an import lands with. */
export function useNavState<T>(): T | null {
  useSyncExternalStore(subscribe, snapshot);
  return (window.history.state as T | null) ?? null;
}

export function navigate(to: string, options: { replace?: boolean; state?: unknown } = {}): void {
  if (options.replace) window.history.replaceState(options.state ?? null, '', to);
  else window.history.pushState(options.state ?? null, '', to);
  listeners.forEach((listener) => listener());
  const anchor = to.includes('#') ? document.getElementById(to.slice(to.indexOf('#') + 1)) : null;
  if (anchor) anchor.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
}

export function Link({ to, onClick, ...rest }: LinkProps) {
  const go = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target === '_blank' || to.startsWith('#')) return;
    event.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} onClick={go} />;
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const names: string[] = [];
  const source = pattern.replace(/:([a-z]+)/g, (_match, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  const found = new RegExp(`^${source}$`).exec(path);
  if (found === null) return null;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(found[index + 1] ?? '')]));
}

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Pinbyte Switchyard`;
  }, [title]);
}
