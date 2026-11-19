// The console shell: a 240 px rail from 1200 px up, a top bar with the Navigation dialog below it,
// the session search, and the Service status region at the top of the workspace.
import type { Me, Session } from "../shared/types";
import { allows } from "../shared/permissions";
import { api, onOutageChange, outageBanners } from "./api";
import { openDialog } from "./dialog";
import { h, icon, replace, say } from "./dom";
import { ROLE_LABEL, STATE_LABEL } from "./format";

export interface Shell {
  root: HTMLElement;
  page: HTMLElement;
  update(me: Me, path: string): void;
  closeNavigation(): void;
}

const WIDE = matchMedia("(min-width: 1200px)");

export function createShell(onSignOut: () => void): Shell {
  const links = {
    projects: h("a", { href: "/console/projects" }, "Projects"),
    usage: h("a", { href: "/console/usage" }, "Usage"),
    members: h("a", { href: "/console/org/members" }, "Members"),
    plan: h("a", { href: "/console/org/plan" }, "Plan"),
  };
  const items = Object.fromEntries(Object.entries(links).map(([key, link]) => [key, h("li", {}, link)])) as Record<keyof typeof links, HTMLLIElement>;
  const nav = h("nav", { "aria-label": "Console", class: "console-nav" }, h("ul", {}, ...Object.values(items)));

  const searchInput = h("input", { type: "search", id: "session-search", autocomplete: "off", spellcheck: "false", placeholder: "Label or transcript words" });
  const searchStatus = h("p", { role: "status", "aria-label": "Search results", class: "search-status num" });
  const results = h("ul", { "aria-label": "Session results", class: "search-results" });
  const search = h("div", { class: "search" }, h("label", { for: "session-search", class: "label" }, "Search sessions"), searchInput, searchStatus, results);

  const who = h("p", { class: "who" });
  const signOut = h("button", { type: "button", class: "ghost", onclick: onSignOut }, icon("out"), "Sign out");
  const navContent = h("div", { class: "nav-content" }, nav, search, h("div", { class: "rail-foot" }, who, signOut));

  const rail = h("aside", { class: "rail" }, h("a", { href: "/console/projects", class: "wordmark" }, wordmark()));
  const closeButton = h("button", { type: "button", class: "icon-button", "aria-label": "Close navigation" }, icon("close"));
  const dialog = h("dialog", { class: "nav-dialog", "aria-label": "Navigation" }, h("div", { class: "nav-dialog-head" }, h("span", { class: "wordmark" }, wordmark()), closeButton));
  const menu = h("button", { type: "button", class: "menu-button", "aria-haspopup": "dialog" }, icon("menu"), "Menu");
  const topbar = h("header", { class: "topbar" }, h("a", { href: "/console/projects", class: "wordmark" }, wordmark()), menu);
  const service = h("div", { role: "status", "aria-label": "Service status", class: "service-status" });
  const page = h("div", { class: "page" });
  const workspace = h("main", { class: "workspace", id: "workspace" }, service, page);
  const root = h("div", { class: "shell" }, rail, topbar, workspace, dialog);

  let navigation: (() => void) | null = null;
  const place = () => {
    navigation?.();
    (WIDE.matches ? rail : dialog).appendChild(navContent);
  };
  WIDE.addEventListener("change", place);
  place();
  menu.addEventListener("click", () => {
    navigation = openDialog(dialog, menu, { onClose: () => (navigation = null) });
  });
  closeButton.addEventListener("click", () => navigation?.());

  const renderService = () => replace(service, ...outageBanners().map((text) => h("p", { class: "banner caution" }, icon("alert"), h("span", {}, text))));
  onOutageChange(renderService);
  renderService();

  // Search queries the server 250 ms after the last keystroke and updates in place.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;
  searchInput.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = searchInput.value;
      const ticket = ++latest;
      if (!q.trim()) {
        say(searchStatus, "");
        results.replaceChildren();
        return;
      }
      const found = await api<{ total: number; sessions: Session[] }>("GET", `/api/sessions/search?q=${encodeURIComponent(q)}`);
      // Only the reply for the box's current text may update the list and the status.
      if (ticket !== latest || q !== searchInput.value || !found.ok) return;
      say(searchStatus, found.data.total === 1 ? "1 session found." : `${found.data.total} sessions found.`);
      replace(
        results,
        ...found.data.sessions.map((s) =>
          h("li", {}, h("a", { href: `/console/sessions/${s.id}` }, h("span", { class: "result-label" }, s.label), h("span", { class: "result-meta num" }, STATE_LABEL[s.state]))),
        ),
      );
    }, 250);
  });

  return {
    root,
    page,
    closeNavigation: () => navigation?.(),
    update(me, path) {
      items.usage.hidden = !allows(me.user.role, "usage.read");
      items.members.hidden = !allows(me.user.role, "admin");
      items.plan.hidden = !allows(me.user.role, "admin");
      search.hidden = !allows(me.user.role, "sessions.read");
      for (const link of Object.values(links)) {
        const href = link.getAttribute("href")!;
        if (path === href || path.startsWith(`${href}/`) || (href === "/console/projects" && path.startsWith("/console/sessions/"))) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
      say(who, `${me.user.name} · ${ROLE_LABEL[me.user.role]}`);
    },
  };
}

export function wordmark(): HTMLElement {
  return h("span", { class: "wordmark-inner" }, h("span", { class: "wordmark-glyph", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i")), h("span", {}, "Lowfield"), h("span", { class: "wordmark-sub" }, "Console"));
}
