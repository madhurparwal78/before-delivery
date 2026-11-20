/* The app shell: router, rail, sign-in and the screens for every role. */

const App = {
  me: null,
  homes: [],
  units: [],
  route: null,
  timers: [],
};

function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  render();
}

window.addEventListener("popstate", render);

function parseRoute() {
  const path = location.pathname;
  const query = new URLSearchParams(location.search);
  return { path, query };
}

function clearTimers() {
  for (const timer of App.timers) clearInterval(timer);
  App.timers = [];
}

function every(seconds, fn) {
  App.timers.push(setInterval(fn, seconds * 1000));
}

async function render() {
  clearTimers();
  const root = document.getElementById("root");
  if (!App.me) {
    try {
      App.me = await api.get("/api/me");
    } catch (err) {
      App.me = null;
    }
  }
  if (!App.me) {
    history.replaceState({}, "", "/sign-in");
    clear(root);
    root.append(signInScreen());
    return;
  }
  const route = parseRoute();
  App.route = route;
  const screen = screenFor(route);
  clear(root);
  root.append(shell(screen));
}

function screenFor(route) {
  const path = route.path;
  const role = App.me.role;
  if (path === "/" ) return defaultScreen();
  if (path === "/sign-in") return defaultScreen();
  if (path === "/shifts" && (role === "care_worker" || role === "bank_carer" || role === "unit_manager")) return shiftsScreen;
  if (path === "/leave/new" && (role === "care_worker" || role === "unit_manager")) return leaveFormScreen;
  if (path === "/leave" && (role === "care_worker" || role === "unit_manager")) return leaveListScreen;
  if (path.startsWith("/leave/") && (role === "care_worker" || role === "unit_manager" || role === "hr_admin")) return leaveDetailScreen;
  if (path === "/sickness" && role === "care_worker") return sicknessListScreen;
  if (path.startsWith("/sickness/") && (role === "care_worker" || role === "unit_manager" || role === "hr_admin")) return sicknessDetailScreen;
  if (path === "/rota") return rotaScreen;
  if (path === "/cover" && role === "bank_carer") return coverScreen;
  if (path === "/accrual" && role === "bank_carer") return accrualScreen;
  if (path === "/queue" && (role === "unit_manager" || role === "hr_admin")) return queueScreen;
  if (path === "/today" && (role === "unit_manager" || role === "hr_admin")) return todayScreen;
  if (path === "/floors" && (role === "unit_manager" || role === "hr_admin")) return floorsScreen;
  if (path === "/attendance" && (role === "unit_manager" || role === "hr_admin")) return attendanceScreen;
  if (path === "/pay-periods" && role === "hr_admin") return payPeriodsScreen;
  if (path === "/exports" && role === "hr_admin") return exportsScreen;
  if (path === "/audit" && (role === "unit_manager" || role === "hr_admin")) return auditScreen;
  if (path === "/profile") return profileScreen;
  return defaultScreen();
}

function defaultScreen() {
  const role = App.me ? App.me.role : "care_worker";
  if (role === "care_worker" || role === "bank_carer") return shiftsScreen;
  if (role === "unit_manager") return leaveFormScreen;
  return rotaScreen;
}

function shell(screenFn) {
  const role = App.me.role;
  const frame = h("div", { class: "frame" });
  const rail = h("aside", { class: "rail", "aria-label": "Rail" });
  const working = h("main", { class: "working", id: "working" });
  frame.append(rail, working);

  const navLinks = navForRole(role);
  const mainNav = h("nav", { "aria-label": "Main" },
    navLinks.map(([path, label]) => h("a", {
      href: path,
      text: label,
      "aria-current": location.pathname === path ? "page" : null,
    })));

  const homesBlock = (role === "unit_manager" || role === "hr_admin")
    ? homesNav() : null;

  const signOut = h("button", { class: "btn secondary signout", text: "Sign out",
    onclick: async () => {
      await api.del("/api/session");
      App.me = null;
      navigate("/sign-in", { replace: true });
    } });

  const drawerToggle = h("button", { class: "btn secondary drawer-toggle",
    text: "Homes and units", "aria-label": "Homes and units",
    "aria-expanded": "false", onclick: (event) => {
      const open = rail.classList.toggle("drawer-open");
      event.currentTarget.setAttribute("aria-expanded", String(open));
    } });

  const brand = h("p", { class: "brand" }, h("a", { href: defaultHref(role), text: "Tallow Cover" }));
  rail.append(brand, mainNav);
  if (homesBlock) rail.append(homesBlock);
  rail.append(signOut);

  const isNarrow = () => window.matchMedia("(max-width: 640px)").matches;
  if (isNarrow()) {
    const bar = h("div", { class: "topbar" }, brand.cloneNode(true), drawerToggle);
    frame.prepend(bar);
    rail.classList.add("drawer");
    rail.classList.remove("drawer-open");
  }

  const container = h("div", {});
  working.append(container);
  screenFn(container, working);
  return frame;
}

