import { useCallback, useEffect, useState } from 'react';

const NAVIGATED = 'elevens:navigated';

export interface Location {
  pathname: string;
  search: string;
}

const read = (): Location => ({
  pathname: window.location.pathname,
  search: window.location.search,
});

export const navigate = (to: string, options: { replace?: boolean } = {}): void => {
  if (options.replace === true) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATED));
};

export const useLocation = (): Location => {
  const [location, setLocation] = useState<Location>(read);
  useEffect(() => {
    const update = (): void => setLocation(read());
    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATED, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATED, update);
    };
  }, []);
  return location;
};

export const useLinkHandler = (): ((event: React.MouseEvent<HTMLAnchorElement>) => void) =>
  useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const href = event.currentTarget.getAttribute('href');
    if (href === null || href.startsWith('http')) return;
    event.preventDefault();
    navigate(href);
  }, []);

export const Link = ({
  to,
  children,
  ...rest
}: { to: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
  const onClick = useLinkHandler();
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  );
};
