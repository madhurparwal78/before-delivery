// The client router: paths map to page builders. Unknown paths and pens the
// viewer may not see land on the not-found page.
import { notFoundPage } from "../pages/notfound.js";

export type PageBuilder = (root: HTMLElement, params: URLSearchParams, path: string) => Promise<void>;

interface Route {
  pattern: RegExp;
  build: () => Promise<PageBuilder>;
  names: string[];
}

const routes: Route[] = [
  { pattern: /^\/$/, build: () => import("../pages/landing.js").then((m) => m.landingPage), names: [] },
  { pattern: /^\/signup$/, build: () => import("../pages/signup.js").then((m) => m.signupPage), names: [] },
  { pattern: /^\/signin$/, build: () => import("../pages/signin.js").then((m) => m.signinPage), names: [] },
  { pattern: /^\/verify$/, build: () => import("../pages/verify.js").then((m) => m.verifyPage), names: [] },
  { pattern: /^\/dashboard$/, build: () => import("../pages/dashboard.js").then((m) => m.dashboardPage), names: [] },
  { pattern: /^\/pen\/([a-z0-9]{10})$/, build: () => import("../pages/editor.js").then((m) => m.editorPage), names: ["pen"] },
  { pattern: /^\/pen\/([a-z0-9]{10})\/history$/, build: () => import("../pages/history.js").then((m) => m.historyPage), names: ["pen"] },
  { pattern: /^\/explore$/, build: () => import("../pages/explore.js").then((m) => m.explorePage), names: [] },
  { pattern: /^\/collections$/, build: () => import("../pages/collections.js").then((m) => m.collectionsPage), names: [] },
  { pattern: /^\/collections\/([a-z0-9]{10})$/, build: () => import("../pages/collections.js").then((m) => m.collectionPage), names: ["collection"] },
  { pattern: /^\/shelf$/, build: () => import("../pages/shelf.js").then((m) => m.shelfPage), names: [] },
  { pattern: /^\/embed\/([a-z0-9]{10})$/, build: () => import("../pages/embed.js").then((m) => m.embedPage), names: ["pen"] },
];

export async function renderRoute(root: HTMLElement, path: string, search: URLSearchParams): Promise<void> {
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (match) {
      const params = new URLSearchParams(search);
      route.names.forEach((name, i) => params.set(name, match[i + 1] ?? ""));
      const build = await route.build() as (root: HTMLElement, ...rest: unknown[]) => Promise<void>;
      await build(root, params, path);
      return;
    }
  }
  await notFoundPage(root, new URLSearchParams(), path);
}

export function startRouter(root: HTMLElement): void {
  const go = () => {
    void renderRoute(root, location.pathname, new URLSearchParams(location.search)).catch(async () => {
      await notFoundPage(root, new URLSearchParams(), location.pathname);
    });
  };
  window.addEventListener("popstate", go);
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof HTMLAnchorElement)) return;
    const a = e.target;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const href = a.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    e.preventDefault();
    history.pushState(null, "", href);
    go();
  });
  go();
}
