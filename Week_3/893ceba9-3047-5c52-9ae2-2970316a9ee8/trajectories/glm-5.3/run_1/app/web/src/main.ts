/// <reference path="./globals.d.ts" />
import { User, Project, api, qs, navigate, ProjectDetail, Branch, WorkspaceStats } from "./api";
import { h, Feedback, bindHeaderScroll, clearEl } from "./ui";
import { logoMark, icon } from "./illustrations";
import { buildShell, buildNotice, renderServiceBanners, ServiceStatus } from "./shell";
import { renderLandingPage } from "./pages/landing";
import { renderSignInPage } from "./pages/signin";
import { renderDeskPage } from "./pages/desk";
import { renderProjectPage } from "./pages/project";
import { renderEditorPage } from "./pages/editor";
import { renderReviewPage } from "./pages/review";
import { renderTmPage } from "./pages/tm";
import { renderMergePage } from "./pages/merge";
import { renderSettingsPage } from "./pages/settings";
import { renderAuditPage } from "./pages/audit";
import { renderNotFound } from "./pages/notfound";

export interface PageCtx {
  user: User;
  projects: Project[];
  fb: Feedback;
  main: HTMLElement;
  shell: ShellParts;
}

export interface ShellParts {
  statusRegion: HTMLElement;
  refreshProjects: () => Promise<void>;
  announceProblem: (msg: string) => void;
}

const routes: Array<[RegExp, (ctx: PageCtx, m: RegExpMatchArray) => Promise<void>]> = [
  [/^\/$/, async (ctx) => renderLandingPage(ctx)],
  [/^\/sign-in$/, async (ctx) => renderSignInPage(ctx)],
  [/^\/desk$/, async (ctx) => await renderDeskPage(ctx)],
  [/^\/projects\/([^/]+)\/merge$/, async (ctx, m) => await renderMergePage(ctx, decodeURIComponent(m[1]))],
  [/^\/projects\/([^/]+)\/editor$/, async (ctx, m) => await renderEditorPage(ctx, decodeURIComponent(m[1]))],
  [/^\/projects\/([^/]+)\/tm$/, async (ctx, m) => await renderTmPage(ctx, decodeURIComponent(m[1]))],
  [/^\/projects\/([^/]+)\/settings$/, async (ctx, m) => await renderSettingsPage(ctx, decodeURIComponent(m[1]))],
  [/^\/projects\/([^/]+)$/, async (ctx, m) => await renderProjectPage(ctx, decodeURIComponent(m[1]))],
  [/^\/review$/, async (ctx) => await renderReviewPage(ctx)],
  [/^\/audit$/, async (ctx) => await renderAuditPage(ctx)],
];

interface AppParts { user: User | null; projects: Project[]; fb: Feedback; statusEl: HTMLElement; alertEl: HTMLElement; }

async function loadProjects(): Promise<Project[]> {
  const data = await api<{ projects: Project[] }>("/api/projects");
  return data.projects;
}

function pageSkeleton(): HTMLElement {
  const main = h("main", { id: "main" });
  main.appendChild(h("div", { class: "container" }, h("div", { class: "skeleton-block", style: "padding:40px 0" },
    h("div", { class: "skel big" }), h("div", { class: "skel bar", style: "width:60%" }),
    h("div", { class: "skel bar", style: "width:40%" }), h("div", { class: "skel bar", style: "width:70%" }))));
  return main;
}

function renderHeaderFor(user: User, projects: Project[]): { header: HTMLElement; statusRegion: HTMLElement; notice: HTMLElement; refresh: (p: Project[]) => void } {
  return buildSignedInHeader(user, projects);
}

