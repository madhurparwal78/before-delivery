// The client entry: routing, the signed-in frame, the session-end band, the 5-second refresh.

import { announce, api, focusHeading, qs } from "./api.js";
import { UI } from "./copy.js";

export interface SessionInfo {
  assessor: { id: string; name: string; email: string };
  endsAt: string;
}

export interface RouteCtx {
  session: SessionInfo | null;
  params: URLSearchParams;
  main: HTMLElement;
  refresh: () => void;
}

export type Screen = (ctx: RouteCtx) => void | (() => void);

interface RouteDef {
  match: RegExp;
  signedIn: boolean;
  screen: Screen;
}

const routes: RouteDef[] = [];

export function route(pattern: string, signedIn: boolean, screen: Screen): void {
  routes.push({ match: new RegExp(`^${pattern}$`), signedIn, screen });
}

let currentCleanup: (() => void) | undefined;
let refreshTimer: number | null = null;

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  void render();
}

export async function readSession(): Promise<SessionInfo | null> {
  try {
    return await api<SessionInfo>("/api/session");
  } catch {
    return null;
  }
}

let sessionEndedShown = false;

export function handleSessionEnd(): void {
  if (sessionEndedShown) return;
  sessionEndedShown = true;
  announce(UI.sessionEnded);
  const band = document.createElement("div");
  band.className = "panel session-band";
  band.setAttribute("data-part", "session-band");
  const link = document.createElement("a");
  link.href = `/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`;
  link.textContent = UI.signInAgain;
  band.append(link);
  const main = qs<HTMLElement>("main");
  main.prepend(band);
}

export function clearSessionBand(): void {
  sessionEndedShown = false;
  document.querySelector("[data-part='session-band']")?.remove();
}

async function render(): Promise<void> {
  currentCleanup?.();
  currentCleanup = undefined;
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  clearSessionBand();
  const path = location.pathname;
  const root = qs<HTMLElement>("#root");
  root.textContent = "";
  const main = document.createElement("main");
  main.id = "main";
  const shell = document.createElement("div");
  shell.className = "shell";

  const def = routes.find((r) => r.match.test(path));
  const session = await readSession();
  if (def && def.signedIn && session === null) {
    location.href = `/sign-in?next=${encodeURIComponent(path + location.search)}`;
    return;
  }
  shell.append(buildHeader(path, session));
  const frame = document.createElement("div");
  frame.className = "site-frame";
  if (session) frame.append(buildRail(path));
  frame.append(main);
  shell.append(frame);
  root.append(shell);

  if (!def) {
    const h = document.createElement("h1");
    h.textContent = `We couldn't find that page.`;
    main.append(h);
    document.title = `We couldn't find that page. \u2014 Fio Contado Desk`;
  } else {
    const ctx: RouteCtx = {
      session,
      params: new URLSearchParams(location.search),
      main,
      refresh: () => {
        void render();
      },
    };
    const cleanup = def.screen(ctx);
    if (typeof cleanup === "function") currentCleanup = cleanup;
  }
  focusHeading();
}

function buildHeader(path: string, session: SessionInfo | null): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "top-bar";
  const brand = document.createElement("a");
  brand.className = "brand";
  brand.href = "/";
  brand.textContent = "Fio Contado Desk";
  bar.append(brand);
  const links = document.createElement("nav");
  links.className = "top-links";
  links.setAttribute("aria-label", "Main");
  const add = (label: string, href: string) => {
    const a = document.createElement("a");
    a.className = "nav-link";
    a.href = href;
    a.textContent = label;
    links.append(a);
  };
  if (session) {
    const menuBtn = document.createElement("button");
    menuBtn.id = "menu-button";
    menuBtn.textContent = "Menu";
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-controls", "menu-dialog");
    menuBtn.addEventListener("click", () => openMenu(menuBtn, path));
    links.append(menuBtn);
  } else {
    add("Method", "/method");
    add("Questions", "/questions");
    add("Sign in", "/sign-in");
    const explore = document.createElement("button");
    explore.id = "explore-button";
    explore.textContent = "Explore";
    explore.setAttribute("aria-expanded", "false");
    explore.setAttribute("aria-controls", "mega-menu");
    explore.addEventListener("click", () => openMega(explore));
    links.prepend(explore);
  }
  bar.append(links);
  return bar;
}

