import { state } from "./i18n.js";
import { ui } from "./boot.js";

export interface Page {
  render(main: HTMLElement, params: URLSearchParams, path: string): Promise<void>;
}

export const routes: { pattern: RegExp; page: () => Promise<{ default: Page }> }[] = [
  { pattern: /^\/$/, page: () => import("./pages/home.js") },
  { pattern: /^\/search$/, page: () => import("./pages/search.js") },
  { pattern: /^\/properties\/([^/]+)$/, page: () => import("./pages/property.js") },
  { pattern: /^\/checkout\/([^/]+)$/, page: () => import("./pages/checkout.js") },
  { pattern: /^\/bookings\/([^/]+)$/, page: () => import("./pages/booking.js") },
  { pattern: /^\/find$/, page: () => import("./pages/find.js") },
  { pattern: /^\/reviews\/([^/]+)$/, page: () => import("./pages/review.js") },
  { pattern: /^\/inbox$/, page: () => import("./pages/inbox.js") },
  { pattern: /^\/account$/, page: () => import("./pages/account.js") },
  { pattern: /^\/signin$/, page: () => import("./pages/signin.js") },
  { pattern: /^\/signup$/, page: () => import("./pages/signup.js") },
  { pattern: /^\/moderation$/, page: () => import("./pages/moderation.js") },
  { pattern: /^\/manage\/([^/]+)\/calendar$/, page: () => import("./pages/calendar.js") },
  { pattern: /^\/manage\/([^/]+)\/reservations$/, page: () => import("./pages/reservations.js") },
  { pattern: /^\/manage\/([^/]+)\/import$/, page: () => import("./pages/import.js") },
  { pattern: /^\/manage\/([^/]+)\/statements$/, page: () => import("./pages/statements.js") }
];

let currentCleanup: (() => void) | null = null;
let renderToken = 0;

export function currentRenderToken(): number {
  return renderToken;
}

export async function renderRoute(path: string): Promise<void> {
  const url = new URL(path, location.href);
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  currentCleanup?.();
  currentCleanup = null;
  renderToken++;
  const myToken = renderToken;
  const found = routes.find((r) => r.pattern.test(url.pathname));
  if (!found) {
    renderNotFound(main);
    return;
  }
  const match = found.pattern.exec(url.pathname);
  const params = new URLSearchParams(url.search);
  if (match) match.slice(1).forEach((v, i) => params.set(`seg${i}`, v));
  const mod = await found.page();
  if (myToken !== renderToken) return;
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === "ar" ? "rtl" : "ltr";
  await mod.default.render(main, params, url.pathname);
}

export function renderNotFound(main: HTMLElement): void {
  main.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const h = document.createElement("p");
  h.className = "huge";
  h.textContent = "";
  const p = document.createElement("p");
  wrap.append(h, p);
  main.appendChild(wrap);
  import("./i18n.js").then(({ t }) => {
    h.textContent = t("empty.results.word");
    p.textContent = t("page.missing");
  });
}

export function setPageTitle(title: string): void {
  document.title = title;
}

export function onCleanup(fn: () => void): void {
  const prev = currentCleanup;
  currentCleanup = () => { fn(); prev?.(); };
}
