import { acceptedNext, sessionlessLanding } from "../shared/rules";
import { me } from "./session";

// What a page is opened with; `signal` aborts when the page is left, so pages hang their cleanup on it.
export interface PageContext {
  readonly url: URL;
  readonly state: unknown;
  readonly signal: AbortSignal;
}

type Page = (ctx: PageContext) => void | Promise<void>;

interface Route {
  readonly pattern: RegExp;
  readonly load: () => Promise<Page>;
  readonly session: "required" | "optional" | "none";
}

const routes: Route[] = [
  { pattern: /^\/$/, session: "none", load: async () => (await import("./pages/start")).startPage },
  { pattern: /^\/garage$/, session: "required", load: async () => (await import("./pages/garage")).garagePage },
  { pattern: /^\/garage\/dealer$/, session: "required", load: async () => (await import("./pages/dealer")).dealerPage },
  { pattern: /^\/garage\/coins$/, session: "required", load: async () => (await import("./pages/coins")).coinsPage },
  { pattern: /^\/race$/, session: "required", load: async () => (await import("./pages/race")).racePage },
  { pattern: /^\/runs\/[^/]+$/, session: "required", load: async () => (await import("./pages/results")).resultsPage },
  { pattern: /^\/boards$/, session: "required", load: async () => (await import("./pages/boards")).boardsPage },
  { pattern: /^\/championship$/, session: "required", load: async () => (await import("./pages/championship")).championshipPage },
  { pattern: /^\/lobby\/[^/]+$/, session: "required", load: async () => (await import("./pages/lobby")).lobbyPage },
  { pattern: /^\/sign-in(\/[^/]+)?$/, session: "optional", load: async () => (await import("./pages/signin")).signinPage },
];

let controller: AbortController | null = null;
let generation = 0;

async function render(): Promise<void> {
  const mine = ++generation;
  controller?.abort();
  const url = new URL(location.href);
  const route = routes.find((entry) => entry.pattern.test(url.pathname));
  if (!route) return;
  const player = me();
  if (route.session === "none" && player) {
    navigate(acceptedNext(url.searchParams.get("next")) ?? "/garage", { replace: true });
    return;
  }
  if (route.session === "required" && !player) {
    location.replace(sessionlessLanding(url.pathname));
    return;
  }
  const page = await route.load();
  if (mine !== generation) return;
  controller = new AbortController();
  await page({
    url,
    state: history.state,
    signal: controller.signal,
  });
}

export function navigate(path: string, options: { replace?: boolean; state?: unknown } = {}): void {
  if (options.replace) history.replaceState(options.state ?? null, "", path);
  else history.pushState(options.state ?? null, "", path);
  void render();
}

export function startRouter(): void {
  window.addEventListener("popstate", () => void render());
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest("a");
    if (!link || link.hasAttribute("download") || link.target) return;
    const href = link.getAttribute("href") ?? "";
    if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/v1/")) return;
    event.preventDefault();
    navigate(href, { state: link.dataset.state ? JSON.parse(link.dataset.state) : null });
  });
  void render();
}
