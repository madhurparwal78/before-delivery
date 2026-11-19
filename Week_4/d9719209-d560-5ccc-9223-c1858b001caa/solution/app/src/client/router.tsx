import { useCallback, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const NAVIGATE = 'moothall:navigate';

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  window.addEventListener(NAVIGATE, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(NAVIGATE, callback);
  };
}

/** Moves to `to` without a page load. `replace` rewrites the current history entry instead of adding one. */
export function navigate(to: string, replace = false): void {
  const before = location.pathname;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE));
  if (!replace && location.pathname !== before) window.scrollTo(0, 0);
}

export const usePath = (): string => useSyncExternalStore(subscribe, () => location.pathname);
const useSearchText = (): string => useSyncExternalStore(subscribe, () => location.search);

export function useSearch(): URLSearchParams {
  const text = useSearchText();
  return new URLSearchParams(text);
}

/** Writes one query parameter to the URL (removing it when `value` is null) without adding a history entry. */
export function useSetParam(): (key: string, value: string | null) => void {
  return useCallback((key, value) => {
    const next = new URL(location.href);
    if (value === null) next.searchParams.delete(key);
    else next.searchParams.set(key, value);
    navigate(next.pathname + next.search, true);
  }, []);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps): React.JSX.Element {
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target && rest.target !== '_self') return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
