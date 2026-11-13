import type { ComponentChildren, JSX } from "preact";
import { Store, useStore } from "./store.js";

type Route = { path: string; search: string };
export const route = new Store<Route>({ path: "/", search: "" });

export function initRouter(path: string, search: string): void {
  route.set({ path, search });
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", () => route.set({ path: location.pathname, search: location.search }));
  }
}

function navigate(href: string): void {
  const url = new URL(href, location.href);
  history.pushState(history.state, "", url.pathname + url.search);
  route.set({ path: url.pathname, search: url.search });
  window.scrollTo(0, 0);
}

/** An ordinary anchor that moves between screens without a page load. */
export function Link({ href, children, ...rest }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string; children: ComponentChildren }): JSX.Element {
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

export const useRoute = (): Route => useStore(route, (s) => s);
