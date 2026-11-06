import { useSyncExternalStore, type ComponentPropsWithRef, type MouseEvent, type ReactNode } from 'react';

const listeners = new Set<() => void>();
let current = `${location.pathname}${location.search}`;

function emit(): void {
  current = `${location.pathname}${location.search}`;
  listeners.forEach((listener) => listener());
}

window.addEventListener('popstate', emit);

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (`${location.pathname}${location.search}` === to) return;
  if (options.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  emit();
}

interface Location { path: string; search: URLSearchParams; href: string }

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useLocation(): Location {
  const href = useSyncExternalStore(subscribe, () => current);
  const [path, query = ''] = href.split('?');
  return { path: path ?? '/', search: new URLSearchParams(query), href };
}

export function Link({ to, children, onClick, ...rest }: { to: string; children: ReactNode } & Omit<ComponentPropsWithRef<'a'>, 'href'>): ReactNode {
  const click = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={click} {...rest}>{children}</a>;
}