function defaultHref(role) {
  if (role === "care_worker" || role === "bank_carer") return "/shifts";
  if (role === "unit_manager") return "/leave/new";
  return "/rota";
}

function navForRole(role) {
  const links = [];
  if (role === "care_worker") {
    links.push(["/shifts", "My shifts"], ["/leave/new", "Request leave"], ["/leave", "My requests"],
      ["/sickness", "Sickness"], ["/rota", "Team rota"], ["/profile", "Profile"]);
  } else if (role === "bank_carer") {
    links.push(["/shifts", "My shifts"], ["/cover", "Open cover"],
      ["/accrual", "Holiday accrual"], ["/profile", "Profile"]);
  } else if (role === "unit_manager") {
    links.push(["/leave/new", "Request leave"], ["/leave", "My requests"], ["/rota", "Team rota"],
      ["/queue", "Queue"], ["/today", "Today"], ["/floors", "Floors and policy"],
      ["/attendance", "Attendance"], ["/audit", "Audit log"], ["/profile", "Profile"]);
  } else {
    links.push(["/rota", "Team rota"], ["/queue", "Queue"], ["/today", "Today"],
      ["/floors", "Floors and policy"], ["/attendance", "Attendance"],
      ["/pay-periods", "Pay periods"], ["/exports", "Exports"], ["/audit", "Audit log"],
      ["/profile", "Profile"]);
  }
  return links;
}

const HOME_DIR = [
  { id: "larchfield", name: "Larchfield House",
    units: [{ id: "larchfield-rowan", name: "Rowan" },
            { id: "larchfield-willow", name: "Willow" }] },
  { id: "brackenmoor", name: "Brackenmoor Lodge",
    units: [{ id: "brackenmoor-heather", name: "Heather" }] },
];

function homesNav() {
  const role = App.me.role;
  const homes = role === "unit_manager"
    ? HOME_DIR.filter((home) => home.id === App.me.home_id)
    : HOME_DIR;
  return h("nav", { class: "homes-block", "aria-label": "Homes and units" },
    h("h3", { text: "Homes and units" }),
    homes.map((home) => h("div", {},
      h("a", { href: `/rota?home=${home.id}`, text: home.name }),
      home.units.map((unit) =>
        h("a", { href: `/rota?unit=${unit.id}`, text: unit.name })))));
}

/* ---------- sign-in ---------- */

function signInScreen() {
  const email = field({ label: "Email", name: "email", type: "email" });
  const password = field({ label: "Password", name: "password", type: "password" });
  const status = statusLine("Sign-in status");
  const submit = h("button", { class: "btn", type: "submit", text: "Sign in" });
  const form = h("form", { "aria-label": "Sign in", onsubmit: async (event) => {
    event.preventDefault();
    submit.disabled = true;
    setStatus(status, "Signing in…");
    try {
      const user = await api.post("/api/session", {
        email: email.input.value.trim(), password: password.input.value });
      App.me = user.user;
      navigate(defaultHref(App.me.role), { replace: true });
    } catch (err) {
      setStatus(status, err.message);
      const errors = err.body && err.body.errors;
      if (errors) { email.showError(errors.email); password.showError(errors.password); }
      submit.disabled = false;
    }
  } },
    h("h1", { text: "Sign in to Tallow Cover" }),
    email, password, submit, status);
  return h("div", { class: "working sign-in-working" }, form);
}
