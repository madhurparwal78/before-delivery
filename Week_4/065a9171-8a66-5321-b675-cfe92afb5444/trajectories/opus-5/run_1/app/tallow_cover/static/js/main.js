// The app frame and router. One frame, one rail, one working area.

import { ApiFailure, api } from "./api.js";
import { clear, el } from "./dom.js";
import { homesFor } from "./homes.js";
import * as signIn from "./screens/signin.js";
import * as shifts from "./screens/shifts.js";
import * as leave from "./screens/leave.js";
import * as sickness from "./screens/sickness.js";
import * as rota from "./screens/rota.js";
import * as cover from "./screens/cover.js";
import * as accrual from "./screens/accrual.js";
import * as queue from "./screens/queue.js";
import * as today from "./screens/today.js";
import * as floors from "./screens/floors.js";
import * as attendance from "./screens/attendance.js";
import * as payPeriods from "./screens/payperiods.js";
import * as exports from "./screens/exports.js";
import * as audit from "./screens/audit.js";
import * as profile from "./screens/profile.js";

const NAV = [
  { path: "/shifts", label: "My shifts", roles: ["care_worker", "bank_carer"] },
  { path: "/queue", label: "Queue", roles: ["unit_manager", "hr_admin"] },
  { path: "/today", label: "Today", roles: ["unit_manager", "hr_admin"] },
  { path: "/leave/new", label: "Request leave", roles: ["care_worker", "unit_manager"] },
  { path: "/leave", label: "My requests", roles: ["care_worker", "unit_manager"] },
  { path: "/sickness", label: "Sickness", roles: ["care_worker"] },
  { path: "/rota", label: "Team rota", roles: ["care_worker", "unit_manager", "hr_admin"] },
  { path: "/cover", label: "Open cover", roles: ["bank_carer"] },
  { path: "/accrual", label: "Holiday accrual", roles: ["bank_carer"] },
  { path: "/floors", label: "Floors and policy", roles: ["unit_manager", "hr_admin"] },
  { path: "/attendance", label: "Attendance", roles: ["unit_manager", "hr_admin"] },
  { path: "/pay-periods", label: "Pay periods", roles: ["hr_admin"] },
  { path: "/exports", label: "Exports", roles: ["hr_admin"] },
  { path: "/audit", label: "Audit log", roles: ["unit_manager", "hr_admin"] },
  { path: "/profile", label: "Profile", roles: ["care_worker", "bank_carer", "unit_manager", "hr_admin"] },
];

const ROUTES = [
  { pattern: /^\/sign-in$/, screen: signIn },
  { pattern: /^\/shifts$/, screen: shifts },
  { pattern: /^\/leave\/new$/, screen: leave.newRequest },
  { pattern: /^\/leave$/, screen: leave.myRequests },
  { pattern: /^\/leave\/(?<id>[^/]+)$/, screen: leave.requestDetail },
  { pattern: /^\/sickness$/, screen: sickness.list },
  { pattern: /^\/sickness\/(?<id>[^/]+)$/, screen: sickness.detail },
  { pattern: /^\/rota$/, screen: rota },
  { pattern: /^\/cover$/, screen: cover },
  { pattern: /^\/accrual$/, screen: accrual },
  { pattern: /^\/queue$/, screen: queue },
  { pattern: /^\/today$/, screen: today },
  { pattern: /^\/floors$/, screen: floors },
  { pattern: /^\/attendance$/, screen: attendance },
  { pattern: /^\/pay-periods$/, screen: payPeriods },
  { pattern: /^\/exports$/, screen: exports },
  { pattern: /^\/audit$/, screen: audit },
  { pattern: /^\/profile$/, screen: profile },
];

const FIRST_SCREEN = {
  care_worker: "/shifts",
  bank_carer: "/shifts",
  unit_manager: "/queue",
  hr_admin: "/queue",
};

const root = document.getElementById("app");
const state = { me: null, homes: [], stop: null };

export function navigate(path, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);
  render();
}

function navLinks() {
  const current = window.location.pathname;
  const list = el("ul", {});
  for (const item of NAV) {
    if (!item.roles.includes(state.me.role)) continue;
    list.append(
      el(
        "li",
        {},
        el("a", {
          href: item.path,
          "aria-current": current === item.path ? "page" : null,
          text: item.label,
        })
      )
    );
  }
  return el("nav", { "aria-label": "Main" }, list);
}

function homesNav() {
  const list = el("ul", {});
  for (const home of state.homes) {
    list.append(el("li", {}, el("strong", { text: home.name })));
    for (const unit of home.units) {
      list.append(
        el("li", {}, el("a", { href: `/rota?unit=${unit.id}`, text: unit.name }))
      );
    }
  }
  return el("nav", { "aria-label": "Homes and units", class: "homes" }, list);
}

function rail() {
  const isManager = ["unit_manager", "hr_admin"].includes(state.me.role);
  const signOut = el("button", {
    class: "quiet",
    type: "button",
    text: "Sign out",
    onclick: async () => {
      await api.remove("/api/session");
      state.me = null;
      navigate("/sign-in");
    },
  });
  const parts = [el("p", { class: "brand", text: "Tallow Cover" }), navLinks()];
  if (isManager) {
    const drawer = el("div", { class: "drawer" }, homesNav());
    const toggle = el("button", {
      class: "quiet drawer-toggle",
      type: "button",
      text: "Homes and units",
      "aria-expanded": "false",
      onclick: () => {
        const open = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", open ? "false" : "true");
        drawer.classList.toggle("open", !open);
      },
    });
    parts.push(toggle, drawer);
  }
  parts.push(signOut);
  return el("aside", { class: "rail" }, parts);
}

function matchRoute(path) {
  for (const route of ROUTES) {
    const found = path.match(route.pattern);
    if (found) return { screen: route.screen, params: found.groups || {} };
  }
  return null;
}

async function render() {
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  if (state.stop) {
    state.stop();
    state.stop = null;
  }
  if (!state.me) {
    try {
      state.me = await api.get("/api/me");
      state.homes = homesFor(state.me);
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 401) throw error;
    }
  }
  if (!state.me) {
    if (path !== "/sign-in") {
      navigate("/sign-in", { replace: true });
      return;
    }
    clear(root);
    root.append(el("main", { class: "work" }, signIn.render({ navigate, onSignedIn })));
    return;
  }
  if (path === "/" || path === "/sign-in") {
    navigate(FIRST_SCREEN[state.me.role], { replace: true });
    return;
  }
  const route = matchRoute(path);
  clear(root);
  const work = el("main", { class: "work" });
  root.append(el("div", { class: "frame" }, rail(), work));
  if (!route || !route.screen) {
    work.append(el("h1", { text: "Not found" }));
    return;
  }
  const context = { me: state.me, homes: state.homes, params: route.params, query, navigate };
  const screen = await route.screen.render(context);
  work.append(screen.node || screen);
  state.stop = screen.stop || null;
}

async function onSignedIn(me) {
  state.me = me;
  state.homes = homesFor(me);
  navigate(FIRST_SCREEN[me.role], { replace: true });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='/']");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  navigate(link.getAttribute("href"));
});

window.addEventListener("popstate", render);
render();
