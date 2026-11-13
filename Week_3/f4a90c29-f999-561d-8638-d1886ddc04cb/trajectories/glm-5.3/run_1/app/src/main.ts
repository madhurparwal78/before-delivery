// main.ts — the entry point: routes, the shared chrome and the screens.

import { api } from "./api";
import { state } from "./state";
import { h, heading, button, statusLine } from "./dom";
import { renderCalendar } from "./calendar";
import { renderEvent } from "./event";
import { renderSignIn, renderLanding } from "./public";
import { renderSearch } from "./search";
import { renderTrash } from "./trash";
import { renderSharing } from "./sharing";
import { renderZoneRules } from "./zonerules";
import { renderSettings } from "./settings";
import { renderFind } from "./find";
import { renderPrints } from "./prints";
import { renderSharePage } from "./share";

export interface Route {
  path: string;
  query: URLSearchParams;
}

function parseRoute(): Route {
  const u = new URL(location.href);
  return { path: u.pathname, query: u.searchParams };
}

export function navigate(path: string, query: Record<string, string | undefined>): void {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  const qs = params.toString();
  const url = `${path}${qs ? `?${qs}` : ""}`;
  history.pushState(null, "", url);
  route();
}

let navEl: HTMLElement | null = null;

function renderNav(): HTMLElement {
  const links: { label: string; to: string }[] = [];
  const me = state.me;
  if (me) {
    links.push({ label: "Calendar", to: "/calendar" });
    if (me.role !== "guest") {
      links.push({ label: "Find a time", to: "/find" });
      links.push({ label: "Search", to: "/search" });
      links.push({ label: "Trash", to: "/trash" });
      links.push({ label: "Zone rules", to: "/zone-rules" });
      links.push({ label: "Sharing", to: "/sharing" });
    }
    if (me.role === "office_manager") links.push({ label: "Prints", to: "/prints" });
    links.push({ label: "Settings", to: "/settings" });
  }
  const nav = h("nav", { "aria-label": "Main", class: "main-nav" });
  for (const l of links) {
    nav.appendChild(
      h("a", { href: l.to, class: "nav-link", onclick: (e: Event) => { e.preventDefault(); history.pushState(null, "", l.to); route(); } }, l.label)
    );
  }
  if (me) {
    nav.appendChild(
      button("Sign out", { class: "btn ghost", onclick: async () => {
        await api.signOut();
        state.me = null;
        history.pushState(null, "", "/signin");
        route();
      } }, "Sign out")
    );
  }
  return nav;
}

export async function route(): Promise<void> {
  const { path } = parseRoute();
  const app = document.getElementById("app")!;
  app.replaceChildren();
  navEl?.replaceWith(navEl = renderNav());

  if (path === "/" ) {
    renderLanding(app);
    return;
  }
  if (path === "/signin") {
    renderSignIn(app);
    return;
  }
  if (path.startsWith("/share/")) {
    await renderSharePage(app, path.slice("/share/".length));
    return;
  }
  // everything else needs a session
  if (!state.me) {
    try {
      await state.load();
      await state.refreshNow();
    } catch {
      history.pushState(null, "", "/signin");
      renderSignIn(app);
      return;
    }
  }
  if (!state.socket) {
    state.openLive();
  }
  navEl = renderNav();
  document.body.querySelector(".main-nav")?.replaceWith(navEl);

  const q = parseRoute().query;
  if (path === "/calendar") {
    renderCalendar(app, q);
    return;
  }
  if (path.startsWith("/events/")) {
    await renderEvent(app, path.slice("/events/".length), q.get("occurrence") ?? "");
    return;
  }
  if (path === "/find") {
    renderFind(app);
    return;
  }
  if (path === "/search") {
    renderSearch(app, q.get("q") ?? "");
    return;
  }
  if (path === "/trash") {
    renderTrash(app);
    return;
  }
  if (path === "/sharing") {
    renderSharing(app);
    return;
  }
  if (path === "/zone-rules") {
    renderZoneRules(app);
    return;
  }
  if (path === "/settings") {
    renderSettings(app);
    return;
  }
  if (path === "/prints") {
    renderPrints(app);
    return;
  }
  // unknown address
  app.append(
    h("main", { class: "column" },
      heading(1, "Nothing is scheduled at this address."),
      h("a", { href: "/calendar", class: "text-link" }, "Back to the calendar")
    )
  );
}

export function start(): void {
  const app = document.getElementById("app")!;
  const status = document.getElementById("wren-status");
  if (status) status.textContent = "Wren status";
  navEl = renderNav();
  document.body.insertBefore(navEl, app);
  window.addEventListener("popstate", () => void route());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.querySelector("dialog[open]") && location.pathname.startsWith("/events/")) {
      history.pushState(null, "", "/calendar");
      void route();
      return;
    }
    if (location.pathname === "/calendar") {
      import("./keyboard").then(({ handleGlobalKey }) => handleGlobalKey(e));
    }
  });
  // the now line follows the server clock: re-read it on load, on each
  // WebSocket open, when the tab returns and at least every 30 seconds
  const tick = () => void state.refreshNow();
  tick();
  window.setInterval(tick, 30000);
  document.addEventListener("visibilitychange", tick);
  state.liveHandlers.push(() => tick());
  void route();
}

// every async result announces its published copy in the status region
export function announce(text: string): void {
  statusLine(text);
}

void start();
