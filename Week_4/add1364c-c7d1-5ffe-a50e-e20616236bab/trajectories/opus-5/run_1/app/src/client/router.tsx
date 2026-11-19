import { useCallback, useEffect, useState } from 'react';

export type Location = { path: string; query: URLSearchParams };

function read(): Location {
  return { path: window.location.pathname, query: new URLSearchParams(window.location.search) };
}

const listeners = new Set<(where: Location) => void>();

function tell(): void {
  const where = read();
  for (const listener of listeners) listener(where);
}

export function go(to: string): void {
  if (to === window.location.pathname + window.location.search) return;
  window.history.pushState(null, '', to);
  tell();
}

export function replace(to: string): void {
  window.history.replaceState(null, '', to);
  tell();
}

export function useLocation(): Location {
  const [where, setWhere] = useState<Location>(read);
  useEffect(() => {
    const listener = (next: Location): void => setWhere(next);
    listeners.add(listener);
    const onPop = (): void => tell();
    window.addEventListener('popstate', onPop);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('popstate', onPop);
    };
  }, []);
  return where;
}

export function useNavigate(): (to: string) => void {
  return useCallback((to: string) => go(to), []);
}

export function DrawerLink(props: {
  to: string;
  children: React.ReactNode;
  className?: string;
  onNavigate?: () => void;
}): React.ReactElement {
  return (
    <a
      href={props.to}
      className={props.className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        props.onNavigate?.();
        go(props.to);
      }}
    >
      {props.children}
    </a>
  );
}
