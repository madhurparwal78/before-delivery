import { useSyncExternalStore } from "react";

// History-API routing. Every navigation and every Back or Forward notifies subscribers with the direction,
// which the public site uses for its panel wipe.

type Direction = "forward" | "back";

interface Location {
  pathname: string;
  search: string;
  href: string;
  direction: Direction;
  key: number;
}

let historyIndex = typeof history.state?.index === "number" ? (history.state.index as number) : 0;
if (typeof history.state?.index !== "number") history.replaceState({ ...(history.state ?? {}), index: historyIndex }, "");

let current: Location = read("forward");
const listeners = new Set<() => void>();

function read(direction: Direction): Location {
  return { pathname: location.pathname, search: location.search, href: location.pathname + location.search, direction, key: Date.now() + Math.random() };
}

function emit(direction: Direction): void {
  current = read(direction);
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", (event) => {
  const index = typeof event.state?.index === "number" ? (event.state.index as number) : 0;
  const direction: Direction = index < historyIndex ? "back" : "forward";
  historyIndex = index;
  emit(direction);
});

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) {
    history.replaceState({ index: historyIndex }, "", to);
  } else {
    historyIndex += 1;
    history.pushState({ index: historyIndex }, "", to);
  }
  emit("forward");
}

export function useLocation(): Location {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => current);
}

/** Query parameters of the current location. */
export function useQuery(): URLSearchParams {
  return new URLSearchParams(useLocation().search);
}

/** Matches `/office/projects/:id/:section` style patterns; returns the params or null. */
export function match(pattern: string, pathname: string): Record<string, string> | null {
  const names: string[] = [];
  const source = pattern.replace(/:([a-zA-Z]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  const found = new RegExp(`^${source}/?$`).exec(pathname);
  if (!found) return null;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(found[index + 1])]));
}

/** Client-side link handling for same-origin anchors: plain left clicks navigate without a reload. */
export function linkClick(event: React.MouseEvent<HTMLAnchorElement>, href: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(href);
}
