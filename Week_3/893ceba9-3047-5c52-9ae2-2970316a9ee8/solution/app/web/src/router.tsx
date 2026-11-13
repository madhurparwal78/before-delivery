import type { AnchorHTMLAttributes, ComponentChildren } from "preact";
import { Store, useStore } from "./store";

interface Route { path: string; query: URLSearchParams }

const read = (): Route => ({ path: location.pathname, query: new URLSearchParams(location.search) });
const routeStore = new Store<Route>(read());
window.addEventListener("popstate", () => routeStore.set(read()));

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  routeStore.set(read());
  window.scrollTo(0, 0);
}

/** Rewrites the query string without leaving the page. */
export function setQuery(values: Record<string, string | null>): void {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(values)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const search = q.toString();
  history.replaceState(null, "", location.pathname + (search ? `?${search}` : ""));
  routeStore.set(read());
}

export const useRoute = () => useStore(routeStore);

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "role"> { href: string; children?: ComponentChildren }

export function Link({ href, onClick, children, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (rest.target && rest.target !== "_self") return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

export const projectHref = (slug: string, page = "", query: Record<string, string> = {}) => {
  const q = new URLSearchParams(query).toString();
  return `/projects/${encodeURIComponent(slug)}${page ? `/${page}` : ""}${q ? `?${q}` : ""}`;
};
