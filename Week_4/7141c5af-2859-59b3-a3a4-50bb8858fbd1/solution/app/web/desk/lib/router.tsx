import { useEffect, useState } from "preact/hooks";

interface Location {
  path: string;
  search: string;
  hash: string;
}

/** What a screen does when it has arrived: `push` focuses the heading, `pop` and `load` restore where the reader was. */
type Arrival = { kind: "push" | "none" } | { kind: "pop" | "load"; scroll: number; returnTo: string | null };

interface EntryState {
  scroll?: number;
  returnTo?: string | null;
}

let location: Location = read();
let arrival: Arrival = { kind: "load", ...savedEntry() };
const listeners = new Set<() => void>();

function read(): Location {
  return { path: window.location.pathname, search: window.location.search, hash: window.location.hash };
}

function savedEntry(): { scroll: number; returnTo: string | null } {
  const state = (history.state ?? {}) as EntryState;
  return { scroll: state.scroll ?? 0, returnTo: state.returnTo ?? null };
}

function saveEntry(returnTo: string | null): void {
  history.replaceState({ ...(history.state as EntryState | null), scroll: window.scrollY, returnTo }, "");
}

function changed(next: Arrival): void {
  location = read();
  arrival = next;
  for (const listener of listeners) listener();
}

export function initRouter(isDeskPath: (path: string) => boolean): void {
  history.scrollRestoration = "manual";
  addEventListener("popstate", () => changed({ kind: "pop", ...savedEntry() }));
  addEventListener("pagehide", () => saveEntry(savedEntry().returnTo));
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest?.("a[href]");
    if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download") || link.origin !== window.location.origin) return;
    if (!isDeskPath(link.pathname)) return;
    event.preventDefault();
    navigate(`${link.pathname}${link.search}${link.hash}`, { returnTo: link.dataset.return ?? null });
  });
}

/** One history entry and no page move. `returnTo` names the `data-return` element focus goes back to on Back. */
export function navigate(to: string, options: { replace?: boolean; returnTo?: string | null } = {}): void {
  saveEntry(options.returnTo ?? null);
  if (options.replace) history.replaceState({}, "", to);
  else history.pushState({}, "", to);
  window.scrollTo({ top: 0, behavior: "instant" });
  changed({ kind: "push" });
}

/** One history entry for a change made on the same screen: focus and scroll stay where they are. */
export function commitSearch(search: string): void {
  saveEntry(null);
  history.pushState({}, "", `${window.location.pathname}${search}`);
  changed({ kind: "none" });
}

/** Keeps the address in step with a value on the screen and never adds a history entry. */
export function replaceSearch(search: string): void {
  history.replaceState(history.state, "", `${window.location.pathname}${search}${window.location.hash}`);
  location = read();
}

export function useLocation(): Location {
  const [, render] = useState(0);
  useEffect(() => {
    const listener = (): void => render((turn) => turn + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return location;
}

/** The arrival not yet handled; taking it means it runs once for each navigation. */
export function takeArrival(): Arrival {
  const taken = arrival;
  arrival = { kind: "none" };
  return taken;
}

export function currentAddress(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
