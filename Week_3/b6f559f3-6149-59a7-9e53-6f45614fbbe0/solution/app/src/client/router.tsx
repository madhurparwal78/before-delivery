import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());
window.addEventListener('popstate', notify);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const usePath = (): string => useSyncExternalStore(subscribe, () => window.location.pathname);

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.scrollTo(0, 0);
  notify();
}

type Route =
  | { name: 'landing' }
  | { name: 'signin' }
  | { name: 'projects' }
  | { name: 'editor'; projectId: string }
  | { name: 'invite'; token: string }
  | { name: 'missing' };

export function parseRoute(path: string): Route {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'landing' };
  const [first, second] = parts;
  if (parts.length === 1 && first === 'signin') return { name: 'signin' };
  if (first === 'projects' && parts.length === 1) return { name: 'projects' };
  if (first === 'projects' && second && parts.length === 2) return { name: 'editor', projectId: second };
  if (first === 'invite' && second && parts.length === 2) return { name: 'invite', token: second };
  return { name: 'missing' };
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    const internal = href.startsWith('/') && !href.startsWith('//');
    if (event.defaultPrevented || !internal || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (href.includes('#') && href.split('#')[0] === window.location.pathname) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
