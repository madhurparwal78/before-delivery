import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let current = `${window.location.pathname}${window.location.search}`;

function announce(): void {
  current = `${window.location.pathname}${window.location.search}`;
  for (const listener of listeners) listener();
}

window.addEventListener('popstate', announce);

export function navigate(path: string): void {
  if (path === current) return;
  window.history.pushState(null, '', path);
  announce();
}

/** Used while scrubbing: the tick changes without adding history entries. */
export function replaceQuery(path: string): void {
  window.history.replaceState(null, '', path);
  current = path;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocation(): { pathname: string; search: URLSearchParams } {
  const value = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  const [pathname, search] = value.split('?');
  return { pathname, search: new URLSearchParams(search ?? '') };
}

export function Link({
  to,
  children,
  className,
  ...rest
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
