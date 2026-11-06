// A small history router: the brief's six routes and the not-found screen.
import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  for (const l of listeners) l();
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): JSX.Element {
  const go = (e: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={go} {...rest} />;
}

export type Route =
  | { screen: "signin" }
  | { screen: "list" }
  | { screen: "workbook"; id: string }
  | { screen: "station" }
  | { screen: "invite"; token: string }
  | { screen: "share"; token: string }
  | { screen: "notFound" };

export function match(path: string): Route {
  if (path === "/") return { screen: "list" };
  if (path === "/signin") return { screen: "signin" };
  if (path === "/station") return { screen: "station" };
  const m = /^\/(w|invite|s)\/([^/]+)$/.exec(path);
  if (m?.[1] === "w") return { screen: "workbook", id: decodeURIComponent(m[2]) };
  if (m?.[1] === "invite") return { screen: "invite", token: decodeURIComponent(m[2]) };
  if (m?.[1] === "s") return { screen: "share", token: decodeURIComponent(m[2]) };
  return { screen: "notFound" };
}
