import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

type Listener = () => void;
const listeners = new Set<Listener>();
let initialNotFound = document.getElementById("app")?.hasAttribute("data-not-found") ?? false;

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  initialNotFound = false;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  for (const listener of listeners) listener();
  if (!options.replace) window.scrollTo(0, 0);
}

/** Updates the address without telling the router, for state that lives in the query string. */
export function replaceAddress(to: string): void {
  history.replaceState(null, "", to);
}

window.addEventListener("popstate", () => {
  initialNotFound = false;
  for (const listener of listeners) listener();
});

export interface Location {
  path: string;
  search: URLSearchParams;
  notFound: boolean;
}

export function useLocation(): Location {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { path: location.pathname, search: new URLSearchParams(location.search), notFound: initialNotFound };
}

export function Link(props: { href: string; children: ComponentChildren } & Omit<JSX.HTMLAttributes<HTMLAnchorElement>, "href">) {
  const { href, children, onClick, ...rest } = props;
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        if (typeof onClick === "function") onClick.call(event.currentTarget, event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
