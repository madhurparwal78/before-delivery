import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const CHANGE = 'tempoline:navigate';

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener('popstate', notify);
  window.addEventListener(CHANGE, notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener(CHANGE, notify);
  };
};

const snapshot = (): string => window.location.pathname + window.location.search;

export function navigate(to: string, replace = false): void {
  if (to === snapshot()) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  window.dispatchEvent(new Event(CHANGE));
}

export function useLocation(): { path: string; params: URLSearchParams } {
  const location = useSyncExternalStore(subscribe, snapshot);
  const [path = '/', query = ''] = location.split('?');
  return { path, params: new URLSearchParams(query) };
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} onClick={follow} />;
}
