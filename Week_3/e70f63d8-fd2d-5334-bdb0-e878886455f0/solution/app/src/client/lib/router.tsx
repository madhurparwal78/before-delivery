import type { ComponentChildren, JSX } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';

const NAVIGATED = 'overcall:navigate';

export const navigate = (to: string, replace = false): void => {
  if (replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATED));
  window.scrollTo(0, 0);
};

/** The current path, kept in step with the address bar. */
export const usePath = (): string => {
  const [path, setPath] = useState(location.pathname);
  useLayoutEffect(() => {
    const update = (): void => setPath(location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATED, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATED, update);
    };
  }, []);
  return path;
};

interface LinkProps extends Omit<JSX.HTMLAttributes<HTMLAnchorElement>, 'href'> { href: string; children?: ComponentChildren }

export const Link = ({ href, children, onClick, ...rest }: LinkProps): JSX.Element => (
  <a
    href={href}
    {...rest}
    onClick={(event) => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(href);
    }}
  >
    {children}
  </a>
);
