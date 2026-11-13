// The browser entry: shell, navigation, screen slide and routes.

import { api, type ServicesStatus } from "./api.js";
import { COPY } from "./copy.js";
import { el, text, bindGlobalStatuses, renderServiceNotices, startStatusPolling, prefersReducedMotion } from "./dom.js";
import { LandingScreen } from "./landing.js";
import { LibraryScreen } from "./library.js";
import { CaptureScreen } from "./capture.js";
import { FactsScreen } from "./facts.js";
import { ReelsScreen, ReelScreen } from "./reels.js";
import { TrashScreen } from "./trash.js";
import { SettingsScreen } from "./settings.js";

type Route =
  | { kind: "landing" }
  | { kind: "library" }
  | { kind: "capture" }
  | { kind: "facts"; id: string }
  | { kind: "reels" }
  | { kind: "reel"; id: string; stop?: number }
  | { kind: "trash" }
  | { kind: "settings" }
  | { kind: "unknown" };
const NAV_ORDER = ["library", "capture", "reels", "trash", "settings"] as const;

function parseRoute(path: string, search: string): Route {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { kind: "landing" };
  if (parts[0] === "library") return { kind: "library" };
  if (parts[0] === "capture") return { kind: "capture" };
  if (parts[0] === "references" && parts[1]) return { kind: "facts", id: parts[1] };
  if (parts[0] === "reels" && parts[1]) {
    const stopParam = new URLSearchParams(search).get("stop");
    const stop = stopParam !== null && /^\d+$/.test(stopParam) ? Number(stopParam) : undefined;
    return { kind: "reel", id: parts[1], stop };
  }
  if (parts[0] === "reels") return { kind: "reels" };
  if (parts[0] === "trash") return { kind: "trash" };
  if (parts[0] === "settings") return { kind: "settings" };
  return { kind: "unknown" };
}

export interface ScreenContext {
  services: ServicesStatus;
  field: HTMLElement;
  textCol: HTMLElement;
  main: HTMLElement;
  navigate: (path: string) => void;
}

let services: ServicesStatus = { search: "up", storage: "up", printing: "up" };

const root = document.getElementById("root")!;
const shell = el("div", { class: "app-shell" });
const textCol = el("div", { class: "text-col" });
const field = el("div", { class: "field" });
shell.append(field, textCol);
root.append(shell);
bindGlobalStatuses(root);

function navIndex(route: Route): number {
  switch (route.kind) {
    case "library": return 0;
    case "capture": return 1;
    case "reels": case "reel": return 2;
    case "trash": return 3;
    case "settings": return 4;
    case "facts": return 0;
    default: return -1;
  }
}

function buildNav(route: Route): void {
  textCol.textContent = "";
  if (route.kind === "landing") {
    const mark = el("a", { href: "/", class: "wordmark" });
    mark.textContent = "Stowdeck";
    textCol.append(mark);
    return;
  }
  const nav = el("nav", { "aria-label": "Deck" });
  for (const [i, name] of NAV_ORDER.entries()) {
    const a = el("a", { href: `/${name}` });
    a.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    if (navIndex(route) === i) a.setAttribute("aria-current", "page");
    nav.append(a);
  }
  textCol.append(nav);
}

function buildMain(): HTMLElement {
  const main = el("main");
  textCol.append(main);
  return main;
}

// Screen slide: a link in the navigation slides the new main in from the side of
// travel; a screen opened by its address appears without a slide.
let lastNavIndex = -1;
let addressNavigation = false;

function slideMain(main: HTMLElement, route: Route): void {
  if (addressNavigation || prefersReducedMotion()) {
    addressNavigation = false;
    return;
  }
  const target = navIndex(route);
  if (target < 0 || lastNavIndex < 0) return;
  main.classList.add(target > lastNavIndex ? "screen-enter-right" : "screen-enter-left");
  window.setTimeout(() => main.classList.remove("screen-enter-right", "screen-enter-left"), 240);
}

function render(): void {
  const route = parseRoute(location.pathname, location.search);
  buildNav(route);
  const main = buildMain();
  slideMain(main, route);
  lastNavIndex = navIndex(route);
  field.textContent = "";

  const ctx: ScreenContext = { services, field, textCol, main, navigate: go };

  switch (route.kind) {
    case "landing": new LandingScreen(ctx); return;
    case "library": new LibraryScreen(ctx); return;
    case "capture": new CaptureScreen(ctx); return;
    case "facts": new FactsScreen(ctx, route.id); return;
    case "reels": new ReelsScreen(ctx); return;
    case "reel": new ReelScreen(ctx, route.id, route.stop); return;
    case "trash": new TrashScreen(ctx); return;
    case "settings": new SettingsScreen(ctx); return;
    case "unknown": {
      main.append(text("p", COPY.unknownReference));
      return;
    }
  }
}

function go(path: string): void {
  addressNavigation = false;
  history.pushState({}, "", path);
  render();
}

window.addEventListener("popstate", () => { addressNavigation = true; render(); });

document.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest("a");
  if (!target) return;
  const href = target.getAttribute("href") ?? "";
  if (!href.startsWith("/")) return;
  e.preventDefault();
  addressNavigation = false;
  history.pushState({}, "", href);
  render();
});

startStatusPolling((s) => {
  services = s;
  renderServiceNotices(s);
});

addressNavigation = true;
render();
