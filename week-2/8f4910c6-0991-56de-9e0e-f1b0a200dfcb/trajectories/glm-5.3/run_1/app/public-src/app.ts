import { api, ApiFail, link, el, focusHeading } from "./lib.js";
import { matchPath, type Page, register, liveRegion, announce, queryParams } from "./pages.js";
import { registerAccountPages } from "./pages/public2.js";
import { registerWorkspacePages } from "./pages/workspace.js";
import { registerWorkspacePages as registerWorkspacePages2 } from "./pages/workspace2.js";
import { readTray } from "./stores.js";
import { registerPublicPages } from "./pages/public.js";
import "./pages/cast.js";
import { rememberReturn, takeReturn } from "./stores.js";

registerPublicPages();
registerAccountPages(register, go);
registerWorkspacePages();
registerWorkspacePages2();

const main = document.getElementById("main") as HTMLElement;
const cover = document.getElementById("cover") as HTMLElement;
const nav = document.getElementById("site-nav") as HTMLElement;

let lastPath: string | null = null;
let publicTrayCount = 0;

interface MemberInfo {
  member: { id: string; name: string; role: string; office: string; talentId: string | null };
}

let session: MemberInfo["member"] | null = null;

async function loadSession(): Promise<void> {
  try {
    const me = (await api("/api/me", { method: "GET" })) as MemberInfo["member"] & { member?: unknown };
    session = me && (me as { id?: string }).id ? (me as MemberInfo["member"]) : null;
  } catch (err) {
    if (err instanceof ApiFail && (err.code === "session_ended" || err.code === "unauthenticated" || err.code === "access_removed")) {
      session = null;
      return;
    }
    session = null;
  }
}

function refreshHeader(): void {
  nav.textContent = "";
  if (session) {
    const navLinks: Array<[string, string]> = [];
    const role = session.role;
    if (role === "agency_director") navLinks.push(["/workspace/overview", "Overview"], ["/workspace/board", "Board"], ["/workspace/bookings", "Bookings"], ["/workspace/licences", "Licences"], ["/workspace/packages", "Packages"], ["/workspace/applications", "Applications"], ["/workspace/roster", "Roster"], ["/workspace/members", "Members"], ["/workspace/rate-cards", "Rate cards"], ["/workspace/offices", "Offices"]);
    if (role === "booker") navLinks.push(["/workspace/board", "Board"], ["/workspace/bookings", "Bookings"], ["/workspace/packages", "Packages"]);
    if (role === "accounts_lead") navLinks.push(["/workspace/licences", "Licences"], ["/workspace/bookings", "Bookings"]);
    if (role === "scout") navLinks.push(["/workspace/applications", "Applications"]);
    if (role === "talent") navLinks.push(["/workspace/me", "My calendar"]);
    const workspaceNav = el("nav");
    workspaceNav.setAttribute("aria-label", "Workspace");
    for (const [href, text] of navLinks) {
      workspaceNav.appendChild(link(href, text));
    }
    nav.appendChild(workspaceNav);
    const signOut = el("button");
    signOut.textContent = "Sign out";
    signOut.addEventListener("click", async () => {
      await api("/api/session", { method: "DELETE" }).catch(() => {});
      session = null;
      await go("/sign-in", true);
    });
    nav.appendChild(signOut);
    return;
  }
  const onWorkspace = location.pathname.startsWith("/workspace") || location.pathname === "/sign-in";
  nav.appendChild(link("/boards", "Boards"));
  const tray = readTray();
  publicTrayCount = tray.length;
  nav.appendChild(link("/tray", `Tray ${publicTrayCount}`));
  nav.appendChild(link("/apply", "Apply"));
  void onWorkspace;
}

function setTitle(title: string): void {
  document.title = `${title} — Vesper & Rowe Talent`;
}

