/** The router and the app shell. */

import { api, ApiError } from "./lib/api.js";
import { h, clear } from "./lib/dom.js";
import { setSound } from "./lib/sound.js";

export interface Route {
  pattern: RegExp;
  screen: (params: string[], render: Render) => Promise<void> | void;
  open?: boolean;
}

export interface Render {
  main: HTMLElement;
  slug?: string;
}

export interface Me {
  user: { handle: string; display_name: string };
  servers: ServerObject[];
  preferences: { sound: boolean };
}

export interface ServerObject {
  id: string;
  slug: string;
  name: string;
  owner: string;
  role: "owner" | "member";
  status: string;
  status_word: string;
  suspends_at: string | null;
  suspends_at_label: string | null;
  time_zone: string;
  plan: string;
  season: number;
  worlds: { slug: string; name: string }[];
  member_count: number;
  character_count: number;
}

let me: Me | null = null;

export async function loadMe(): Promise<Me | null> {
  const res = await fetch("/api/me", { headers: { Accept: "application/json" } });
  if (res.status === 401) {
    me = null;
    return null;
  }
  me = (await res.json()) as Me;
  setSound(me.preferences.sound);
  return me;
}

export function currentMe(): Me | null {
  return me;
}

export const routes: Route[] = [];

export function registerRoute(pattern: string, screen: Route["screen"], open = false): void {
  routes.push({ pattern: new RegExp(`^${pattern}$`), screen, open });
}

export interface Shell {
  topbar: HTMLElement | null;
  notice: HTMLElement | null;
  main: HTMLElement;
  slug: string | null;
  route: string;
}

let shell: Shell | null = null;

export async function navigate(pathname: string, replace = false): Promise<void> {
  if (replace) {
    history.replaceState(null, "", pathname);
  } else {
    history.pushState(null, "", pathname);
  }
  await render();
}

function slugOf(pathname: string): string | null {
  const match = /^\/s\/([^/]+)/.exec(pathname);
  return match === null ? null : match[1]!;
}

export async function render(): Promise<void> {
  if (shell === null) return;
  const pathname = location.pathname;
  const slug = slugOf(pathname);
  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (match === null) continue;
    if (!route.open && me === null) {
      await navigate(`/sign-in?next=${encodeURIComponent(pathname)}`, true);
      return;
    }
    shell.slug = slug;
    shell.route = pathname;
    clear(shell.main);
    try {
      await route.screen(match.slice(1), { main: shell.main, slug: slug ?? undefined });
    } catch (err) {
      // An owner-only route opened by a non-owner renders the not-found page.
      if (err instanceof ApiError && err.status === 403) {
        await renderNotFound(shell.main);
        return;
      }
      throw err;
    }
    return;
  }
  await renderNotFound(shell.main);
}

export async function renderNotFound(main: HTMLElement): Promise<void> {
  clear(main);
  main.append(
    h("div", { class: "card", style: "margin: 40px auto; max-width: 420px; text-align: center" }, h("h1", {}, "We couldn't find that page."))
  );
}

export async function boot(root: HTMLElement): Promise<void> {
  const topbar = h("header", { class: "topbar" });
  const notice = h("div", { role: "region", "aria-label": "Server notice" });
  notice.style.display = "none";
  const main = h("main", { class: "page" });
  root.append(topbar, notice, main);
  shell = { topbar, notice, main, slug: null, route: location.pathname };

  window.addEventListener("popstate", () => {
    void render();
  });

  await loadMe();
  await renderTopbar();
  await render();
}

export async function refreshShell(): Promise<void> {
  await loadMe();
  await renderTopbar();
  await render();
}

export async function signOut(): Promise<void> {
  await fetch("/api/session", { method: "DELETE" });
  me = null;
  await navigate("/sign-in", true);
  await renderTopbar();
}

export async function renderTopbar(): Promise<void> {
  if (shell === null || shell.topbar === null) return;
  const bar = shell.topbar;
  clear(bar);
  const signedIn = me !== null;
  const onServer = shell.slug !== null;
  const localShell = shell;
  const server = me?.servers.find((s) => s.slug === localShell.slug) ?? null;
  const playHref = onServer && server !== null && server.worlds.length > 0 ? `/s/${server.slug}/w/${server.worlds[0]!.slug}` : "/servers";
  const gamesHref = onServer ? `/s/${localShell.slug}/games` : "/servers";
  bar.append(
    h("span", { class: "wordmark" }, "Plotwright"),
    h(
      "nav",
      { "aria-label": "Main" },
      h("a", { href: playHref }, "Play"),
      h("a", { href: gamesHref }, "Games"),
      h("a", { href: "/help" }, "Help")
    )
  );
  if (server !== null) {
    const links: HTMLElement[] = [
      h("a", { href: `/s/${server.slug}/roster` }, "Roster"),
      h("a", { href: `/s/${server.slug}/coins` }, "Coins"),
      h("a", { href: `/s/${server.slug}/leaderboards` }, "Leaderboards"),
      h("button", { onclick: () => window.dispatchEvent(new CustomEvent("open-friends")) }, "Friends"),
    ];
    if (server.role === "owner") {
      links.push(h("a", { href: `/s/${server.slug}/billing` }, "Billing"));
      links.push(h("a", { href: `/s/${server.slug}/admin` }, "Server admin"));
    }
    bar.append(...links);
  }
  bar.append(h("span", { class: "spacer" }));
  if (signedIn && server !== null && (localShell.route.startsWith(`/s/${server.slug}/w/`) || localShell.route.startsWith(`/s/${server.slug}/roster`))) {
    const picker = h(
      "select",
      { "aria-label": "Character", onchange: (e: Event) => window.dispatchEvent(new CustomEvent("pick-character", { detail: (e.target as HTMLSelectElement).value })) },
      h("option", { value: "" }, "Character")
    );
    bar.append(picker);
    const chars = await api<{ characters: { id: string; name: string }[] }>(`/api/servers/${server.slug}/characters?mine=true`);
    for (const character of chars.data.characters) {
      picker.append(h("option", { value: character.id }, character.name));
    }
  }
  if (signedIn) {
    bar.append(h("button", { onclick: () => void signOut() }, "Sign out"));
  }
  await renderNotice();
}

export async function renderNotice(): Promise<void> {
  if (shell === null || shell.notice === null) return;
  const localShell = shell;
  const server = me?.servers.find((s) => s.slug === localShell.slug) ?? null;
  if (server === null || (server.status !== "past_due" && server.status !== "suspended")) {
    shell.notice.style.display = "none";
    clear(shell.notice);
    return;
  }
  clear(shell.notice);
  const text =
    server.status === "past_due"
      ? `An invoice is overdue. This server will be suspended at ${server.suspends_at_label ?? "the grace deadline"} unless the payment is approved.`
      : "This server is suspended because an invoice is unpaid. Play and saves are paused until the billing provider confirms payment. Your worlds can still be exported.";
  shell.notice.className = `server-notice ${server.status}`;
  shell.notice.style.display = "block";
  shell.notice.append(text);
}
