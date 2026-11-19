import type { ComponentChildren, JSX } from 'preact';
import { createStore, announcement, actionStatus, useStore } from './store.ts';
import { parsePath, type PageRoute } from '../shared/routes.ts';

const location_ = createStore(window.location.pathname + window.location.search);

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  announcement.set(null);
  actionStatus.set('');
  location_.set(path);
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
  announcement.set(null);
  location_.set(window.location.pathname + window.location.search);
});

export function usePath(): string {
  return useStore(location_);
}

export function useRoute(): PageRoute | null {
  return parsePath(usePath().split('?')[0]);
}

export const searchParams = (): URLSearchParams => new URLSearchParams(window.location.search);

type LinkProps = Omit<JSX.IntrinsicElements['a'], 'ref'> & { href: string; children?: ComponentChildren };

/** A same-origin link that navigates without a reload. */
export function Link({ href, children, onClick, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (rest.target && rest.target !== '_self') return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
