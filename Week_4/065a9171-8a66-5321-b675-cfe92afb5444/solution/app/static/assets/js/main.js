// The app frame: a fixed rail with the role's navigation, and a router for the working area.
import { ApiError, del, get } from "./api.js";
import { h } from "./dom.js";
import { icon } from "./icons.js";
import * as views from "./views.js";

const boot = JSON.parse(document.getElementById("bootstrap").textContent);

const SCREENS = {
  "/shifts": { label: "My shifts", icon: "clock", roles: ["care_worker", "bank_carer"], view: views.shifts },
  "/queue": { label: "Queue", icon: "inbox", roles: ["unit_manager", "hr_admin"], view: views.queue },
  "/today": { label: "Today", icon: "sun", roles: ["unit_manager", "hr_admin"], view: views.today },
  "/leave/new": { label: "Request leave", icon: "calendarPlus", roles: ["care_worker", "unit_manager"], view: views.leaveForm },
  "/leave": { label: "My requests", icon: "list", roles: ["care_worker", "unit_manager"], view: views.leaveList },
  "/sickness": { label: "Sickness", icon: "thermometer", roles: ["care_worker"], view: views.sicknessList },
  "/rota": { label: "Team rota", icon: "grid", roles: ["care_worker", "unit_manager", "hr_admin"], view: views.rota },
  "/cover": { label: "Open cover", icon: "hand", roles: ["bank_carer"], view: views.cover },
  "/accrual": { label: "Holiday accrual", icon: "sprout", roles: ["bank_carer"], view: views.accrual },
  "/attendance": { label: "Attendance", icon: "check", roles: ["unit_manager", "hr_admin"], view: views.attendance },
  "/floors": { label: "Floors and policy", icon: "layers", roles: ["unit_manager", "hr_admin"], view: views.floors },
  "/pay-periods": { label: "Pay periods", icon: "receipt", roles: ["hr_admin"], view: views.payPeriods },
  "/exports": { label: "Exports", icon: "download", roles: ["hr_admin"], view: views.exportsView },
  "/audit": { label: "Audit log", icon: "scroll", roles: ["unit_manager", "hr_admin"], view: views.audit },
  "/profile": { label: "Profile", icon: "user", roles: ["care_worker", "bank_carer", "unit_manager", "hr_admin"], view: views.profile },
};
const DETAIL = [
  [/^\/leave\/([\w-]+)$/, views.leaveDetail, "/leave"],
  [/^\/sickness\/([\w-]+)$/, views.sicknessDetail, "/sickness"],
];
const ROLE_NAMES = { care_worker: "Care worker", bank_carer: "Bank carer", unit_manager: "Unit manager", hr_admin: "Group HR admin" };

export function firstScreen(role) {
  return ["unit_manager", "hr_admin"].includes(role) ? "/queue" : "/shifts";
}

function link(href, ...children) {
  return h("a", { href, "data-link": true }, ...children);
}

function rail(me) {
  const managers = ["unit_manager", "hr_admin"].includes(me.role);
  const main = h("nav", { "aria-label": "Main", class: "nav-main" }, h("ul", {},
    Object.entries(SCREENS).filter(([, s]) => s.roles.includes(me.role)).map(([path, s]) =>
      h("li", {}, link(path, icon(s.icon), h("span", { text: s.label }))))));
  const homes = managers && h("nav", { "aria-label": "Homes and units", class: "nav-homes" },
    boot.homes.map((home) => h("div", { class: "home" },
      link(`/queue?home=${home.id}&status=open&week=&request=`, h("span", { class: "home-name", text: home.name })),
      h("ul", {}, home.units.map((unit) => h("li", {}, link(`/rota?unit=${unit.id}`, unit.name)))))));
  const signOut = h("button", { type: "button", class: "quiet sign-out", text: "Sign out", onclick: async () => {
    await del("/api/session").catch((error) => error);
    location.assign("/sign-in");
  } });
  const panel = h("div", { class: "rail-panel", id: "rail-panel" }, main, homes || null);
  const toggle = managers && h("button", { type: "button", class: "quiet drawer-toggle", "aria-expanded": "false",
    "aria-controls": "rail-panel", onclick: () => setDrawer(toggle.getAttribute("aria-expanded") !== "true") },
  icon("menu"), h("span", { text: "Homes and units" }));
  function setDrawer(open) {
    toggle.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("open", open);
    if (open) panel.querySelector("a").focus();
  }
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && toggle) {
      setDrawer(false);
      toggle.focus();
    }
  });
  panel.addEventListener("click", (event) => {
    if (toggle && event.target.closest("a")) setDrawer(false);
  });
  return h("header", { class: managers ? "rail managers" : "rail" },
    h("div", { class: "brand" }, h("img", { src: "/assets/mark.svg", alt: "", width: 22, height: 22 }),
      h("span", { text: "Tallow Cover" })),
    toggle || null, panel,
    h("div", { class: "who" }, h("p", {}, h("span", { class: "who-name", text: me.display_name }),
      h("span", { class: "who-role", text: ROLE_NAMES[me.role] })), signOut));
}

let current = null;

function route(me, work) {
  const path = location.pathname;
  let view = SCREENS[path]?.roles.includes(me.role) ? SCREENS[path].view : null;
  let id = null;
  let active = path;
  for (const [pattern, detailView, parent] of DETAIL) {
    const match = path.match(pattern);
    if (match && path !== "/leave/new") [view, id, active] = [detailView, match[1], parent];
  }
  if (!view) {
    history.replaceState(null, "", firstScreen(me.role));
    return route(me, work);
  }
  for (const a of document.querySelectorAll(".nav-main a")) {
    if (a.getAttribute("href") === active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  document.title = `${SCREENS[active]?.label ?? "Tallow Cover"} · Tallow Cover`;
  work.replaceChildren();
  work.dataset.view = String(Number(work.dataset.view ?? 0) + 1);
  current?.leave?.();
  current = view(work, { me, boot, id, navigate }) ?? null;
}

let navigate = () => {};

async function start() {
  const root = document.getElementById("app");
  if (location.pathname === "/sign-in") {
    root.replaceChildren(views.signIn({ boot, firstScreen }));
    return;
  }
  let me;
  try {
    me = await get("/api/me");
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_signed_in") return;
    root.replaceChildren(h("main", { class: "work" }, h("p", { class: "status", role: "status", text: error.message })));
    return;
  }
  const work = h("main", { class: "work", id: "main" });
  root.replaceChildren(h("div", { class: "frame" }, rail(me), work));
  navigate = (href, replace = false) => {
    history[replace ? "replaceState" : "pushState"](null, "", href);
    route(me, work);
  };
  document.addEventListener("click", (event) => {
    const a = event.target.closest("a[data-link]");
    if (!a || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(a.getAttribute("href"));
  });
  addEventListener("popstate", () => {
    if (current?.popstate && location.pathname === "/queue") current.popstate();
    else route(me, work);
  });
  route(me, work);
}

start();
