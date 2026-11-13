import type { ComponentChildren, JSX } from "preact";
import { Store, useStore } from "./store";

interface Location {
  path: string;
  search: URLSearchParams;
}

function current(): Location {
  return { path: window.location.pathname, search: new URLSearchParams(window.location.search) };
}

const location = new Store<Location>(current());

window.addEventListener("popstate", () => location.set(current()));

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  location.set(current());
}

export const useLocation = (): Location => useStore(location);

interface LinkProps extends Omit<JSX.HTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children: ComponentChildren;
}

export function Link({ href, children, ...rest }: LinkProps): JSX.Element {
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
