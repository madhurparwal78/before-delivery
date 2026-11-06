// History router with a page registry.
//
// - definePage({ pattern, kind, roles?, render }) registers a page (call it at module top level).
//   `pattern` is a path like "/boards/:board" or a RegExp; params arrive in `match.params`
//   (by name, or "0", "1"… for RegExp groups).
//   kind "public" pages get the route cover between them, "workspace" pages are guarded by role,
//   "account" pages are the plain sign-in forms.
// - <Link href> and navigate(href, { replace }) move without reloading; useLocation() reads the shown address.
// - useLeaveGuard(active, onAttempt) lets a page intercept in-app navigation (the cast request).
// - After every pathname change the new level-one heading takes focus and the title becomes
//   "<heading> — Vesper & Rowe Talent".

import { useEffect, useRef, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent,
  type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Role } from "./session.js";

export type PageKind = "public" | "workspace" | "account";

export interface Match {
  pathname: string;
  query: URLSearchParams;
  params: Record<string, string>;
}

export interface PageDef {
  pattern: string | RegExp;
  kind: PageKind;
  roles?: Role[];
  render: (match: Match) => ReactNode;
}

interface Compiled extends PageDef {
  regex: RegExp;
  keys: string[];
}

const pages: Compiled[] = [];

export function definePage(def: PageDef): void {
  if (def.pattern instanceof RegExp) {
    pages.push({ ...def, regex: def.pattern, keys: [] });
    return;
  }
  const keys: string[] = [];
  const source = def.pattern.replace(/:(\w+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  pages.push({ ...def, regex: new RegExp(`^${source}$`), keys });
}

export function findPage(pathname: string): { page: Compiled; params: Record<string, string> } | null {
  for (const page of pages) {
    const found = page.regex.exec(pathname);
    if (found) {
      const names = page.keys.length ? page.keys : found.slice(1).map((_, i) => String(i));
      const params = Object.fromEntries(names.map((key, i) => [key, decodeURIComponent(found[i + 1] ?? "")]));
      return { page, params };
    }
  }
  return null;
}

interface Loc {
  pathname: string;
  search: string;
  index: number;
}

function readLoc(): Loc {
  const index = typeof history.state?.idx === "number" ? (history.state.idx as number) : 0;
  return { pathname: location.pathname, search: location.search, index };
}

let current: Loc = readLoc();
let shown: Loc = current;
const listeners = new Set<() => void>();
let coverEl: HTMLDivElement | null = null;
let viewEl: HTMLDivElement | null = null;
let generation = 0;

history.scrollRestoration = "manual";
history.replaceState({ ...(history.state ?? {}), idx: current.index }, "");

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function reduced(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const SITE = "Vesper & Rowe Talent";

/** Waits for the page's h1, then focuses it (when asked) and sets the title from it. */
function settleHeading(focus: boolean, token: number): void {
  let tries = 0;
  const attempt = () => {
    if (token !== generation) return;
    const heading = document.querySelector<HTMLElement>("#root main h1");
    if (!heading) {
      if (++tries < 100) setTimeout(attempt, 50);
      return;
    }
    if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    document.title = `${(heading.textContent ?? "").replace(/\s+/g, " ").trim()} — ${SITE}`;
    if (focus) heading.focus();
  };
  attempt();
}

function show(next: Loc): void {
  flushSync(() => {
    shown = next;
    notify();
  });
}

async function transition(next: Loc, back: boolean): Promise<void> {
  const token = ++generation;
  const before = findPage(shown.pathname)?.page.kind;
  const after = findPage(next.pathname)?.page.kind;
  current = next;
  if (next.pathname === shown.pathname) {
    show(next);
    settleHeading(false, token);
    return;
  }
  for (const animation of coverEl?.getAnimations() ?? []) animation.finish();
  if (before === "public" && after === "public" && coverEl && !reduced()) {
    const cover = coverEl;
    const from = back ? -100 : 100;
    cover.classList.add("active");
    const timing = { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" as const };
    const covering = cover.animate([{ transform: `translateY(${from}%)` }, { transform: "translateY(0)" }], timing);
    await covering.finished.catch(() => undefined);
    if (token !== generation) return;
    show(next);
    window.scrollTo(0, 0);
    const revealing = cover.animate([{ transform: "translateY(0)" }, { transform: `translateY(${-from}%)` }], timing);
    await revealing.finished.catch(() => undefined);
    covering.cancel();
    revealing.cancel();
    if (token !== generation) return;
    cover.classList.remove("active");
    settleHeading(true, token);
    return;
  }
  show(next);
  window.scrollTo(0, 0);
  if (before === "public" && after === "public" && viewEl) {
    await viewEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" }).finished
      .catch(() => undefined);
  }
  settleHeading(true, token);
}

interface LeaveGuard {
  onAttempt: (href: string, source: HTMLElement | null) => void;
}

let guard: LeaveGuard | null = null;

export function navigate(href: string, options: { replace?: boolean; force?: boolean; source?: HTMLElement | null } = {}): void {
  const url = new URL(href, location.origin);
  if (guard && !options.force && url.pathname !== location.pathname) {
    guard.onAttempt(url.pathname + url.search, options.source ?? null);
    return;
  }
  const index = options.replace ? current.index : current.index + 1;
  const next: Loc = { pathname: url.pathname, search: url.search, index };
  if (options.replace) history.replaceState({ idx: index }, "", url.pathname + url.search);
  else history.pushState({ idx: index }, "", url.pathname + url.search);
  void transition(next, false);
}

window.addEventListener("popstate", () => {
  const next = readLoc();
  void transition(next, next.index < current.index);
});

/** The address the page shows. */
export function useLocation(): Match {
  const loc = useSyncExternalStore(subscribe, () => shown);
  return { pathname: loc.pathname, query: new URLSearchParams(loc.search), params: findPage(loc.pathname)?.params ?? {} };
}

/** While `active`, in-app navigation away calls `onAttempt` with the target and the activating link. */
export function useLeaveGuard(active: boolean, onAttempt: (href: string, source: HTMLElement | null) => void): void {
  const handler = useRef(onAttempt);
  handler.current = onAttempt;
  useEffect(() => {
    if (!active) return undefined;
    const own: LeaveGuard = { onAttempt: (href, source) => handler.current(href, source) };
    guard = own;
    return () => {
      if (guard === own) guard = null;
    };
  }, [active]);
}

export function Link({ href, onClick, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(href, { source: event.currentTarget });
  };
  return (
    <a href={href} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

/** Renders the shown page inside its layout, plus the route cover panel. */
export function RouterView({ layout, notFound }: {
  layout: (page: PageDef, content: ReactNode) => ReactNode;
  notFound: () => ReactNode;
}) {
  const match = useLocation();
  const found = findPage(match.pathname);
  useEffect(() => settleHeading(false, generation), []);
  return (
    <>
      <div ref={(el) => void (viewEl = el)} className="route-view">
        {found ? layout(found.page, found.page.render({ ...match, params: found.params })) : notFound()}
      </div>
      <div ref={(el) => void (coverEl = el)} className="route-cover" aria-hidden="true" />
    </>
  );
}