function buildRail(path: string): HTMLElement {
  const rail = document.createElement("nav");
  rail.className = "side-rail";
  rail.setAttribute("aria-label", "Desk");
  for (const [label, href] of [
    ["Styles", "/styles"],
    ["Labels", "/labels"],
    ["Requests", "/requests"],
    ["Visits", "/visits"],
    ["Passports", "/passports"],
  ] as const) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    if (path === href) a.setAttribute("aria-current", "page");
    rail.append(a);
  }
  const out = document.createElement("button");
  out.textContent = "Sign out";
  out.addEventListener("click", async () => {
    await api("/api/sign-out", { method: "POST" });
    location.href = "/";
  });
  rail.append(out);
  return rail;
}

async function openMenu(opener: HTMLElement, path: string): Promise<void> {
  const { overlayOpen, overlayClose } = await import("./overlay.js");
  opener.setAttribute("aria-expanded", "true");
  const body = overlayOpen({ label: "Menu", opener });
  body.id = "menu-dialog";
  const list = document.createElement("nav");
  list.setAttribute("aria-label", "Desk");
  const items: [string, string][] = [
    ["Styles", "/styles"],
    ["Labels", "/labels"],
    ["Requests", "/requests"],
    ["Visits", "/visits"],
    ["Passports", "/passports"],
  ];
  for (const [label, href] of items) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    a.className = "rail-link";
    a.addEventListener("click", () => {
      const dlg = body.closest("dialog");
      if (dlg) overlayClose(dlg as HTMLDialogElement, opener);
    });
    list.append(a);
  }
  const out = document.createElement("button");
  out.textContent = "Sign out";
  out.addEventListener("click", async () => {
    await api("/api/sign-out", { method: "POST" });
    location.href = "/";
  });
  body.append(list, out);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(body)) {
      opener.setAttribute("aria-expanded", "false");
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

async function openMega(opener: HTMLElement): Promise<void> {
  const { overlayOpen, overlayClose } = await import("./overlay.js");
  const wide = window.matchMedia("(min-width: 768px)").matches;
  opener.setAttribute("aria-expanded", "true");
  if (wide) {
    const menu = document.createElement("div");
    menu.className = "panel mega-menu";
    menu.setAttribute("role", "navigation");
    menu.setAttribute("aria-label", "Explore");
    menu.style.position = "absolute";
    menu.style.top = "56px";
    menu.style.insetInline = "16px";
    buildMegaTiles(menu, () => menu.remove());
    document.body.append(menu);
    const onDocClick = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const close = () => {
      menu.remove();
      opener.setAttribute("aria-expanded", "false");
      opener.focus();
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return;
  }
  const body = overlayOpen({ label: "Explore", opener, sheet: true });
  const tiles = document.createElement("div");
  tiles.className = "mega-tiles";
  buildMegaTiles(tiles, () => {
    const dlg = body.closest("dialog");
    if (dlg) overlayClose(dlg as HTMLDialogElement, opener);
  });
  body.append(tiles);
}

function buildMegaTiles(container: HTMLElement, go: () => void): void {
  const tiles: [string, string][] = [
    ["The five stages", "/method"],
    ["Six measures", "/method#measures"],
    ["Questions", "/questions"],
    ["Try one garment", "/"],
    ["Sign in", "/sign-in"],
    ["Start a desk", "/sign-up"],
  ];
  for (const [label, href] of tiles) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    a.addEventListener("click", go);
    container.append(a);
  }
}

export function startApp(): void {
  void render();
  window.addEventListener("popstate", () => {
    void render();
  });
  window.addEventListener("scroll", () => {
    const bar = qs<HTMLElement>(".top-bar");
    if (bar) bar.classList.toggle("solid", window.scrollY >= 24);
  });
}
