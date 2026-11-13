import { app, loadMe } from "./app";
import { byId, clear } from "./dom";
import { loader } from "./ui/shell";

/** History-API router. Each page mounts into #view and may return a cleanup. */

export interface PageContext {
  root: HTMLElement;
  params: string[];
  query: URLSearchParams;
}
export type Cleanup = (() => void) | void;
export type Mount = (context: PageContext) => Promise<Cleanup> | Cleanup;

const routes: { pattern: RegExp; mount: () => Promise<{ default: Mount }>; screen: string }[] = [];
let cleanup: Cleanup;
let navigation = 0;

export function route(pattern: RegExp, screen: string, mount: () => Promise<{ default: Mount }>): void {
  routes.push({ pattern, mount, screen });
}

export function go(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  void render();
}

async function render(): Promise<void> {
  const ticket = ++navigation;
  const url = new URL(location.href);
  if (typeof cleanup === "function") cleanup();
  cleanup = undefined;
  const root = byId("view");
  clear(root);
  root.append(loader());
  document.body.dataset.screen = "loading";
  if (app.me === null && !app.outage) await loadMe();
  if (ticket !== navigation) return;
  let matched = routes.find((r) => r.pattern.test(url.pathname));
  if (app.me && !app.me.chosen && matched && matched.screen !== "welcome" && matched.screen !== "denied") {
    history.replaceState(null, "", "/welcome");
    matched = routes.find((r) => r.screen === "welcome");
  }
  if (!matched) matched = routes.find((r) => r.screen === "denied");
  if (!matched) return;
  const params = (matched.pattern.exec(url.pathname) ?? []).slice(1).map((p) => decodeURIComponent(p));
  const module = await matched.mount();
  if (ticket !== navigation) return;
  document.body.dataset.screen = matched.screen;
  const result = await module.default({ root, params, query: url.searchParams });
  if (ticket !== navigation) {
    if (typeof result === "function") result();
    return;
  }
  cleanup = result;
  window.scrollTo(0, 0);
}

export function startRouter(): void {
  window.addEventListener("popstate", () => void render());
  void render();
}
