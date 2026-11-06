import { useCallback, useEffect, useState, type ReactNode } from 'react';

export interface AppLocation {
  readonly path: string;
  readonly search: string;
}

function current(): AppLocation {
  return { path: window.location.pathname, search: window.location.search };
}

const subscribers = new Set<() => void>();

function notify(): void {
  for (const subscriber of subscribers) subscriber();
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace === true) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  notify();
}

/** Replaces the current history entry, for state that lives in the address. */
export function replaceAddress(to: string): void {
  window.history.replaceState(null, '', to);
  notify();
}

export function useLocation(): AppLocation {
  const [location, setLocation] = useState<AppLocation>(current);
  useEffect(() => {
    const update = (): void => setLocation(current());
    subscribers.add(update);
    window.addEventListener('popstate', update);
    return () => {
      subscribers.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return location;
}

export interface LinkProps {
  readonly to: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly onNavigate?: () => void;
}

export function Link({ to, children, className, onNavigate }: LinkProps): ReactNode {
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      onNavigate?.();
      navigate(to);
    },
    [to, onNavigate],
  );
  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

export function matchRoute(path: string, pattern: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.replace(/\/+$/, '').split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, expected] of patternParts.entries()) {
    const actual = pathParts[index] ?? '';
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}