async function render(): Promise<void> {
  const root = document.getElementById("app-root")!;
  lastStatus = "";
  lastProblem = "";
  let user: User | null = null;
  let projects: Project[] = [];
  let parts: AppParts | null = null;

  // build static chrome first
  const fbStatus = h("div", { class: "live-region", role: "status", "aria-label": "Desk updates" });
  const fbAlert = h("div", { class: "live-region", role: "alert", "aria-label": "Desk problems" });
  const fb: Feedback = {
    setStatus: (m) => { lastStatus = m; fbStatus.textContent = m; },
    setProblem: (m) => { lastProblem = m; fbAlert.textContent = m; },
    clearStatus: () => { lastStatus = ""; fbStatus.textContent = ""; },
    clearProblem: () => { lastProblem = ""; fbAlert.textContent = ""; },
  };

  try { user = await api<User>("/api/me"); } catch { user = null; }
  if (user) { try { projects = await loadProjects(); } catch { projects = []; } }

  const path = location.pathname;
  const signedIn = !!user;
  const needsAuth = path !== "/" && path !== "/sign-in";

  if (signedIn && (path === "/" || path === "/sign-in")) {
    history.replaceState(null, "", user!.role === "owner" ? "/desk" : "/review");
  }

  if (!signedIn && needsAuth) {
    const next = encodeURIComponent(path + location.search);
    history.replaceState(null, "", `/sign-in?next=${next}`);
  }

  const appParts = { user, projects, fb, statusEl: fbStatus, alertEl: fbAlert };
  parts = appParts;

  const shellBits = user ? renderHeaderFor(user, projects) : null;

  const shellEl = h("div", { id: "shell" });
  if (shellBits) {
    shellEl.appendChild(shellBits.header);
    const wrap = h("div", { class: "container", style: "padding-top:14px" });
    wrap.appendChild(shellBits.statusRegion);
    shellEl.appendChild(wrap);
  }
  const mainEl = pageSkeleton();
  shellEl.appendChild(mainEl);
  shellEl.appendChild(fbStatus);
  shellEl.appendChild(fbAlert);

  const notice = user ? null : buildPublicNotice();
  if (notice) shellEl.appendChild(notice);
  root.appendChild(shellEl);

  const ctx: PageCtx = {
    user: user as User,
    projects,
    fb,
    main: mainEl,
    shell: {
      statusRegion: shellBits ? shellBits.statusRegion : h("div"),
      refreshProjects: async () => {
        try { projects = await loadProjects(); if (shellBits) shellBits.refresh(projects); } catch { /* keep */ }
      },
      announceProblem: (msg) => fb.setProblem(msg),
    },
  };

  // service banners: read on load and every 15 seconds
  if (user) {
    const announced = new Set<string>();
    let serviceTimer: ReturnType<typeof setInterval> | null = null;
    const pollServices = async () => {
      try {
        const st = await api<ServiceStatus>("/api/integrations");
        renderServiceBanners(shellBits!.statusRegion, st, fb, announced);
      } catch { /* probe unavailable: keep the last state */ }
    };
    void pollServices();
    serviceTimer = setInterval(pollServices, 15000);
    window.addEventListener("popstate", () => { if (serviceTimer) clearInterval(serviceTimer); }, { once: true });
  }

  if (!user) {
    const publicCtx: PageCtx = { ...ctx, user: { id: "", name: "", email: "", role: "owner" } };
    if (location.pathname === "/") await renderLandingPage(publicCtx);
    else await renderSignInPage(publicCtx);
    bindHeaderScroll();
    return;
  }

  let matched = false;
  for (const [re, fn] of routes) {
    const m = location.pathname.match(re);
    if (m) {
      matched = true;
      try {
        await fn(ctx, m as unknown as RegExpMatchArray);
      } catch (e: any) {
        if (e && e.status === 404) await renderNotFound(ctx, false);
        else await renderNotFound(ctx, true);
      }
      break;
    }
  }
  if (!matched) await renderNotFound(ctx, false);
  bindHeaderScroll();
}

function buildPublicNotice(): HTMLElement {
  const KEY = "desk_notice_hidden";
  const root = h("aside", { role: "region", "aria-label": "Cookie and data notice", class: "notice" });
  if (localStorage.getItem(KEY) === "1") return h("span", { hidden: true });
  const body = h("p", { class: "body" }, "Interline Desk sets one session cookie to keep you signed in. No tracking or advertising cookies.");
  const more = h("p", { class: "more", hidden: true }, "Your choice to hide this notice is remembered in this browser only.");
  const detailsBtn = h("button", { class: "btn btn-outline btn-sm", onclick: () => { more.hidden = !more.hidden; } }, "Details");
  const gotIt = h("button", { class: "btn btn-primary btn-sm", onclick: () => { localStorage.setItem(KEY, "1"); root.remove(); } }, "Got it");
  root.appendChild(body); root.appendChild(more);
  root.appendChild(h("div", { class: "row" }, detailsBtn, gotIt));
  return root;
}

// Header for signed-in users
function buildSignedInHeader(user: User, projects: Project[]): { header: HTMLElement; statusRegion: HTMLElement; notice: HTMLElement; refresh: (p: Project[]) => void } {
  const parts = buildShell({
    user,
    projects,
    fb: { setStatus: () => {}, setProblem: () => {}, clearStatus: () => {}, clearProblem: () => {} },
    currentProjectSlug: () => window.__deskCurrentSlug || null,
    currentLanguage: () => window.__deskCurrentLang || null,
    onLanguageChange: (lang) => { window.__deskCurrentLang = lang; window.dispatchEvent(new CustomEvent("desk:language-change", { detail: lang })); },
  });
  void parts.notice;
  return parts;
}

window.addEventListener("popstate", () => { void rerender(); });
document.addEventListener("click", (ev) => {
  const a = (ev.target as HTMLElement).closest("a");
  if (!a) return;
  const href = a.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("javascript")) return;
  if (a.hasAttribute("download") || a.hasAttribute("data-download")) return;
  ev.preventDefault();
  history.pushState(null, "", href);
  void rerender();
});

let rendering = false;
let queued = false;
// Success and failure copy survive a rerender triggered by the same action.
let carryStatus = "";
let carryProblem = "";
let lastStatus = "";
let lastProblem = "";

export function carryFeedback(status: string, problem: string): void {
  carryStatus = status;
  carryProblem = problem;
}

async function rerender(): Promise<void> {
  if (rendering) { queued = true; return; }
  rendering = true;
  const root = document.getElementById("app-root")!;
  clearEl(root);
  const keepStatus = carryStatus || lastStatus;
  const keepProblem = carryProblem || lastProblem;
  try {
    await render();
    if (keepStatus) {
      const el = document.querySelector<HTMLElement>(".live-region[role=status]");
      if (el) el.textContent = keepStatus;
    }
    if (keepProblem) {
      const el = document.querySelector<HTMLElement>(".live-region[role=alert]");
      if (el) el.textContent = keepProblem;
    }
  } finally {
    carryStatus = "";
    carryProblem = "";
    rendering = false;
  }
  if (queued) { queued = false; await rerender(); }
}

async function boot(): Promise<void> {
  document.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      const btn = document.querySelector<HTMLButtonElement>("[data-ctrl-enter]");
      if (btn && !btn.disabled) { ev.preventDefault(); btn.click(); }
    }
  });
  await rerender();
}

void boot();
