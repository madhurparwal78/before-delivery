import { useEffect, useState } from 'preact/hooks';

const listeners = new Set<() => void>();

export function navigate(path: string, replace = false): void {
  if (path === location.pathname + location.search) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  listeners.forEach((listener) => listener());
  window.scrollTo(0, 0);
}

addEventListener('popstate', () => listeners.forEach((listener) => listener()));

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = (): void => setPath(location.pathname);
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return path;
}

/** Same-document navigation for plain link clicks. */
export function onLinkClick(event: MouseEvent): void {
  const anchor = (event.target as Element | null)?.closest('a[data-route]');
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  navigate(anchor.getAttribute('href') ?? '/');
}
