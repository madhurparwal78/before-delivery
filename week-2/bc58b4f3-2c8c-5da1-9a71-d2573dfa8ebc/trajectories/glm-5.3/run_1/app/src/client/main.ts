// Teamseat client entry: sign-in, top bar, role-based routing.
import { api, el } from "./lib";
import type { MeUser, SessionResponse } from "./types";
import { renderRequests } from "./screens/requests";
import { renderBoard } from "./screens/board";
import { renderOffers } from "./screens/offers";
import { renderMySeats } from "./screens/myseats";
import { renderBilling } from "./screens/billing";
import { renderOrg } from "./screens/org";
import { renderSignIn } from "./screens/signin";

export interface App {
  me: MeUser;
  main: HTMLElement;
  rerender: () => void;
  navigate: (path: string) => void;
}

const ROLE_PATHS: Record<string, { landing: string; paths: string[] }> = {
  scheduler: { landing: "/requests", paths: ["/requests"] },
  org_admin: { landing: "/requests", paths: ["/requests", "/org"] },
  dispatcher: { landing: "/board", paths: ["/board"] },
  billing_lead: { landing: "/billing", paths: ["/billing"] },
  interpreter: { landing: "/offers", paths: ["/offers", "/my-seats"] },
};

const SCREENS: Record<string, (app: App) => void> = {
  "/requests": renderRequests,
  "/board": renderBoard,
  "/offers": renderOffers,
  "/my-seats": renderMySeats,
  "/billing": renderBilling,
  "/org": renderOrg,
};

const NAV_LABELS: Record<string, string> = {
  "/requests": "Requests",
  "/board": "Board",
  "/offers": "Open seats",
  "/my-seats": "My seats",
  "/billing": "Billing",
  "/org": "Schedulers",
};

const ROLE_LABELS: Record<string, string> = {
  scheduler: "Clinic scheduler",
  org_admin: "Org admin",
  dispatcher: "Dispatcher",
  billing_lead: "Billing lead",
  interpreter: "Interpreter",
};

let me: MeUser | null = null;

export function navigate(path: string): void {
  history.pushState(null, "", path);
  route();
}

window.addEventListener("popstate", () => route());

function topbar(): HTMLElement {
  const role = me!.role;
  const allowed = ROLE_PATHS[role] ?? { landing: "/", paths: [] };
  const nav = el("nav", { "aria-label": "Main", class: "nav" });
  for (const path of allowed.paths) {
    const link = el("a", { href: path, text: NAV_LABELS[path] });
    if (location.pathname === path) link.setAttribute("aria-current", "page");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(path);
    });
    nav.append(link);
  }
  return el("div", { class: "topbar" },
    el("div", { class: "topbar-inner" },
      el("span", { class: "brand", text: "Teamseat" }),
      el("span", { class: "who" },
        el("span", { class: "who-name", text: me!.name }),
        el("span", { text: ROLE_LABELS[role] ?? role }),
      ),
      nav,
      el("span", { class: "tz-note", text: "All times Central (Chicago)" }),
      el("span", { class: "spacer" }),
      el("button", {
        class: "btn btn-quiet",
        text: "Sign out",
        onclick: async () => {
          await api("DELETE", "/api/session");
          me = null;
          route();
        },
      }),
    ),
  );
}

function route(): void {
  const appRoot = document.getElementById("app");
  if (!appRoot) return;
  appRoot.replaceChildren();

  const path = location.pathname.replace(/\/+$/, "") || "/";

  if (!me) {
    if (path !== "/") history.replaceState(null, "", "/");
    renderSignIn(appRoot, (user) => {
      me = user;
      const landing = ROLE_PATHS[me.role]?.landing ?? "/";
      history.replaceState(null, "", landing);
      route();
    });
    return;
  }

  const main = el("main", { class: "sheet", id: "main" });
  const app: App = { me, main, rerender: () => route(), navigate };
  appRoot.replaceChildren(topbar(), main);

  const allowed = ROLE_PATHS[me.role] ?? { landing: "/", paths: [] };
  const target = allowed.paths.includes(path) ? path : allowed.landing;
  if (target !== location.pathname) history.replaceState(null, "", target);
  main.replaceChildren();
  SCREENS[target]?.(app);
}

async function boot(): Promise<void> {
  try {
    const res = await api<SessionResponse>("GET", "/api/me");
    me = res.user;
  } catch {
    me = null;
  }
  route();
}

void boot();
