// App entry: routing, session, service status, screens.
import type { Member, TeamRef } from "./types.js";
import { api, h, clear, notice, alertNotice, stateWord } from "./lib.js";
import { renderRun } from "./screens/run.js";
import { renderJobs } from "./screens/jobs.js";
import { renderLibrary } from "./screens/library.js";
import { renderWebhooks } from "./screens/webhooks.js";
import { renderFinance } from "./screens/finance.js";
import { renderAdmin } from "./screens/admin.js";
import { openJobDialog } from "./jobdialog.js";

export interface AppCtx {
  member: Member;
  teams: TeamRef[];
  main: HTMLElement;
  selectedTeam(): string | null;
  onTeamChange(teamId: string): void;
  showMeter(): boolean;
  openJobDialog(jobId: string): void;
  navigate(path: string): void;
}

const NAV_ITEMS: { path: string; label: string; roles: Member["role"][] }[] = [
  { path: "/run", label: "Run", roles: ["member"] },
  { path: "/jobs", label: "Jobs", roles: ["member", "admin", "finance", "compliance"] },
  { path: "/library", label: "Library", roles: ["member", "admin", "finance", "compliance"] },
  { path: "/webhooks", label: "Webhooks", roles: ["member", "admin"] },
  { path: "/finance", label: "Finance", roles: ["finance", "admin"] },
  { path: "/admin", label: "Admin", roles: ["admin", "finance"] },
];

let member: Member | null = null;
let teams: TeamRef[] = [];
let teamChoice: string | null = null;
const main = document.getElementById("main") as HTMLElement;

function homeFor(role: Member["role"]): string {
  if (role === "member") return "/run";
  if (role === "finance") return "/finance";
  if (role === "admin") return "/admin";
  return "/library";
}

async function boot(): Promise<void> {
  const res = await api<{ member: Member }>("GET", "/api/me");
  if (res.status !== 200) {
    renderSignIn();
    return;
  }
  member = res.body.member;
  await loadTeams();
  const nav = document.getElementById("primary-nav") as HTMLElement;
  buildNav(nav);
  (document.getElementById("member-name") as HTMLElement).textContent = member.name;
  const teamName = teams.find((t) => t.id === member?.team_id)?.name;
  (document.getElementById("member-team") as HTMLElement).textContent = teamName ?? orgRoleLabel(member.role);
  document.getElementById("sign-out-btn")?.addEventListener("click", async () => {
    await api("DELETE", "/api/session");
    window.location.assign("/");
  });
  document.getElementById("nav-menu-btn")?.addEventListener("click", () => {
    nav.classList.toggle("open");
  });
  if (!window.location.pathname.startsWith("/run") && !window.location.pathname.startsWith("/jobs") &&
      !window.location.pathname.startsWith("/library") && !window.location.pathname.startsWith("/webhooks") &&
      !window.location.pathname.startsWith("/finance") && !window.location.pathname.startsWith("/admin")) {
    history.replaceState(null, "", homeFor(member.role));
  }
  startSystemPolling();
  window.addEventListener("popstate", route);
  route();
}

function orgRoleLabel(role: Member["role"]): string {
  if (role === "admin") return "Org admin";
  if (role === "finance") return "Finance controller";
  if (role === "compliance") return "Compliance reviewer";
  return "";
}

async function loadTeams(): Promise<void> {
  if (!member) return;
  const res = await api<{ teams: TeamRef[] }>("GET", "/api/teams");
  teams = res.body.teams;
  if (member.team_id) teamChoice = member.team_id;
  else if (teams.length > 0) teamChoice = teams[0].id;
}

function buildNav(nav: HTMLElement): void {
  if (!member) return;
  clear(nav);
  for (const item of NAV_ITEMS) {
    if (!item.roles.includes(member.role)) continue;
    nav.appendChild(h("a", { href: item.path, text: item.label, onclick: (e: Event) => { e.preventDefault(); history.pushState(null, "", item.path); route(); } }));
  }
}

function renderSignIn(): void {
  clear(main);
  const email = h("input", { type: "text", id: "signin-email", autocomplete: "username" });
  const passcode = h("input", { type: "password", id: "signin-passcode", autocomplete: "current-password" });
  const form = h("form", {
    "aria-label": "Sign in",
    onsubmit: async (e: Event) => {
      e.preventDefault();
      const btn = form.querySelector("button") as HTMLButtonElement;
      btn.textContent = "Signing in…";
      btn.disabled = true;
      const res = await api<{ member: Member }>("POST", "/api/session", { email: (email as HTMLInputElement).value, passcode: (passcode as HTMLInputElement).value });
      if (res.status === 200) {
        window.location.assign("/");
        return;
      }
      btn.textContent = "Sign in";
      btn.disabled = false;
      alertNotice("That email and passcode do not match.");
    },
  },
    h("div", { class: "field" }, h("label", { for: "signin-email", text: "Email" }), email),
    h("div", { class: "field" }, h("label", { for: "signin-passcode", text: "Passcode" }), passcode),
    h("button", { class: "btn", type: "submit", text: "Sign in" }),
  );
  main.append(
    h("div", { class: "signin-wrap" },
      h("div", { class: "panel" },
        h("div", { class: "signin-title" }, h("h1", { text: "Sign in to Dispatch" })),
        h("div", { class: "panel-body" }, form),
      ),
    ),
  );
  email.focus();
}

function route(): void {
  const path = window.location.pathname;
  const nav = document.getElementById("primary-nav") as HTMLElement;
  nav.querySelectorAll("a").forEach((a) => {
    if (a.getAttribute("href") === path) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  nav.classList.remove("open");
  if (!member) return;
  const ctx: AppCtx = {
    member,
    teams,
    main,
    selectedTeam: () => teamChoice,
    onTeamChange: (id) => { teamChoice = id; route(); },
    showMeter: () => true,
    openJobDialog: (jobId) => openJobDialogById(jobId, ctx),
    navigate: (p) => { history.pushState(null, "", p); route(); },
  };
  if (path === "/run" && member.role === "member") renderRun(ctx);
  else if (path === "/jobs") renderJobs(ctx);
  else if (path === "/library") renderLibrary(ctx);
  else if (path === "/webhooks" && (member.role === "member" || member.role === "admin")) renderWebhooks(ctx);
  else if (path === "/finance" && (member.role === "finance" || member.role === "admin")) renderFinance(ctx);
  else if (path === "/admin" && (member.role === "admin" || member.role === "finance")) renderAdmin(ctx);
  else {
    history.replaceState(null, "", homeFor(member.role));
    route();
    return;
  }
}

function openJobDialogById(jobId: string, ctx: AppCtx): void {
  openJobDialog(jobId);
  void ctx;
}

// ---------------------------------------------------------------------------
// Service status polling

let systemTimer: number | null = null;
function startSystemPolling(): void {
  if (systemTimer) return;
  const refresh = async () => {
    const res = await api<{ storage: string; billing: string }>("GET", "/api/system");
    if (res.status !== 200) return;
    const el = document.getElementById("service-status") as HTMLElement;
    clear(el);
    const notes: HTMLElement[] = [];
    if (res.body.storage === "down") notes.push(h("div", { class: "notice", text: "Storage is unreachable. New jobs wait in the queue, and uploads and image links are paused." }));
    if (res.body.billing === "down") notes.push(h("div", { class: "notice", text: "Billing is unreachable. Top-ups stay pending until it returns." }));
    el.classList.toggle("has-notice", notes.length > 0);
    notes.forEach((n) => el.appendChild(n));
  };
  void refresh();
  systemTimer = window.setInterval(refresh, 10_000);
}

void stateWord;
void notice;

boot();
