import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

/** A small history router: the scene behind the page never reloads when the route changes. */

const CHANGE = "press:navigate";

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener(CHANGE, listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("popstate", listener);
  };
};

const snapshot = (): string => `${location.pathname}${location.search}`;

export const navigate = (path: string, options: { replace?: boolean } = {}): void => {
  if (options.replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event(CHANGE));
};

interface Place {
  pathname: string;
  search: URLSearchParams;
}

export const usePlace = (): Place => {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [pathname = "/", query = ""] = current.split("?");
  return { pathname, search: new URLSearchParams(query) };
};

export const Link = ({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    event.preventDefault();
    navigate(href);
  };
  return <a {...rest} href={href} onClick={follow} />;
};
