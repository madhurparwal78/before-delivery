// History-API router (no reloads).
//   navigate(to, { replace?, force? })   client navigation; returns false when a navigation guard refused it
//   <A href>                              a real <a>; plain left clicks navigate in-app, modified clicks, new-tab targets,
//                                         downloads and /api/ links keep the browser's behaviour
//   useRoute()                            { pattern, path, search, params, query } of the current page
//   useQuery()                            the current URLSearchParams (read-only; use setQuery to change it)
//   setQuery(patch, { replace? })         change query parameters on the current path, pushing or replacing history without
//                                         a reload; null/undefined/"" remove a key
//   addNavigationGuard(guard)             guard(to) returning false blocks navigate() (the editor's "Unsaved changes" dialog calls
//                                         navigate(to, { force: true }) once the user confirms); returns the remover
//   requestFocusOnArrival(path) / useFocusOnArrival(ref)
//                                         "after this navigation, focus that element": the sender names the path, the page that
//                                         mounts at that path focuses its element (a heading with tabIndex -1)
//   matchPattern(pattern, path)           pattern segments: literal, `:name` (one segment), `*name` (one or more segments)
import { createContext, h, type ComponentChildren, type JSX, type RefObject } from "preact";
import { useContext, useLayoutEffect } from "preact/hooks";
import { createStore } from "./store.ts";

interface Where {
  path: string;
  search: string;
}

export interface RouteState {
  pattern: string;
  path: string;
  search: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

export const locationStore = createStore<Where>({ path: location.pathname, search: location.search });

export function currentLocation(): Where {
  return locationStore.get();
}

const compiled = new Map<string, { regex: RegExp; names: string[] }>();

function compile(pattern: string): { regex: RegExp; names: string[] } {
  const known = compiled.get(pattern);
  if (known) return known;
  const names: string[] = [];
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        names.push(segment.slice(1));
        return "([^/]+)";
      }
      if (segment.startsWith("*")) {
        names.push(segment.slice(1));
        return "(.+?)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    })
    .join("/");
  const entry = { regex: new RegExp(`^${source}$`), names };
  compiled.set(pattern, entry);
  return entry;
}

export function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const { regex, names } = compile(pattern);
  const found = regex.exec(trimmed);
  if (!found) return null;
  const params: Record<string, string> = {};
  names.forEach((name, index) => {
    const raw = found[index + 1] ?? "";
    try {
      params[name] = decodeURIComponent(raw);
    } catch {
      params[name] = raw;
    }
  });
  return params;
}

type Guard = (to: string) => boolean;
const guards = new Set<Guard>();

export function addNavigationGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

interface FocusRequest {
  path: string;
}
let focusRequest: FocusRequest | null = null;

export function requestFocusOnArrival(path: string): void {
  focusRequest = { path };
}

/** Focuses the element when this page was just reached through a navigation that asked for it. */
export function useFocusOnArrival(ref: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    if (focusRequest && focusRequest.path === locationStore.get().path) {
      focusRequest = null;
      ref.current?.focus();
    }
  }, []);
}

interface NavigateOptions {
  replace?: boolean;
  force?: boolean;
}

function isInternal(url: URL): boolean {
  return url.origin === location.origin && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/fonts/");
}

export function navigate(to: string, options: NavigateOptions = {}): boolean {
  const url = new URL(to, location.href);
  if (!isInternal(url)) {
    location.assign(url.href);
    return true;
  }
  const here = locationStore.get();
  const leaving = url.pathname !== here.path;
  if (leaving && !options.force) {
    for (const guard of [...guards]) if (!guard(url.pathname + url.search)) return false;
  }
  if (leaving && focusRequest && focusRequest.path !== url.pathname) focusRequest = null;
  const target = url.pathname + url.search + url.hash;
  if (options.replace || (!leaving && url.search === here.search && url.hash === location.hash)) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  locationStore.set({ path: url.pathname, search: url.search });
  if (leaving) window.scrollTo(0, 0);
  return true;
}

export function setQuery(patch: Record<string, string | number | null | undefined>, options: { replace?: boolean } = {}): void {
  const here = locationStore.get();
  const query = new URLSearchParams(here.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") query.delete(key);
    else query.set(key, String(value));
  }
  const text = query.toString();
  const target = here.path + (text ? `?${text}` : "") + location.hash;
  if (options.replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  locationStore.set({ path: here.path, search: text ? `?${text}` : "" });
}

window.addEventListener("popstate", () => {
  locationStore.set({ path: location.pathname, search: location.search });
});

const empty: RouteState = { pattern: "", path: "/", search: "", params: {}, query: new URLSearchParams() };
export const RouteContext = createContext<RouteState>(empty);

export function useRoute(): RouteState {
  return useContext(RouteContext);
}

export function useQuery(): URLSearchParams {
  return useContext(RouteContext).query;
}

export type AnchorProps = JSX.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ComponentChildren };

export function A(props: AnchorProps) {
  const { onClick, href, ...rest } = props;
  const handle = (event: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    if (typeof onClick === "function") onClick.call(event.currentTarget, event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.currentTarget.getAttribute("target");
    if ((target && target !== "_self") || event.currentTarget.hasAttribute("download") || href.startsWith("#")) return;
    const url = new URL(href, location.href);
    if (!isInternal(url)) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  };
  return h("a", { ...rest, href, onClick: handle });
}
