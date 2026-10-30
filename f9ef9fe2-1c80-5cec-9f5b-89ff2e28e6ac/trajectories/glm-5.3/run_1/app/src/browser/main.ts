import { api } from "./api";
import { el, icon } from "./ui";
import { renderSignIn } from "./screens/signin";
import { renderLoom } from "./screens/loom";
import { renderBookings } from "./screens/bookings";
import { renderPapers } from "./screens/papers";
import { renderBilling } from "./screens/billing";
import { renderMembers } from "./screens/members";
import { renderRates } from "./screens/rates";
import { renderReports } from "./screens/reports";

export interface User {
  id: string;
  name: string;
  email: string;
  role: "operator" | "member" | "bookkeeper";
  kitchen_id: string;
  member_id: string | null;
}

export interface Station {
  id: string;
  name: string;
  kind: string;
  order: number;
}

export interface Kitchen {
  id: string;
  name: string;
  timezone: string;
  today: string;
  server_now: string;
  same_day_cutoff: string;
  hold_seconds: number;
  stations: Station[];
}

export interface Services {
  billing: "up" | "down";
  files: "up" | "down";
  mail: "up" | "down";
}

export interface AppState {
  user: User | null;
  kitchen: Kitchen | null;
  services: Services;
  paused: string[];
}

export const state: AppState = {
  user: null,
  kitchen: null,
  services: { billing: "up", files: "up", mail: "up" },
  paused: [],
};

const OUTAGE_COPY: Record<string, string> = {
  billing: "Billing is unreachable. Confirming, cancelling, recurring slots and pack purchases are paused. Brushing and holds still work.",
  files: "File storage is unreachable. Uploading and opening documents are paused. Bookings still use the papers on file.",
  mail: "Email is unreachable. Confirming, cancelling and recurring slots are paused.",
};

const SERVICE_LABEL: Record<string, string> = {
  billing: "Billing",
  files: "File storage",
  mail: "Email",
};

const ROUTES = ["/signin", "/loom", "/bookings", "/papers", "/billing", "/members", "/rates", "/reports"];

function navLinksFor(role: User["role"]): Array<{ path: string; label: string }> {
  const links = [
    { path: "/loom", label: "Loom", roles: ["operator", "member"] },
    { path: "/bookings", label: "Bookings", roles: ["operator", "member", "bookkeeper"] },
    { path: "/papers", label: "Papers", roles: ["operator", "member"] },
    { path: "/billing", label: "Billing", roles: ["member"] },
    { path: "/members", label: "Members", roles: ["operator"] },
    { path: "/rates", label: "Rates", roles: ["operator"] },
    { path: "/reports", label: "Reports", roles: ["operator", "bookkeeper"] },
  ];
  return links.filter((link) => link.roles.includes(role)).map(({ path, label }) => ({ path, label }));
}

function landingFor(role: User["role"]): string {
  return role === "bookkeeper" ? "/reports" : "/loom";
}

let bannerEl: HTMLElement;
let navEl: HTMLElement;
let mainEl: HTMLElement;
let statusTimers: ReturnType<typeof setTimeout>[] = [];

export function currentPath(): string {
  const path = window.location.pathname;
  return ROUTES.includes(path) ? path : "";
}

export function navigate(path: string): void {
  if (window.location.pathname !== path) {
    window.history.pushState({}, "", path);
  }
  render();
}

window.addEventListener("popstate", () => {
  render();
});

const recoveries: Record<string, number> = {};

function renderBanner(): void {
  statusTimers.forEach(clearTimeout);
  statusTimers = [];
  bannerEl.replaceChildren();
  const lines: Array<{ text: string; kind: "outage" | "recovery" }> = [];
  for (const service of ["billing", "files", "mail"] as const) {
    if (state.services[service] === "down") {
      lines.push({ text: OUTAGE_COPY[service]!, kind: "outage" });
    }
  }
  const now = Date.now();
  for (const [service, until] of Object.entries(recoveries)) {
    if (until > now) {
      lines.push({ text: `${SERVICE_LABEL[service] ?? service} is back. Paused actions are available again.`, kind: "recovery" });
    }
  }
  if (lines.length === 0) {
    bannerEl.classList.remove("show");
    return;
  }
  const list = el("ul");
  for (const line of lines) {
    const item = el("li", { class: line.kind });
    item.append(icon("alert"));
    item.append(line.text);
    list.append(item);
  }
  bannerEl.append(list);
  bannerEl.classList.add("show");
  for (const [service, until] of Object.entries(recoveries)) {
    if (until > now) {
      statusTimers.push(
        setTimeout(() => {
          delete recoveries[service];
          renderBanner();
        }, until - now + 50)
      );
    }
  }
}

