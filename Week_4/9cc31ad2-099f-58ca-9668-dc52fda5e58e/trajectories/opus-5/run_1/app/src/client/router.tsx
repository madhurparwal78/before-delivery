import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

export function navigate(to: string, options?: { replace?: boolean }): void {
  if (options?.replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  announce();
}

export interface Location {
  pathname: string;
  search: string;
}

export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  useEffect(() => {
    const update = () =>
      setLocation({ pathname: window.location.pathname, search: window.location.search });
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return location;
}

export function Link({
  to,
  children,
  className,
  id,
  onActivate,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  id?: string;
  onActivate?: () => void;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onActivate?.();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} className={className} id={id}>
      {children}
    </a>
  );
}