/** Renders a page into the main area with the cover reveal for public routes. */
async function renderPage(page: Page, pushHistory: boolean, direction: "up" | "down" | null): Promise<void> {
  const isPublic = !page.workspace;
  const useCover = isPublic && direction !== null && !prefersReducedMotion();
  if (useCover) {
    cover.classList.remove("up", "down");
    cover.classList.add(direction === "up" ? "up" : "down");
    await wait(300);
  }
  main.textContent = "";
  const container = el("div");
  main.appendChild(container);
  const params = queryParams();
  const status = liveRegion("page", "Page announcements");
  status.classList.remove("visually-hidden");
  status.classList.add("status-line");
  try {
    await page.render(container, params);
    setTitle(page.title());
  } catch (err) {
    if (err instanceof ApiFail && (err.code === "session_ended" || err.code === "access_removed" || err.code === "unauthenticated")) {
      renderSessionEnded(container, err.code);
    } else if (err instanceof ApiFail && err.status === 404) {
      renderNotFound(container);
    } else {
      renderNotFound(container);
    }
    setTitle("Vesper & Rowe Talent");
  }
  container.appendChild(status);
  if (pushHistory && lastPath !== location.pathname) {
    history.pushState(null, "", location.href);
  }
  lastPath = location.pathname;
  refreshHeader();
  if (useCover) {
    cover.classList.remove("up", "down");
    cover.classList.add(direction === "up" ? "down" : "up");
    await wait(300);
    cover.classList.remove("up", "down");
  }
  focusHeading(container);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderSessionEnded(container: HTMLElement, code: string): void {
  const box = el("section");
  const heading = el("h1", undefined, code === "access_removed" ? "Access removed" : "Your session ended");
  const text = el("p", undefined, code === "access_removed"
    ? "Your access to Rungboard was removed. Nothing more can be saved."
    : "Your session ended. Your draft is kept; sign in again to finish.");
  const signIn = link("/sign-in?return=" + encodeURIComponent(location.pathname + location.search), "Sign in again");
  rememberReturn(location.pathname + location.search);
  box.append(heading, text, signIn);
  container.appendChild(box);
}

function renderNotFound(container: HTMLElement): void {
  const box = el("section");
  box.append(el("h1", undefined, "Page not found"), el("p", undefined, "That address does not exist on Rungboard."), link("/boards", "Back to boards"));
  container.appendChild(box);
}

/** Navigates to a path with the published transitions. */
export async function go(path: string, replace: boolean = false): Promise<void> {
  const url = new URL(path, location.origin);
  const target = url.pathname + url.search;
  if (replace) history.replaceState(null, "", target);
  else history.pushState(null, "", target);
  await route(target);
}

async function route(target: string): Promise<void> {
  const url = new URL(target, location.origin);
  const page = matchPath(url.pathname);
  if (!page) {
    main.textContent = "";
    renderNotFound(main);
    return;
  }
  const back = historyLengthGrew() && isPublicRoute(url.pathname) ? "down" : "up";
  await renderPage(page, false, isPublicRoute(url.pathname) ? back : null);
}

function isPublicRoute(pathname: string): boolean {
  const page = matchPath(pathname);
  return !!page && !page.workspace;
}

function historyLengthGrew(): boolean {
  return history.state === null && history.length > 1 ? true : false;
}

window.addEventListener("popstate", () => {
  void route(location.pathname + location.search);
});

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest("a[data-nav]");
  if (!target) return;
  const href = target.getAttribute("href") || "";
  if (href.startsWith("http") || href.startsWith("#")) return;
  event.preventDefault();
  void go(href);
});

/** Boot: restore a kept form's return path, then route. */
async function boot(): Promise<void> {
  await loadSession();
  const params = queryParams();
  if (location.pathname === "/sign-in" && params.get("return")) {
    rememberReturn(params.get("return") || "");
  }
  const page = matchPath(location.pathname);
  if (!page) {
    renderNotFound(main);
    return;
  }
  await renderPage(page, false, isPublicRoute(location.pathname) ? "up" : null);
  void takeReturn();
}

void boot();

export { session as currentMember, refreshHeader, announce, go as navigate };
export function setSession(member: MemberInfo["member"] | null): void {
  session = member;
  refreshHeader();
}