function noteRecovery(service: string): void {
  recoveries[service] = Date.now() + 10000;
}

async function pollServices(): Promise<void> {
  try {
    const body = await api<{ services: Services; paused: string[] }>("GET", "/status");
    for (const service of ["billing", "files", "mail"] as const) {
      if (state.services[service] === "down" && body.services[service] === "up") {
        noteRecovery(service);
      }
    }
    const changed = state.paused.join(",") !== body.paused.join(",");
    state.services = body.services;
    state.paused = body.paused;
    renderBanner();
    if (changed) {
      window.dispatchEvent(new CustomEvent("pilotlight:status"));
    }
  } catch {
    // keep the last known state
  }
}

export function actionPaused(action: string): boolean {
  return state.paused.includes(action);
}

export function render(): void {
  const path = currentPath();
  if (!state.user) {
    if (path !== "/signin") {
      window.history.replaceState({}, "", "/signin");
    }
  }
  renderShellChrome();
  const active = currentPath();
  mainEl.replaceChildren();
  const container = el("div", { class: "screen" });
  mainEl.append(container);
  if (!state.user) {
    renderSignIn(container);
    return;
  }
  const allowed = navLinksFor(state.user.role).some((link) => link.path === active);
  switch (active) {
    case "/loom":
      if (state.user.role === "operator" || state.user.role === "member") {
        renderLoom(container);
        return;
      }
      break;
    case "/bookings":
      renderBookings(container);
      return;
    case "/papers":
      if (state.user.role !== "bookkeeper") {
        renderPapers(container);
        return;
      }
      break;
    case "/billing":
      if (state.user.role === "member") {
        renderBilling(container);
        return;
      }
      break;
    case "/members":
      if (state.user.role === "operator") {
        renderMembers(container);
        return;
      }
      break;
    case "/rates":
      if (state.user.role === "operator") {
        renderRates(container);
        return;
      }
      break;
    case "/reports":
      if (state.user.role === "operator" || state.user.role === "bookkeeper") {
        renderReports(container);
        return;
      }
      break;
    default:
      break;
  }
  if (!allowed) {
    window.history.replaceState({}, "", landingFor(state.user.role));
    render();
    return;
  }
  renderLoom(container);
}

function renderShellChrome(): void {
  const app = document.getElementById("app")!;
  app.replaceChildren();
  const topbar = el("div", { class: "topbar" });
  const brand = el("span", { class: "brand", text: "Pilotlight" });
  topbar.append(brand);
  if (state.user) {
    const kitchenName = el("span", { class: "kitchen-name", text: state.kitchen?.name ?? "" });
    topbar.append(kitchenName);
    topbar.append(el("span", { class: "spacer" }));
    navEl = el("nav", { class: "main-nav", "aria-label": "Main" });
    for (const link of navLinksFor(state.user.role)) {
      const anchor = el("a", {
        href: link.path,
        onclick: (event: Event) => {
          event.preventDefault();
          navigate(link.path);
        },
      });
      anchor.textContent = link.label;
      if (window.location.pathname === link.path) {
        anchor.setAttribute("aria-current", "page");
      }
      navEl.append(anchor);
    }
    const menuBtn = el("button", {
      class: "btn quiet menu-btn",
      "aria-expanded": "false",
      onclick: () => {
        navEl.classList.toggle("open");
        const open = navEl.classList.contains("open");
        menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      },
    });
    menuBtn.textContent = "Menu";
    const signOut = el("button", {
      class: "btn",
      onclick: async () => {
        await api("DELETE", "/session");
        state.user = null;
        state.kitchen = null;
        navigate("/signin");
      },
    });
    signOut.textContent = "Sign out";
    topbar.append(navEl, menuBtn, el("span", { class: "spacer" }), signOut);
  }
  bannerEl = el("div", { class: "banner", role: "status", "aria-label": "Service status" });
  mainEl = el("main");
  app.append(topbar, bannerEl, mainEl);
  renderBanner();
}

async function boot(): Promise<void> {
  try {
    const me = await api<{ user: User }>("GET", "/me");
    state.user = me.user;
  } catch {
    state.user = null;
  }
  if (state.user) {
    const kitchenBody = await api<{ kitchen: Kitchen }>("GET", `/kitchens/${state.user.kitchen_id}`);
    state.kitchen = kitchenBody.kitchen;
  }
  await pollServices();
  render();
  setInterval(() => {
    void pollServices();
  }, 10000);
}

void boot();
