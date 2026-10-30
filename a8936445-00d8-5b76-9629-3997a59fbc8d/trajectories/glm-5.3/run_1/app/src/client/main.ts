/** Stationkeeper client entry: session, routing and the screen registry. */

import "./styles.css";
import type { User } from "../shared/api-types.js";
import { ApiClientError, apiJson } from "./api.js";
import { buildShell, NAV_BY_ROLE, removeLiveRegions } from "./shell.js";
import { createFeedback, showError, type Feedback } from "./feedback.js";
import { renderSignIn } from "./screens/signin.js";
import { renderDial } from "./screens/dial/dial-screen.js";
import { renderBookings } from "./screens/bookings.js";
import { renderDocuments } from "./screens/documents.js";
import { renderBilling } from "./screens/billing.js";
import { renderTenants } from "./screens/tenants.js";
import { renderSettings } from "./screens/settings.js";
import { renderInspect } from "./screens/inspect.js";

const KITCHEN_NAME = "Larder Row Kitchen";
const cleanups: Array<() => void> = [];

function runCleanups(): void {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
}

function registerCleanup(fn: () => void): void {
  cleanups.push(fn);
}

export interface ScreenDeps {
  user: User | null;
  feedback: Feedback;
  navigate(path: string): void;
  zone(): string;
  kitchenName: string;
  registerCleanup(fn: () => void): void;
}

let currentUser: User | null = null;
let kitchenZone = "America/Chicago";

async function boot(): Promise<void> {
  try {
    const session = await apiJson<{ user: User }>("GET", "/api/session");
    currentUser = session.user;
  } catch (e) {
    if (e instanceof ApiClientError && e.detail.status === 401) {
      currentUser = null;
    } else {
      throw e;
    }
  }
  window.addEventListener("popstate", () => void route());
  await route();
}

async function loadZone(): Promise<string> {
  if (currentUser === null) return kitchenZone;
  try {
    const dial = await apiJson<{ time_zone: string }>("GET", "/api/dial");
    kitchenZone = dial.time_zone;
  } catch {
    /* keep default */
  }
  return kitchenZone;
}

async function navigate(path: string): Promise<void> {
  window.history.pushState({}, "", path);
  await route();
}

async function signOut(): Promise<void> {
  try {
    await apiJson("DELETE", "/api/session");
  } catch {
    /* sign out regardless */
  }
  currentUser = null;
  await navigate("/signin");
}

async function route(): Promise<void> {
  runCleanups();
  const path = window.location.pathname;
  const app = document.getElementById("app") as HTMLElement;

  // The inspector page is public and standalone.
  if (path.startsWith("/inspect/")) {
    document.title = "Inspection — Stationkeeper";
    renderInspect(app, makeDeps(null), path.slice("/inspect/".length));
    return;
  }

  if (currentUser === null) {
    document.title = "Sign in — Stationkeeper";
    const deps = makeDeps(null);
    if (sessionStorage.getItem("sk_session_ended") === "1") {
      sessionStorage.removeItem("sk_session_ended");
      showError(deps.feedback, "Your session ended. Sign in again.");
    }
    renderSignIn(app, deps.feedback, KITCHEN_NAME, (user) => {
      currentUser = user;
      void navigate("/");
    });
    return;
  }

  const user = currentUser;
  await loadZone();

  const allowed = NAV_BY_ROLE[user.role].map((item) => item.path);
  const target = allowed.includes(path) ? path : "/";
  if (target !== path) {
    window.history.replaceState({}, "", target);
  }

  const liveRegionsWrap = document.querySelector(".live-regions");
  if (liveRegionsWrap === null) {
    const wrap = document.createElement("div");
    wrap.className = "live-regions";
    const activity = document.createElement("div");
    activity.className = "activity";
    activity.setAttribute("role", "status");
    activity.setAttribute("aria-label", "Activity");
    const problem = document.createElement("div");
    problem.className = "problem";
    problem.setAttribute("role", "alert");
    problem.setAttribute("aria-label", "Problem");
    wrap.append(activity, problem);
    document.body.appendChild(wrap);
  }
  document.querySelector(".activity")?.replaceChildren();
  document.querySelector(".problem")?.replaceChildren();

  const deps = makeDeps(user);
  const shellRoot = document.createElement("div");
  app.replaceChildren(shellRoot);
  const shell = buildShell(
    shellRoot,
    user,
    kitchenZone,
    target,
    () => void signOut(),
    (p) => void navigate(p)
  );
  shell.updateClock(Date.now());
  const tick = setInterval(() => shell.updateClock(Date.now()), 5000);
  registerCleanup(() => clearInterval(tick));

  const main = document.createElement("main");
  shellRoot.appendChild(main);
  document.title = `${NAV_BY_ROLE[user.role].find((n) => n.path === target)?.label ?? "Dial"} — Stationkeeper`;

  switch (target) {
    case "/":
      await renderDial(main, deps, shell);
      break;
    case "/bookings":
      await renderBookings(main, deps);
      break;
    case "/documents":
      await renderDocuments(main, deps);
      break;
    case "/billing":
      await renderBilling(main, deps);
      break;
    case "/tenants":
      await renderTenants(main, deps);
      break;
    case "/settings":
      await renderSettings(main, deps);
      break;
    default:
      await renderDial(main, deps, shell);
  }
}

function makeDeps(user: User | null): ScreenDeps {
  const app = document.getElementById("app") as HTMLElement;
  let activityEl = document.querySelector<HTMLElement>(".activity");
  let problemEl = document.querySelector<HTMLElement>(".problem");
  if (activityEl === null || problemEl === null) {
    const wrap = document.createElement("div");
    wrap.className = "live-regions";
    activityEl = document.createElement("div");
    activityEl.className = "activity";
    activityEl.setAttribute("role", "status");
    activityEl.setAttribute("aria-label", "Activity");
    problemEl = document.createElement("div");
    problemEl.className = "problem";
    problemEl.setAttribute("role", "alert");
    problemEl.setAttribute("aria-label", "Problem");
    wrap.append(activityEl, problemEl);
    document.body.appendChild(wrap);
  }
  return {
    user,
    feedback: createFeedback(activityEl, problemEl),
    navigate: (p) => void navigate(p),
    zone: () => kitchenZone,
    kitchenName: KITCHEN_NAME,
    registerCleanup
  };
}

void boot();
