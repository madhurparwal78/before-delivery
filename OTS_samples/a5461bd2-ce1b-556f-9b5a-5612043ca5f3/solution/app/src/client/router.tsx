import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { resolveRoute, titleOf, type Route } from "../shared/routes";
import { catalog } from "./boot";
import { stage } from "./stage/controller";
import { forgetOpenedTile } from "./storage";

interface Location {
  path: string;
  search: string;
}

let current: Location = { path: window.location.pathname, search: window.location.search };
let navigated = false;
const listeners = new Set<() => void>();

history.scrollRestoration = "manual";

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getLocation = (): Location => current;

export function useLocation(): Location {
  return useSyncExternalStore(subscribe, getLocation);
}

export function routeOf(location: Location): Route {
  return resolveRoute(location.path, catalog);
}

export function useRoute(): Route {
  return routeOf(useLocation());
}

/** True once the visitor has moved inside the site (a direct load has not). */
export function hasNavigated(): boolean {
  return navigated;
}

function split(address: string): Location {
  const url = new URL(address, window.location.origin);
  return { path: url.pathname, search: url.search };
}

/** The address, title, stage state and page all change in the task that asks for the move. */
function commit(next: Location, scroll: boolean): void {
  const previous = routeOf(current);
  current = next;
  const route = routeOf(next);
  document.title = titleOf(route);
  if (route.name !== "work" && route.name !== "case-study") forgetOpenedTile();
  if (scroll) window.scrollTo({ top: 0, behavior: "instant" });
  const movedWorld = previous.name === "world" && route.name === "world" && previous.world !== route.world;
  if (previous.name !== route.name || movedWorld) stage.routeChanged(previous, route);
  flushSync(() => listeners.forEach((listener) => listener()));
}

export function navigate(address: string, options: { replace?: boolean } = {}): void {
  navigated = true;
  const next = split(address);
  if (options.replace) history.replaceState(null, "", address);
  else history.pushState(null, "", address);
  commit(next, !options.replace);
}

window.addEventListener("popstate", () => {
  navigated = true;
  commit({ path: window.location.pathname, search: window.location.search }, true);
});

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
}

/** An in-site link: a plain left click navigates without a page load. */
export function Link({ href, onClick, ...rest }: LinkProps) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target === "_blank") return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
