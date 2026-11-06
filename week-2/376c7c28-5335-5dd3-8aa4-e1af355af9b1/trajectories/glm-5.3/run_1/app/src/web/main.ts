import { api, setUnauthenticatedHook, type Person } from "./api";
import { h, clear, liveRegion, announce, dialogKeyHandler } from "./ui";
import { renderSignin } from "./screens/signin";
import { renderJoin } from "./screens/join";
import { renderPieces } from "./screens/pieces";
import { renderNewPiece } from "./screens/newpiece";
import { renderPassport } from "./screens/passport";
import { renderCredit } from "./screens/credit";
import { renderIntake } from "./screens/intake";
import { renderPlanner } from "./screens/planner";
import { renderDashboard } from "./screens/dashboard";
import { renderRates } from "./screens/rates";
import { renderMembers } from "./screens/members";
import { renderReports } from "./screens/reports";
import { renderSettings } from "./screens/settings";

export type Me = { person: Person; timeZone: string } | null;
let meState: Me = null;
export function me(): Me {
  return meState;
}
export function setMe(next: Me): void {
  meState = next;
}

export const sessionStatus = liveRegion("Session status");

let currentRefresh: (() => void) | null = null;
export function setRefresh(fn: (() => void) | null): void {
  currentRefresh = fn;
}

export function homeFor(role: string): string {
  if (role === "owner") return "/dashboard";
  if (role === "kiln_tech") return "/intake";
  return "/pieces";
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  void route();
}

type ScreenRenderer = (root: HTMLElement, params: string[]) => void;
type RouteDef = { pattern: RegExp; render: ScreenRenderer; isPublic?: boolean; role?: "member" | "staff" | "owner" };

const routes: RouteDef[] = [
  { pattern: /^\/signin$/, render: (root) => renderSignin(root), isPublic: true },
  { pattern: /^\/invite\/(.+)$/, render: (root, params) => renderJoin(root, params[0]), isPublic: true },
  { pattern: /^\/pieces\/new$/, render: (root) => renderNewPiece(root), role: "member" },
  { pattern: /^\/pieces\/([^/]+)$/, render: (root, params) => renderPassport(root, params[0]) },
  { pattern: /^\/pieces$/, render: (root) => renderPieces(root), role: "member" },
  { pattern: /^\/credit$/, render: (root) => renderCredit(root), role: "member" },
  { pattern: /^\/intake$/, render: (root) => renderIntake(root), role: "staff" },
  { pattern: /^\/planner$/, render: (root) => renderPlanner(root), role: "staff" },
  { pattern: /^\/dashboard$/, render: (root) => renderDashboard(root), role: "owner" },
  { pattern: /^\/rates$/, render: (root) => renderRates(root), role: "owner" },
  { pattern: /^\/members$/, render: (root) => renderMembers(root), role: "owner" },
  { pattern: /^\/reports$/, render: (root) => renderReports(root), role: "owner" },
  { pattern: /^\/settings$/, render: (root) => renderSettings(root), role: "owner" },
];

export async function route(): Promise<void> {
  const path = location.pathname;
  for (const r of routes) {
    const match = r.pattern.exec(path);
    if (!match) continue;
    if (!r.isPublic && !me()) {
      navigate("/signin", true);
      return;
    }
    if (r.role && me()) {
      const role = me()?.person.role as string;
      if (r.role === "member" && role !== "member") return navigate(homeFor(role), true);
      if (r.role === "staff" && role !== "owner" && role !== "kiln_tech") return navigate(homeFor(role), true);
      if (r.role === "owner" && role !== "owner") return navigate(homeFor(role), true);
    }
    const root = document.getElementById("root") as HTMLElement;
    clear(root);
    currentRefresh = null;
    r.render(root, match.slice(1));
    return;
  }
  if (me()) navigate(homeFor(me()?.person.role as string), true);
  else navigate("/signin", true);
}

export function sessionEnded(): void {
  if (!me() && location.pathname === "/signin") return; // a refused sign-in is not a session ending
  setMe(null);
  announce(sessionStatus, "Your session ended. Sign in again.");
  closeEvents();
  // The screen clears its data and shows the Sign in form in place, with the copy.
  const root = document.getElementById("root");
  if (root) {
    clear(root);
    renderSignin(root);
    root.querySelector(".panel")?.appendChild(sessionStatus);
  }
  history.replaceState({}, "", "/signin");
}

let eventsSource: EventSource | null = null;

export function connectEvents(): void {
  if (eventsSource || !me()) return;
  eventsSource = new EventSource("/api/events");
  eventsSource.addEventListener("change", () => currentRefresh?.());
  eventsSource.addEventListener("end", () => {
    closeEvents();
    sessionEnded();
  });
}

function closeEvents(): void {
  eventsSource?.close();
  eventsSource = null;
}

// The signed-in shell: a top bar with the studio name, the "Main" navigation and a
// Sign out button, above the screen's own grid.
export function shell(...children: (HTMLElement | null)[]): { root: HTMLElement; main: HTMLElement } {
  const nav = h("nav", { "aria-label": "Main", class: "main-nav" });
  const links: [string, string][] = [];
  const role = me()?.person.role;
  if (role === "member") {
    links.push(["My pieces", "/pieces"], ["Log a piece", "/pieces/new"], ["Credit", "/credit"]);
  } else if (role === "kiln_tech") {
    links.push(["Intake", "/intake"], ["Planner", "/planner"]);
  } else if (role === "owner") {
    links.push(["Dashboard", "/dashboard"], ["Planner", "/planner"], ["Intake", "/intake"], ["Rates", "/rates"], ["Members", "/members"], ["Reports", "/reports"], ["Settings", "/settings"]);
  }
  for (const [label, href] of links) {
    nav.appendChild(h("a", { href, class: location.pathname === href ? "nav-link active" : "nav-link", text: label }));
  }
  const signOut = h("button", {
    class: "btn",
    text: "Sign out",
    onclick: () => {
      void (async () => {
        try {
          await api("/api/session", { method: "DELETE" });
        } catch {
          /* the session ends regardless */
        }
        sessionEnded();
      })();
    },
  });
  const top = h("header", { class: "top-bar" }, h("div", { class: "studio-name", text: me()?.person.studio.name ?? "" }), nav, signOut, sessionStatus);
  const main = h("main", { class: "screen" });
  const root = h("div", { class: "app" }, top, main);
  for (const child of children) if (child) main.appendChild(child);
  return { root, main };
}

export function start(): void {
  void (async () => {
    try {
      const user = await api<{ user: Person }>("/api/me", { skipAuthRedirect: true });
      setMe({ person: user.user, timeZone: user.user.studio.time_zone });
    } catch {
      setMe(null);
    }
    window.addEventListener("popstate", () => void route());
    document.addEventListener("keydown", dialogKeyHandler);
    setUnauthenticatedHook(sessionEnded);
    connectEvents();
    await route();
  })();
}

start();
